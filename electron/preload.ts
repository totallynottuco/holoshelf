import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { HoloshelfBridge, IpcChannel, IpcChannelMap } from "../src/shared/ipc";

const bridge: HoloshelfBridge = {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload) as Promise<IpcChannelMap[typeof channel]["response"]>;
  },
  onHololiveRefreshProgress(listener) {
    const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on("hololive:refresh-progress", handler);
    return () => ipcRenderer.removeListener("hololive:refresh-progress", handler);
  },
  onUpdateStatus(listener) {
    const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on("updates:status", handler);
    return () => ipcRenderer.removeListener("updates:status", handler);
  },
  onFindInPageResult(listener) {
    const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on("app:find-in-page:result", handler);
    return () => ipcRenderer.removeListener("app:find-in-page:result", handler);
  }
};

contextBridge.exposeInMainWorld("holoshelf", bridge);

export type { HoloshelfBridge, IpcChannel, IpcChannelMap };
