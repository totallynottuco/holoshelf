import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import type { InstalledUpdateRelease } from "../../shared/ipc";
import { api } from "../api";
import { HololiveActionToastProvider } from "./HololiveActionToast";
import { InstalledUpdateDialog } from "./InstalledUpdateDialog";
import { HololivePlayerProvider } from "../player/HololivePlayerContext";

export function Shell() {
  const [installedRelease, setInstalledRelease] = useState<InstalledUpdateRelease | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.invoke("updates:installed-release", null).then((release) => {
      if (!cancelled) {
        setInstalledRelease(release);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissInstalledRelease = useCallback(async () => {
    setInstalledRelease(null);
    await api.invoke("updates:installed-release:dismiss", null).catch(() => undefined);
  }, []);

  return (
    <>
      <div className="app-titlebar" aria-hidden="true">
        <img src="app://holoshelf-assets/ico.ico" alt="" />
        <span>Holoshelf</span>
      </div>
      <HololiveActionToastProvider>
        <HololivePlayerProvider>
          <Outlet />
        </HololivePlayerProvider>
        {installedRelease ? (
          <InstalledUpdateDialog release={installedRelease} onDismiss={dismissInstalledRelease} />
        ) : null}
      </HololiveActionToastProvider>
    </>
  );
}
