import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const args = parseArgs(process.argv.slice(2));

function fail(message) {
  throw new Error(`Release publish failed: ${message}`);
}

function parseArgs(argv) {
  const parsed = {
    yes: false,
    bump: "patch",
    version: "",
    notes: "",
    notesFile: "",
    commitMessage: "",
    noWait: false,
    waitMinutes: 30,
    allowBranch: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--yes") parsed.yes = true;
    else if (arg === "--no-wait") parsed.noWait = true;
    else if (arg === "--allow-branch") parsed.allowBranch = true;
    else if (arg === "--bump") parsed.bump = readValue();
    else if (arg === "--version") parsed.version = readValue();
    else if (arg === "--notes") parsed.notes = readValue();
    else if (arg === "--notes-file") parsed.notesFile = readValue();
    else if (arg === "--commit-message") parsed.commitMessage = readValue();
    else if (arg === "--wait-minutes") parsed.waitMinutes = Number(readValue());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!["patch", "minor", "major", "none"].includes(parsed.bump)) {
    fail("--bump must be patch, minor, major, or none");
  }
  if (parsed.version && parsed.bump !== "patch") {
    fail("use either --version or --bump, not both");
  }
  if (!Number.isFinite(parsed.waitMinutes) || parsed.waitMinutes <= 0) {
    fail("--wait-minutes must be a positive number");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run release:publish -- --yes [--notes-file release-notes.txt]

Options:
  --yes                         Required. Allows committing, tagging, and pushing.
  --notes "..."                 Release notes to store in package.json.
  --notes-file <path>           Read release notes from a file.
  --bump patch|minor|major|none Version bump before release. Default: patch.
  --version x.y.z               Set an exact SemVer version.
  --commit-message "..."        Override the release commit message.
  --no-wait                     Do not wait for GitHub Release publication.
  --wait-minutes <minutes>      Wait timeout. Default: 30.
  --allow-branch                Allow releasing from a branch other than main.`);
}

function run(command, commandArgs, options = {}) {
  const resolved = resolveCommand(command, commandArgs);
  console.log(`\n> ${[command, ...commandArgs].join(" ")}`);
  return execFileSync(resolved.command, resolved.args, {
    cwd: projectRoot,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8"
  });
}

function output(command, commandArgs) {
  return run(command, commandArgs, { capture: true }).trim();
}

function resolveCommand(command, commandArgs) {
  if (command === "npm" && process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...commandArgs]
    };
  }

  if (command === "npm" && process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["npm", ...commandArgs].map(quoteForCmd).join(" ")]
    };
  }

  return { command, args: commandArgs };
}

function quoteForCmd(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '\\"')}"`;
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function writePackageJson(packageJson) {
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function resolveNotes() {
  if (args.notesFile) {
    return fs.readFileSync(path.resolve(projectRoot, args.notesFile), "utf8").trim();
  }
  return args.notes.trim();
}

function parseRepoFullName(packageJson) {
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const match = String(repository ?? "").match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?/i);
  if (!match?.groups) {
    fail("package.json repository must point at a GitHub repo");
  }
  return `${match.groups.owner}/${match.groups.repo}`;
}

function assertCleanEnoughBranch() {
  const branch = output("git", ["branch", "--show-current"]);
  if (!args.allowBranch && branch !== "main") {
    fail(`release must run from main, currently on "${branch || "detached HEAD"}"`);
  }
}

function tagExists(tagName) {
  const local = output("git", ["tag", "--list", tagName]);
  if (local === tagName) {
    return true;
  }
  const remote = output("git", ["ls-remote", "--tags", "origin", tagName]);
  return remote.length > 0;
}

function assertNoTrackedIgnoredArtifacts() {
  const trackedFiles = output("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
  const bad = trackedFiles.filter((file) =>
    /^(release|dist|dist-electron|node_modules|data)\//.test(file.replaceAll("\\", "/"))
  );
  if (bad.length > 0) {
    fail(`generated/private paths are tracked:\n${bad.map((file) => `  - ${file}`).join("\n")}`);
  }
}

async function waitForPublishedRelease(repoFullName, tagName, timeoutMinutes) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  const headers = {
    "User-Agent": "Holoshelf release publisher",
    Accept: "application/vnd.github+json"
  };
  let lastRunUrl = "";

  while (Date.now() < deadline) {
    const release = await fetchJson(`https://api.github.com/repos/${repoFullName}/releases/tags/${tagName}`, headers);
    if (release.ok) {
      const assets = Array.isArray(release.value.assets) ? release.value.assets.map((asset) => String(asset.name ?? "")) : [];
      const hasInstaller = assets.some((name) => /^Holoshelf-Setup-.*\.exe$/i.test(name));
      const hasBlockmap = assets.some((name) => /^Holoshelf-Setup-.*\.exe\.blockmap$/i.test(name));
      const hasLatest = assets.includes("latest.yml");
      if (!release.value.draft && hasInstaller && hasBlockmap && hasLatest) {
        console.log(`Published release is ready: ${release.value.html_url}`);
        return;
      }
    }

    const runs = await fetchJson(
      `https://api.github.com/repos/${repoFullName}/actions/runs?event=push&branch=${encodeURIComponent(tagName)}&per_page=5`,
      headers
    );
    if (runs.ok) {
      const run = runs.value.workflow_runs?.find((item) => item.head_branch === tagName) ?? runs.value.workflow_runs?.[0];
      if (run) {
        lastRunUrl = run.html_url ?? lastRunUrl;
        if (run.status === "completed" && run.conclusion !== "success") {
          fail(`GitHub release workflow finished with ${run.conclusion}: ${run.html_url}`);
        }
      }
    }

    console.log(`Waiting for ${tagName} release publication${lastRunUrl ? ` (${lastRunUrl})` : ""}...`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }

  fail(`timed out waiting for ${tagName} to publish${lastRunUrl ? `: ${lastRunUrl}` : ""}`);
}

async function fetchJson(url, headers) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return { ok: false, status: response.status, value: null };
    }
    return { ok: true, status: response.status, value: await response.json() };
  } catch {
    return { ok: false, status: 0, value: null };
  }
}

if (!args.yes) {
  fail("pass --yes to allow the script to commit, tag, and push a release");
}

assertCleanEnoughBranch();
assertNoTrackedIgnoredArtifacts();
run("git", ["fetch", "--tags", "origin"]);

if (args.version) {
  run("npm", ["version", args.version, "--no-git-tag-version"]);
} else if (args.bump !== "none") {
  run("npm", ["version", args.bump, "--no-git-tag-version"]);
}

const packageJson = readPackageJson();
const releaseNotes = resolveNotes();
if (releaseNotes) {
  packageJson.build = packageJson.build ?? {};
  packageJson.build.releaseInfo = packageJson.build.releaseInfo ?? {};
  packageJson.build.releaseInfo.releaseNotes = releaseNotes;
  writePackageJson(packageJson);
}

const version = String(readPackageJson().version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version is not SemVer: ${version}`);
}
const tagName = `v${version}`;
if (tagExists(tagName)) {
  fail(`${tagName} already exists locally or on origin; bump the version before releasing`);
}

run("npm", ["run", "release:preflight"]);
run("git", ["add", "-A"]);

const staged = output("git", ["diff", "--cached", "--name-only"]);
if (!staged) {
  fail("nothing is staged after release preflight");
}

run("git", ["commit", "-m", args.commitMessage || `Release Holoshelf ${version}`]);
run("git", ["tag", "-a", tagName, "-m", tagName]);
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", tagName]);

if (!args.noWait) {
  await waitForPublishedRelease(parseRepoFullName(readPackageJson()), tagName, args.waitMinutes);
}
