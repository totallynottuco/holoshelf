import { Check } from "lucide-react";
import type { HololiveMusicPlayerData } from "../../shared/contracts";

type HololivePlaylist = HololiveMusicPlayerData["playlists"][number];

export function playlistHasVideo(playlist: HololivePlaylist, youtubeVideoId?: string | null): boolean {
  const id = youtubeVideoId?.trim();
  return Boolean(id && playlist.items?.some((entry) => entry.youtubeVideoId === id));
}

function PlaylistMembershipIndicator({ active }: { active: boolean }) {
  return active ? (
    <span className="hololive-playlist-membership active" aria-label="Already in playlist">
      <Check size={11} aria-hidden="true" />
    </span>
  ) : (
    <span className="hololive-playlist-membership" aria-hidden="true" />
  );
}

export function HololivePlaylistMenu({
  ariaLabel,
  className,
  dataMiniPopover = false,
  disabled = false,
  emptyText,
  onSelect,
  playlists,
  youtubeVideoId
}: {
  ariaLabel: string;
  className: string;
  dataMiniPopover?: boolean;
  disabled?: boolean;
  emptyText?: string;
  onSelect: (playlistId: string) => void;
  playlists: HololivePlaylist[];
  youtubeVideoId?: string | null;
}) {
  return (
    <div
      className={`${className} hololive-playlist-menu`}
      data-mini-popover={dataMiniPopover ? true : undefined}
      role="menu"
      aria-label={ariaLabel}
    >
      {playlists.length === 0 && emptyText ? <span>{emptyText}</span> : null}
      {playlists.map((playlist) => {
        const active = playlistHasVideo(playlist, youtubeVideoId);
        return (
          <button
            key={playlist.id}
            className={active ? "in-playlist" : undefined}
            type="button"
            role="menuitemcheckbox"
            aria-checked={active}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(playlist.id);
            }}
            title={active ? `Remove from ${playlist.name}` : `Add to ${playlist.name}`}
          >
            <span>{playlist.name}</span>
            <PlaylistMembershipIndicator active={active} />
            <strong>{playlist.itemCount}</strong>
          </button>
        );
      })}
    </div>
  );
}
