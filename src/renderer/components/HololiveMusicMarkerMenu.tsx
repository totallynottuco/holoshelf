import { Trash2 } from "lucide-react";
import type { HololiveMusicMarker } from "../../shared/contracts";
import { MUSIC_MARKERS, MusicMarkerIcon } from "./HololiveMusicMarker";

export function HololiveMusicMarkerMenu({
  ariaLabel,
  className,
  confirmAriaLabel,
  confirmingExclude,
  dataMiniPopover = false,
  disabled = false,
  marker,
  onConfirmingExcludeChange,
  onExclude,
  onSetMarker
}: {
  ariaLabel: string;
  className: string;
  confirmAriaLabel: string;
  confirmingExclude: boolean;
  dataMiniPopover?: boolean;
  disabled?: boolean;
  marker?: HololiveMusicMarker | null;
  onConfirmingExcludeChange: (confirming: boolean) => void;
  onExclude?: () => void;
  onSetMarker: (marker: HololiveMusicMarker | null) => void;
}) {
  return (
    <div
      className={`${className} hololive-marker-menu`}
      data-mini-popover={dataMiniPopover ? true : undefined}
      role="menu"
      aria-label={ariaLabel}
    >
      {confirmingExclude ? (
        <div className="hololive-song-marker-confirm" role="group" aria-label={confirmAriaLabel}>
          <span>Exclude this song permanently?</span>
          <div>
            <button
              className="danger"
              type="button"
              role="menuitem"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onExclude?.();
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onConfirmingExcludeChange(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {MUSIC_MARKERS.map((markerDefinition) => (
            <button
              key={markerDefinition.value}
              className={`${markerDefinition.value} ${marker === markerDefinition.value ? "active" : ""}`}
              type="button"
              role="menuitemradio"
              aria-checked={marker === markerDefinition.value}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onSetMarker(marker === markerDefinition.value ? null : markerDefinition.value);
              }}
              title={markerDefinition.label}
            >
              <MusicMarkerIcon marker={markerDefinition.value} />
              <span>{markerDefinition.label}</span>
            </button>
          ))}
          {onExclude ? (
            <button
              className="exclude"
              type="button"
              role="menuitem"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onConfirmingExcludeChange(true);
              }}
              title="Exclude this song permanently"
            >
              <Trash2 size={13} aria-hidden="true" />
              <span>Exclude</span>
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
