import { Outlet } from "react-router-dom";
import { HololivePlayerProvider } from "../player/HololivePlayerContext";

export function Shell() {
  return (
    <div className="app-frame">
      <HololivePlayerProvider>
        <main className="workspace">
          <Outlet />
        </main>
      </HololivePlayerProvider>
    </div>
  );
}
