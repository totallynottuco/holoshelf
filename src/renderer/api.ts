import type { HoloshelfBridge, IpcChannel, IpcChannelMap } from "../shared/ipc";

const electronBridge = window.holoshelf ?? null;

const missingBridge: HoloshelfBridge = {
  onHololiveRefreshProgress() {
    return () => undefined;
  },
  onUpdateStatus() {
    return () => undefined;
  },
  async invoke(channel) {
    throw new Error(`Holoshelf IPC bridge is unavailable for ${String(channel)}`);
  }
};

let browserMockPromise: Promise<HoloshelfBridge> | null = null;

function canUseBrowserMock(): boolean {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

async function getBrowserMock(): Promise<HoloshelfBridge> {
  browserMockPromise ??= import("./apiMock").then((module) => module.api);
  return browserMockPromise;
}

function createBrowserMockProxy(): HoloshelfBridge {
  return {
    onHololiveRefreshProgress(listener) {
      let unsubscribe: () => void = () => undefined;
      void getBrowserMock().then((mock) => {
        unsubscribe = mock.onHololiveRefreshProgress(listener);
      });
      return () => unsubscribe();
    },
    onUpdateStatus(listener) {
      let unsubscribe: () => void = () => undefined;
      void getBrowserMock().then((mock) => {
        unsubscribe = mock.onUpdateStatus(listener);
      });
      return () => unsubscribe();
    },
    async invoke<C extends IpcChannel>(
      channel: C,
      payload: IpcChannelMap[C]["request"]
    ): Promise<IpcChannelMap[C]["response"]> {
      const mock = await getBrowserMock();
      return mock.invoke(channel, payload);
    }
  };
}

export const api: HoloshelfBridge = electronBridge ?? (canUseBrowserMock() ? createBrowserMockProxy() : missingBridge);
