import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Pin, RotateCcw, Shuffle, SlidersHorizontal, Swords, X } from "lucide-react";
import type { HololiveBracketReservation, HololiveBracketSelectionPreview, HololiveBracketSize } from "../../shared/contracts";
import "./HololiveBracketLobby.css";

interface Props {
  rules: ReactNode;
  filters: ReactNode;
  filtersExpanded: boolean;
  extraCount: number;
  name: ReactNode;
  presets: ReactNode;
  preview: HololiveBracketSelectionPreview | null;
  reservedVideoIds: ReadonlySet<string>;
  onToggleReservation: (song: HololiveBracketReservation) => void;
  onClearReservations: () => void;
  pending: boolean;
  error: string | null;
  invalid: boolean;
  busy: boolean;
  size: HololiveBracketSize;
  canRedraw: boolean;
  onToggleFilters: () => void;
  onReset: () => void;
  onRedraw: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onClose: () => void;
}

export function HololiveBracketLobby(props: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const reserveButton = useRef<HTMLButtonElement>(null);
  const [selectionOrder, setSelectionOrder] = useState<ReadonlyMap<string, number> | null>(null);
  const selecting = selectionOrder !== null;
  const count = Number(props.size.slice(2));
  const ready = !!props.preview && props.preview.entries.length === count && !props.preview.creationError && !props.pending && !props.error;
  const entries = useMemo(() => {
    const songs = props.preview?.entries ?? [];
    if (!selectionOrder) return songs;
    // The live preview moves reserved songs to the top. Keep rows in place while picking.
    return songs.slice().sort((a, b) =>
      (selectionOrder.get(a.youtubeVideoId) ?? selectionOrder.size) -
      (selectionOrder.get(b.youtubeVideoId) ?? selectionOrder.size));
  }, [props.preview, selectionOrder]);
  const canStartSelection = !props.pending && !props.error && entries.length > 0;
  const hiddenReservation = !!props.preview?.creationError && props.reservedVideoIds.size > 0
    && !entries.some(entry => props.reservedVideoIds.has(entry.youtubeVideoId));
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.querySelector<HTMLButtonElement>('[aria-label="Close bracket creator"]')?.focus();
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
      const controls = Array.from(element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary"))
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
        <header className="bracket-lobby-header">
          <h2><Swords size={20} />New bracket</h2>
          <div className="lobby-header-actions">
            <button type="button" className="lobby-icon-button" aria-label="Reset filters" disabled={props.busy} onClick={props.onReset}><RotateCcw size={14} /></button>
            <button type="button" className="lobby-icon-button" aria-label="Close bracket creator" disabled={props.busy} onClick={props.onClose}><X size={18} /></button>
          </div>
        </header>
        {props.presets}
        <div className="bracket-lobby-body">
          <div className="bracket-lobby-rules">
            {props.rules}
            <div className="hololive-bracket-filter-row lobby-filter-toggle">
              <button type="button" className="lobby-filter-button" aria-expanded={props.filtersExpanded} aria-controls="bracket-lobby-extras" disabled={props.busy} onClick={props.onToggleFilters}>
                <SlidersHorizontal size={14} />Extra options
                {props.extraCount > 0 && <span>{props.extraCount}</span>}
                <ChevronDown className="lobby-filter-chevron" size={14} aria-hidden="true" />
              </button>
            </div>
            <div id="bracket-lobby-extras" hidden={!props.filtersExpanded}>{props.filtersExpanded && props.filters}</div>
          </div>
          <section className="bracket-lobby-lineup" aria-label="Live entrant lineup" aria-busy={props.pending}
            onKeyDown={event => {
              if (event.key !== "Escape" || !selecting) return;
              event.stopPropagation();
              setSelectionOrder(null);
              reserveButton.current?.focus();
            }}>
            <header className="bracket-lobby-lineup-header">
              <div className="lobby-lineup-summary">
                <h3 aria-live="polite">
                  Lineup <span className="lobby-ready-count">{props.preview && (!props.pending || selecting) ? entries.length : "—"} / {count}</span>
                  {props.pending && !selecting && <Loader2 size={13} className="spin" aria-hidden="true" />}
                </h3>
                <span className="lobby-pool-count">{props.preview && `${props.preview.eligibleCount.toLocaleString()} eligible`}</span>
              </div>
              <div className="lobby-lineup-actions">
                {props.canRedraw && <button type="button" className="lobby-icon-button" aria-label="Redraw lineup" disabled={props.busy || props.pending} onClick={() => {
                  setSelectionOrder(null);
                  props.onRedraw();
                }}><Shuffle size={16} /></button>}
                <button ref={reserveButton} type="button" className="lobby-reserve-button" data-selecting={selecting}
                  aria-label={selecting ? "Done selecting songs" : "Reserve songs"}
                  aria-disabled={!selecting && !canStartSelection} disabled={props.busy}
                  onClick={() => {
                    if (selecting) setSelectionOrder(null);
                    else if (canStartSelection) setSelectionOrder(new Map(entries.map((entry, index) => [entry.youtubeVideoId, index])));
                  }}>
                  {selecting ? <><Check size={13} aria-hidden="true" />Done</> : <><Pin size={13} aria-hidden="true" />Reserve</>}
                </button>
              </div>
            </header>
            {props.error && <div role="alert" className="lobby-lineup-message"><p>{props.error}</p>{!props.invalid && <button type="button" className="lobby-text-button" onClick={props.onRetry}>Try again</button>}</div>}
            {props.preview && <>
              <div className="bracket-lobby-roster" data-selecting={selecting} aria-label="Entrant preview">
                <table>
                  <thead><tr><th scope="col" aria-label={selecting ? "Keep song" : "Position"}>{selecting ? <Pin size={12} aria-hidden="true" /> : "#"}</th><th scope="col">Song / talent</th><th scope="col">Views</th><th scope="col">Date</th></tr></thead>
                  <tbody>{entries.map((entry, index) => {
                    const reserved = props.reservedVideoIds.has(entry.youtubeVideoId);
                    const toggle = () => props.onToggleReservation({ youtubeVideoId: entry.youtubeVideoId, idolId: entry.idolId });
                    return <tr key={entry.youtubeVideoId} data-video-id={entry.youtubeVideoId}
                      className={reserved ? "lobby-reserved-entry" : undefined}
                      onClick={selecting && !props.busy ? toggle : undefined}>
                      <td><span className="lobby-roster-choice">
                        {selecting ? <>
                          <input type="checkbox" aria-label={`Keep ${entry.title}`} checked={reserved}
                            disabled={props.busy} onClick={event => event.stopPropagation()} onChange={toggle} />
                          <Check className="lobby-roster-checkmark" size={11} strokeWidth={2.6} aria-hidden="true" />
                        </>
                          : reserved ? <span role="img" aria-label="Kept"><Pin size={12} /></span> : index + 1}
                      </span></td>
                      <td>
                        <strong>{selecting ? entry.title : <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(entry.youtubeVideoId)}`} target="_blank" rel="noreferrer">{entry.title}</a>}</strong>
                        <small>{entry.idolName}</small>
                      </td>
                      <td>{entry.viewCount === null ? "—" : entry.viewCount.toLocaleString()}</td><td>{entry.dateUsed ?? "—"}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {!props.pending && <>
                {props.preview.entries.length < count && !props.preview.creationError && <p className="lobby-lineup-message" role="status">Not enough songs. Widen the filters or choose a smaller bracket.</p>}
                {props.preview.creationError && <div className="lobby-lineup-message">
                  <p role="status">{props.preview.creationError}</p>
                  {hiddenReservation && <button type="button" className="lobby-text-button" disabled={props.busy} onClick={props.onClearReservations}>Clear kept songs</button>}
                </div>}
                {props.preview.warnings.map(warning => <p className="lobby-lineup-message" role="status" key={warning.code}>{warning.message}</p>)}
                {props.preview.entries.some(entry => entry.viewCount === null) && <p className="lobby-lineup-message">Some videos have no view count.</p>}
              </>}
            </>}
            {!props.preview && !props.error && <div className="lobby-lineup-empty">{props.pending ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <Swords size={22} aria-hidden="true" />}</div>}
          </section>
        </div>
        <footer className="bracket-lobby-footer">
          <div className="lobby-bracket-name">{props.name}</div>
          <div><button type="button" className="lobby-cancel" disabled={props.busy} onClick={props.onClose}>Cancel</button><button type="button" className="lobby-create" disabled={props.busy || !ready} onClick={props.onCreate}>{props.busy ? <Loader2 size={15} className="spin" /> : <Swords size={15} />}Create Bracket</button></div>
        </footer>
      </div>
    </div>, document.body
  );
}
