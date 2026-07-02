import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AppBootstrap } from "../shared/contracts";
import { api } from "./api";
import { Shell } from "./components/Shell";

const HololiveBracketPage = lazy(() => import("./pages/HololiveBracketPage").then((module) => ({ default: module.HololiveBracketPage })));
const HololivePage = lazy(() => import("./pages/HololivePage").then((module) => ({ default: module.HololivePage })));
const HololivePlayerPage = lazy(() => import("./pages/HololivePlayerPage").then((module) => ({ default: module.HololivePlayerPage })));
const HololiveCustomImportPage = lazy(() =>
  import("./pages/HololiveCustomImportPage").then((module) => ({ default: module.HololiveCustomImportPage }))
);
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

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
      <Suspense fallback={<div className="boot-screen">Loading Holoshelf</div>}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Navigate to="/module/hololive" replace />} />
            <Route path="/module/hololive/player" element={<HololivePlayerPage />} />
            <Route path="/module/hololive/bracket" element={<HololiveBracketPage />} />
            <Route path="/module/hololive/brackets" element={<Navigate to="/module/hololive/bracket" replace />} />
            <Route path="/module/hololive/custom-import" element={<HololiveCustomImportPage />} />
            <Route path="/module/hololive/talents" element={<Navigate to="/module/hololive/custom-import" replace />} />
            <Route path="/module/hololive/settings" element={<SettingsPage bootstrap={bootstrap} />} />
            <Route path="/module/hololive" element={<HololivePage />} />
            <Route path="/settings" element={<Navigate to="/module/hololive/settings" replace />} />
            <Route path="/import" element={<Navigate to="/module/hololive" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
