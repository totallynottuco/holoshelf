import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AppBootstrap } from "../shared/contracts";
import { api } from "./api";
import { Shell } from "./components/Shell";
import { HololiveBracketsPage } from "./pages/HololiveBracketsPage";
import { HololivePage } from "./pages/HololivePage";
import { HololivePlayerPage } from "./pages/HololivePlayerPage";
import { HololiveTalentsPage } from "./pages/HololiveTalentsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api.invoke("app:bootstrap", null)
      .then((nextBootstrap) => {
        if (!cancelled) {
          setBootstrap(nextBootstrap);
          setBootstrapError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : "Could not load Holoshelf.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (bootstrapError) {
    return (
      <div className="boot-screen boot-screen-error">
        <strong>Could not load Holoshelf.</strong>
        <span>{bootstrapError}</span>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (!bootstrap) {
    return <div className="boot-screen">Loading Holoshelf</div>;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/module/hololive" replace />} />
          <Route path="/module/hololive/player" element={<HololivePlayerPage />} />
          <Route path="/module/hololive/talents" element={<HololiveTalentsPage />} />
          <Route path="/module/hololive/brackets" element={<HololiveBracketsPage />} />
          <Route path="/module/hololive/settings" element={<SettingsPage bootstrap={bootstrap} />} />
          <Route path="/module/hololive" element={<HololivePage />} />
          <Route path="/settings" element={<Navigate to="/module/hololive/settings" replace />} />
          <Route path="/import" element={<Navigate to="/module/hololive" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
