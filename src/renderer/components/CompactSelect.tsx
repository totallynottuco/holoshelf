import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface CompactSelectOption<TValue extends string> {
  value: TValue;
  label: string;
  disabled?: boolean;
}

interface CompactSelectProps<TValue extends string> {
  value: TValue;
  options: CompactSelectOption<TValue>[];
  ariaLabel: string;
  onChange: (value: TValue) => void;
  disabled?: boolean;
  className?: string;
}

export function CompactSelect<TValue extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  disabled = false,
  className = ""
}: CompactSelectProps<TValue>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function moveSelection(direction: 1 | -1) {
    const enabledOptions = options.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) {
      return;
    }

    const selectedIndex = enabledOptions.findIndex((option) => option.value === value);
    const nextIndex =
      selectedIndex < 0
        ? 0
        : Math.max(0, Math.min(enabledOptions.length - 1, selectedIndex + direction));
    onChange(enabledOptions[nextIndex].value);
  }

  return (
    <div ref={rootRef} className={["compact-select", open ? "open" : "", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="compact-select-button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveSelection(-1);
          }
        }}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open ? (
        <div id={`${id}-listbox`} className="compact-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={option.value === value ? "selected" : ""}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
