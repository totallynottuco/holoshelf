import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, RotateCcw, Shuffle, SlidersHorizontal, Swords, X } from "lucide-react";
import type { HololiveBracketGenerationStyle, HololiveBracketSelectionPreview, HololiveBracketSize } from "../../shared/contracts";
import "./HololiveBracketLobby.css";

interface Props {
  rules: ReactNode;
  filters: ReactNode;
  filtersExpanded: boolean;
  activeFilters: string[];
  presets: ReactNode;
  preview: HololiveBracketSelectionPreview | null;
  pending: boolean;
  error: string | null;
  invalid: boolean;
  busy: boolean;
  size: HololiveBracketSize;
  style: HololiveBracketGenerationStyle;
  format: string;
  onToggleFilters: () => void;
  onReset: () => void;
  onRedraw: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onClose: () => void;
}

export function HololiveBracketLobby(props: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const count = Number(props.size.slice(2));
  const ready = !!props.preview && props.preview.entries.length === count && !props.preview.creationError && !props.pending && !props.error;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape" && event.target instanceof HTMLElement) {
        const picker = event.target.closest(".compact-select.open, .hololive-bracket-talent-selector.open");
        if (picker) {
          event.preventDefault();
          event.stopPropagation();
          const trigger = picker.querySelector<HTMLButtonElement>("button");
          trigger?.click();
          trigger?.focus();
          return;
        }
      }
      if (event.key !== "Tab" || !element) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]"))
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    element?.addEventListener("keydown", trapFocus);
    return () => { element?.removeEventListener("keydown", trapFocus); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  return createPortal(
    <div className="hololive-bracket-lobby-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !props.busy) props.onClose(); }}>
      <div ref={dialog} className="hololive-bracket-create-popover hololive-bracket-lobby" role="dialog" aria-modal="true" aria-label="Create bracket">
        <header className="bracket-lobby-header"><h2><Swords size={20} />New bracket</h2><button type="button" className="lobby-icon-button" aria-label="Close bracket creator" disabled={props.busy} onClick={props.onClose}><X size={18} /></button></header>
        {props.presets}
        <div className="bracket-lobby-body">
          <div className="bracket-lobby-rules">
            {props.rules}
            <div className="hololive-bracket-filter-row lobby-filter-toggle"><button type="button" className="lobby-filter-button" aria-expanded={props.filtersExpanded} disabled={props.busy} onClick={props.onToggleFilters}><SlidersHorizontal size={14} />More filters{props.activeFilters.length > 0 && <span>{props.activeFilters.length}</span>}</button><button type="button" className="lobby-icon-button" aria-label="Reset filters" disabled={props.busy} onClick={props.onReset}><RotateCcw size={14} /></button></div>
            {props.activeFilters.length > 0 && <div className="hololive-bracket-filter-chips lobby-active-filters" aria-label="Active bracket filters">{props.activeFilters.map(label => <span key={label}>{label}</span>)}</div>}
            {props.filtersExpanded && props.filters}
          </div>
          <section className="bracket-lobby-lineup" aria-label="Live entrant lineup" aria-busy={props.pending}>
            <header className="bracket-lobby-lineup-header"><h3 aria-live="polite">Lineup <span className="lobby-ready-count">{props.preview ? `${props.preview.entries.length} / ${count}` : `— / ${count}`}</span>{props.pending && <Loader2 size={13} className="spin" aria-hidden="true" />}</h3><div className="lobby-lineup-tools">{props.preview && <span className="lobby-pool-count">{props.preview.eligibleCount.toLocaleString()} eligible</span>}{props.style === "random_songs" && <button type="button" className="lobby-icon-button" aria-label="Redraw lineup" disabled={props.busy || props.pending} onClick={props.onRedraw}><Shuffle size={16} /></button>}</div></header>
            {props.error && <div role="alert" className="lobby-lineup-message"><p>{props.error}</p>{!props.invalid && <button type="button" className="lobby-text-button" onClick={props.onRetry}>Try again</button>}</div>}
            {props.preview && <>
              <div className="bracket-lobby-roster" aria-label="Entrant preview">
                <table><thead><tr><th scope="col">#</th><th scope="col">Song / talent</th><th scope="col">Views</th><th scope="col">Date</th></tr></thead><tbody>{props.preview.entries.map((entry, index) => <tr key={entry.youtubeVideoId} data-video-id={entry.youtubeVideoId}><td>{index + 1}</td><td><strong><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(entry.youtubeVideoId)}`} target="_blank" rel="noreferrer">{entry.title}</a></strong><small>{entry.idolName}</small></td><td>{entry.viewCount === null ? "—" : entry.viewCount.toLocaleString()}</td><td>{entry.dateUsed ?? "—"}</td></tr>)}</tbody></table>
              </div>
              {props.preview.entries.length < count && <p className="lobby-lineup-message" role="status">Not enough songs. Widen the filters or choose a smaller bracket.</p>}
              {props.preview.creationError && <p className="lobby-lineup-message" role="status">{props.preview.creationError}</p>}
              {props.preview.warnings.map(warning => <p className="lobby-lineup-message" role="status" key={warning.code}>{warning.message}</p>)}
              {props.preview.entries.some(entry => entry.viewCount === null) && <p className="lobby-lineup-message">Some videos have no view count.</p>}
            </>}
            {!props.preview && !props.error && <div className="lobby-lineup-empty">{props.pending ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <Swords size={22} aria-hidden="true" />}</div>}
          </section>
        </div>
        <footer className="bracket-lobby-footer"><span>{props.format === "double_elimination" ? "Double elimination" : "Single elimination"}</span><div><button type="button" className="lobby-cancel" disabled={props.busy} onClick={props.onClose}>Cancel</button><button type="button" className="lobby-create" disabled={props.busy || !ready} onClick={props.onCreate}>{props.busy ? <Loader2 size={15} className="spin" /> : <Swords size={15} />}Create Bracket</button></div></footer>
      </div>
    </div>, document.body
  );
}
