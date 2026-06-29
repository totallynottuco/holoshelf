import { app, BrowserWindow, protocol, session, shell } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ensureAppPaths, getAppPaths } from "./services/appPaths";
import { DatabaseService } from "./services/database";
import { FetchScheduler } from "./services/fetchScheduler";
import { HolodexMusicService } from "./services/holodexMusicService";
import { mergeBundledOfficialData } from "./services/officialDataMergeService";
import { UpdateService } from "./services/updateService";
import { YouTubeVideoStatsService } from "./services/youtubeVideoStatsService";
import { createSourceAdapters, trackerModules } from "../src/modules/registry";
import { installIpcHandlers } from "./ipcHandlers";

let mainWindow: BrowserWindow | null = null;
const YOUTUBE_EMBED_REFERRER = "https://holoshelf.localhost/";

function writeAppLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logPath = app.isReady()
    ? path.join(getAppPaths(app).dataDirectory, "app.log")
    : path.join(process.cwd(), "holoshelf.log");

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, "utf8");
  } catch {
    // Logging must never prevent the app from opening.
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function resolveWindowIcon(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(process.cwd(), "icon.ico");
}

function resolveRendererRoot(): string {
  return app.isPackaged ? path.join(__dirname, "../../dist") : path.join(process.cwd(), "dist");
}

function getMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".webp":
      return "image/webp";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

function registerAppProtocol(): void {
  const rendererRoot = resolveRendererRoot();

  protocol.handle("app", async (request) => {
    const url = new URL(request.url);

    if (url.hostname === "holoshelf-data") {
      const relativeRequestPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const [scope, requestedFileName] = relativeRequestPath.split("/");

      if (scope !== "hololive-images" || !requestedFileName) {
        return new Response("Not found", { status: 404 });
      }

      const safeFileName = path.basename(requestedFileName);
      if (safeFileName !== requestedFileName) {
        return new Response("Forbidden", { status: 403 });
      }

      const filePath = path.join(getAppPaths(app).hololiveImageDirectory, safeFileName);

      try {
        const contents = await fsp.readFile(filePath);
        return new Response(contents, {
          headers: {
            "content-type": getMimeType(filePath)
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    if (url.hostname !== "holoshelf") {
      writeAppLog(`protocol rejected host=${url.hostname}`);
      return new Response("Not found", { status: 404 });
    }

    const relativeRequestPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const normalizedRequestPath = path.normalize(relativeRequestPath);

    if (normalizedRequestPath.startsWith("..") || path.isAbsolute(normalizedRequestPath)) {
      return new Response("Forbidden", { status: 403 });
    }

    const filePath = path.join(rendererRoot, normalizedRequestPath);

    try {
      const contents = await fsp.readFile(filePath);
      return new Response(contents, {
        headers: {
          "content-type": getMimeType(filePath)
        }
      });
    } catch {
      writeAppLog(`protocol missing ${filePath}`);
      return new Response("Not found", { status: 404 });
    }
  });
}

function registerYouTubeEmbedHeaders(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: ["https://www.youtube.com/*", "https://youtube.com/*", "https://www.youtube-nocookie.com/*"]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      for (const key of Object.keys(requestHeaders)) {
        if (key.toLowerCase() === "referer") {
          delete requestHeaders[key];
        }
      }
      requestHeaders.Referer = YOUTUBE_EMBED_REFERRER;
      callback({ requestHeaders });
    }
  );
}

function shouldLogRendererConsole(level: number, message: string, sourceId: string): boolean {
  const normalizedMessage = message.trim();

  if (
    level <= 2 &&
    (normalizedMessage === "Unrecognized feature: 'web-share'." ||
      normalizedMessage.includes("googleads.g.doubleclick.net/pagead/viewthroughconversion") ||
      normalizedMessage.includes("Failed to execute 'postMessage' on 'DOMWindow'"))
  ) {
    return false;
  }

  if (sourceId.startsWith("https://www.youtube.com/") && level <= 2) {
    return false;
  }

  return true;
}

async function createMainWindow(): Promise<void> {
  const paths = getAppPaths(app);
  ensureAppPaths(paths);
  writeAppLog(
    `resolved paths dataDirectory=${paths.dataDirectory} databasePath=${paths.databasePath} backupDirectory=${paths.backupDirectory} dataLocationKind=${paths.dataLocationKind}`
  );

  const database = new DatabaseService(paths.databasePath, paths.backupDirectory);
  await database.init();
  database.upsertModuleManifests(trackerModules);
  if (app.isPackaged) {
    try {
      await mergeBundledOfficialData({
        database,
        paths,
        isPackaged: app.isPackaged,
        log: writeAppLog
      });
    } catch (error) {
      writeAppLog(
        `[official-data] merge failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    }
  }

  const fetchScheduler = new FetchScheduler(database, createSourceAdapters());
  const holodexMusicService = new HolodexMusicService(database);
  const youtubeVideoStatsService = new YouTubeVideoStatsService(database);
  const updateService = new UpdateService({ isPackaged: app.isPackaged });
  installIpcHandlers({
    appName: "Holoshelf",
    dataDirectory: paths.dataDirectory,
    databasePath: paths.databasePath,
    backupDirectory: paths.backupDirectory,
    dataLocationKind: paths.dataLocationKind,
    hololiveImageDirectory: paths.hololiveImageDirectory,
    database,
    fetchScheduler,
    holodexMusicService,
    youtubeVideoStatsService,
    updateService
  });

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1120,
    minHeight: 760,
    title: "Holoshelf",
    icon: resolveWindowIcon(),
    backgroundColor: "#101318",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const createdWindow = mainWindow;
  createdWindow.on("closed", () => {
    if (mainWindow === createdWindow) {
      mainWindow = null;
    }
  });
  updateService.attachWindow(mainWindow);
  updateService.initialize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(url);
      }
    } catch {
      writeAppLog(`window-open rejected malformed url=${url}`);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (shouldLogRendererConsole(level, message, sourceId)) {
      writeAppLog(`renderer console level=${level} source=${sourceId}:${line} message=${message}`);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeAppLog(`did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeAppLog(`preload-error path=${preloadPath} error=${error.stack ?? error.message}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeAppLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  if (app.isPackaged) {
    await mainWindow.loadURL("app://holoshelf/index.html");
    void updateService.checkForUpdates();
  } else {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId("app.holoshelf");
  registerAppProtocol();
  registerYouTubeEmbedHeaders();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
