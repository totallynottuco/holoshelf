import { useEffect } from "react";

interface DismissableLayerOptions {
  enabled: boolean;
  ref: { current: HTMLElement | null };
  onDismiss: () => void;
  closeOnEscape?: boolean;
  closeOnPointerDown?: boolean;
  ignorePointerDown?: (target: Node) => boolean;
}

export function useDismissableLayer({
  enabled,
  ref,
  onDismiss,
  closeOnEscape = true,
  closeOnPointerDown = true,
  ignorePointerDown
}: DismissableLayerOptions) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!closeOnPointerDown) {
        return;
      }
      const target = event.target;
      const layer = ref.current;
      if (!(target instanceof Node) || !layer || layer.contains(target) || ignorePointerDown?.(target)) {
        return;
      }
      onDismiss();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (closeOnEscape && event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeOnEscape, closeOnPointerDown, enabled, ignorePointerDown, onDismiss, ref]);
}
