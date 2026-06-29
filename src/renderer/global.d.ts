import type { HoloshelfBridge } from "../shared/ipc";

declare global {
  interface Window {
    holoshelf?: HoloshelfBridge;
  }
}

export {};
