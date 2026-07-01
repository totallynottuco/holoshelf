import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, RotateCcw } from "lucide-react";
import { api } from "../api";

type HololiveToastTone = "info" | "success" | "error";
const HOLOLIVE_TOAST_DURATION_MS = 5000;

interface HololiveToastRequest {
  message: string;
  detail?: string | null;
  tone?: HololiveToastTone;
  actionLabel?: string | null;
  onAction?: () => void | Promise<void>;
}

interface HololiveUndoToastRequest extends HololiveToastRequest {
  undoToken?: string | null;
  undoLabel?: string | null;
  onApplied?: () => void | Promise<void>;
}

interface HololiveActionToastContextValue {
  showToast: (request: HololiveToastRequest) => void;
  showUndoToast: (request: HololiveUndoToastRequest) => void;
}

interface ToastState extends HololiveUndoToastRequest {
  id: string;
  busy: boolean;
  fading: boolean;
  error?: string | null;
}

const HololiveActionToastContext = createContext<HololiveActionToastContextValue | null>(null);

export function HololiveActionToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timersRef = useRef<{ fade: number | null; clear: number | null }>({ fade: null, clear: null });

  function clearTimers() {
    if (timersRef.current.fade !== null) {
      window.clearTimeout(timersRef.current.fade);
    }
    if (timersRef.current.clear !== null) {
      window.clearTimeout(timersRef.current.clear);
    }
    timersRef.current = { fade: null, clear: null };
  }

  function dismiss() {
    clearTimers();
    setToast(null);
  }

  function scheduleDismiss(id: string) {
    clearTimers();
    timersRef.current.fade = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? { ...current, fading: true } : current));
    }, HOLOLIVE_TOAST_DURATION_MS);
    timersRef.current.clear = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, HOLOLIVE_TOAST_DURATION_MS + 500);
  }

  function showToast(request: HololiveToastRequest) {
    const id = crypto.randomUUID();
    setToast({ ...request, id, tone: request.tone ?? "info", busy: false, fading: false, error: null });
    scheduleDismiss(id);
  }

  function showUndoToast(request: HololiveUndoToastRequest) {
    showToast({ ...request, tone: request.tone ?? "success" });
  }

  async function applyAction() {
    if (!toast?.onAction || toast.busy) {
      return;
    }

    const actionToastId = toast.id;
    clearTimers();
    setToast((current) => (current ? { ...current, busy: true, error: null } : current));
    try {
      await toast.onAction();
      setToast((current) => (current?.id === actionToastId ? null : current));
    } catch (error) {
      const retryId = crypto.randomUUID();
      setToast((current) =>
        current
          ? {
              ...current,
              id: retryId,
              busy: false,
              fading: false,
              error: error instanceof Error ? error.message : "That action failed."
            }
          : current
      );
      scheduleDismiss(retryId);
    }
  }

  async function applyUndo() {
    if (!toast?.undoToken || toast.busy) {
      return;
    }

    clearTimers();
    setToast((current) => (current ? { ...current, busy: true, error: null } : current));
    try {
      await api.invoke("hololive:undo:apply", { token: toast.undoToken });
      await toast.onApplied?.();
      const restoredId = crypto.randomUUID();
      setToast({
        ...toast,
        id: restoredId,
        message: "Restored.",
        detail: null,
        tone: "success",
        busy: false,
        fading: false,
        error: null,
        undoToken: null
      });
      scheduleDismiss(restoredId);
    } catch (error) {
      const retryId = crypto.randomUUID();
      setToast((current) =>
        current
          ? {
              ...current,
              id: retryId,
              busy: false,
              fading: false,
              error: error instanceof Error ? error.message : "Could not undo that action."
            }
          : current
      );
      scheduleDismiss(retryId);
    }
  }

  const ToastIcon = toast?.tone === "error" ? AlertTriangle : toast?.tone === "success" ? CheckCircle2 : Info;

  return (
    <HololiveActionToastContext.Provider value={{ showToast, showUndoToast }}>
      {children}
      {toast ? (
        <div
          className={`hololive-action-toast ${toast.tone ?? "info"}${toast.fading ? " fading" : ""}`}
          role="status"
          aria-live="polite"
          onClick={dismiss}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              dismiss();
            }
          }}
          tabIndex={0}
          title="Dismiss notification"
          style={{ "--toast-duration-ms": `${HOLOLIVE_TOAST_DURATION_MS}ms` } as CSSProperties}
        >
          <ToastIcon className="hololive-toast-icon" size={16} aria-hidden="true" />
          <div>
            <strong>{toast.message}</strong>
            {toast.detail || toast.error ? <small>{toast.detail ?? toast.error}</small> : null}
          </div>
          {toast.onAction ? (
            <button
              type="button"
              disabled={toast.busy}
              onClick={(event) => {
                event.stopPropagation();
                void applyAction();
              }}
            >
              <span>{toast.busy ? "Working" : toast.actionLabel ?? "Confirm"}</span>
            </button>
          ) : toast.undoToken ? (
            <button
              type="button"
              disabled={toast.busy}
              onClick={(event) => {
                event.stopPropagation();
                void applyUndo();
              }}
            >
              <RotateCcw size={13} />
              <span>{toast.busy ? "Restoring" : toast.undoLabel ?? "Undo"}</span>
            </button>
          ) : null}
          <span className="hololive-toast-progress" aria-hidden="true" />
        </div>
      ) : null}
    </HololiveActionToastContext.Provider>
  );
}

export function useHololiveActionToast(): HololiveActionToastContextValue {
  const context = useContext(HololiveActionToastContext);
  if (!context) {
    throw new Error("useHololiveActionToast must be used inside HololiveActionToastProvider");
  }
  return context;
}
