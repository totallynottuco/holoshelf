import { Outlet } from "react-router-dom";
import { HololiveActionToastProvider } from "./HololiveActionToast";
import { HololivePlayerProvider } from "../player/HololivePlayerContext";

export function Shell() {
  return (
    <div className="app-frame">
      <div className="app-titlebar" aria-hidden="true">
        <img src="app://holoshelf-assets/ico.ico" alt="" />
        <span>Holoshelf</span>
      </div>
      <HololiveActionToastProvider>
        <HololivePlayerProvider>
          <main className="workspace">
            <Outlet />
          </main>
        </HololivePlayerProvider>
      </HololiveActionToastProvider>
    </div>
  );
}
