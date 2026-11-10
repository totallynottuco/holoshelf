import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, Save, X } from "lucide-react";
import type { SavedBracketPreset } from "../../shared/bracketPresets";
import "./HololiveBracketPresets.css";

interface Props {
  presets: SavedBracketPreset[];
  activeId: string | null;
  loadedName: string;
  pending: boolean;
  disabled: boolean;
  invalid: boolean;
  error: string | null;
  onLoad: (preset: SavedBracketPreset) => void;
  onSave: (name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRetry: () => void;
  onClearError: () => void;
}

export function HololiveBracketPresets(props: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [scroll, setScroll] = useState({ overflow: false, start: true, end: true });
  const container = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const disabled = props.disabled || props.pending;

  useEffect(() => { if (naming) { input.current?.focus(); input.current?.select(); } }, [naming]);
  useEffect(() => {
    const element = track.current, parent = container.current;
    if (!element || !parent) return;
    const update = () => setScroll({ overflow: element.scrollWidth > parent.clientWidth + 1, start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(element); observer.observe(parent);
    element.addEventListener("scroll", update);
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || !element) return;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
      if ((delta < 0 && element.scrollLeft > 0) || (delta > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1)) {
        event.preventDefault(); element.scrollLeft += delta;
      }
    }
    element.addEventListener("wheel", wheel, { passive: false });
    update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); element.removeEventListener("wheel", wheel); };
  }, [props.presets, naming]);
  useEffect(() => {
    if (props.activeId) track.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeId, props.presets]);

  function move(direction: number) {
    const element = track.current;
    element?.scrollBy({ left: direction * Math.max(150, element.clientWidth * .8), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  async function save() {
    if (disabled || props.invalid || !name.trim()) return;
    if (await props.onSave(name)) { setNaming(false); setName(""); window.requestAnimationFrame(() => saveButton.current?.focus()); }
  }
  function cancelName() {
    setNaming(false); props.onClearError();
    window.requestAnimationFrame(() => saveButton.current?.focus());
  }

  return <div className="bracket-preset-strip">
    <div className="bracket-preset-bar">
      <button ref={saveButton} type="button" className="preset-save" aria-label="Save preset" aria-pressed={naming} disabled={disabled || props.invalid || (naming && !name.trim())} onClick={() => {
        if (naming) void save();
        else { props.onClearError(); setName(props.loadedName); setNaming(true); }
      }}>{props.pending ? <Loader2 size={17} className="spin" /> : <Save size={17} />}</button>
      {naming && <form className="preset-name-form" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); cancelName(); } }}>
        <input ref={input} aria-label="Preset name" placeholder="Preset name" maxLength={48} value={name} disabled={disabled} onChange={event => { setName(event.target.value); props.onClearError(); }} />
        <button type="button" className="lobby-icon-button" aria-label="Cancel preset name" disabled={disabled} onClick={cancelName}><X size={14} /></button>
      </form>}
      <div ref={container} className="preset-carousel" role="region" aria-roledescription="carousel" aria-label="Saved presets">
        <button type="button" className="preset-scroll" aria-label="Previous presets" hidden={!scroll.overflow} disabled={disabled || scroll.start} onClick={() => move(-1)}><ChevronLeft size={17} /></button>
        <div ref={track} className="preset-carousel-track"
          onPointerDown={event => {
            if (disabled || event.pointerType !== "mouse" || event.button !== 0 || (event.target instanceof Element && event.target.closest(".preset-delete"))) return;
            suppressClick.current = false;
            drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
          }}
          onPointerMove={event => {
            if (!drag.current || event.buttons !== 1) return;
            const delta = event.clientX - drag.current.x;
            if (!drag.current.moved && Math.abs(delta) < 5) return;
            drag.current.moved = true; suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.scrollLeft = drag.current.scroll - delta;
            event.preventDefault();
          }}
          onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            drag.current = null;
            window.setTimeout(() => { suppressClick.current = false; }, 0);
          }}
          onPointerCancel={() => { drag.current = null; suppressClick.current = false; }}
          onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
          onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.matches(".preset-load")) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".preset-load")), index = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)));
          event.preventDefault(); buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
          {props.presets.map(preset => <div key={preset.id} className="bracket-preset-card" data-active={props.activeId === preset.id}>
            <button type="button" className="preset-load" aria-pressed={props.activeId === preset.id} disabled={disabled} onClick={() => { setNaming(false); props.onClearError(); props.onLoad(preset); }}>{preset.name}</button>
            <button type="button" className="preset-delete" aria-label={`Delete preset ${preset.name}`} disabled={disabled} onClick={async () => {
              const index = props.presets.findIndex(item => item.id === preset.id);
              if (await props.onDelete(preset.id)) window.requestAnimationFrame(() => {
                const remaining = track.current?.querySelectorAll<HTMLButtonElement>(".preset-load");
                (remaining?.[Math.min(index, remaining.length - 1)] ?? saveButton.current)?.focus();
              });
            }}><X size={12} /></button>
          </div>)}
        </div>
        <button type="button" className="preset-scroll" aria-label="Next presets" hidden={!scroll.overflow} disabled={disabled || scroll.end} onClick={() => move(1)}><ChevronRight size={17} /></button>
      </div>
    </div>
    {props.error && <div className="preset-error" role="alert"><span>{props.error}</span><button type="button" className="lobby-icon-button" aria-label="Retry presets" disabled={disabled} onClick={props.onRetry}><RotateCcw size={13} /></button></div>}
  </div>;
}
