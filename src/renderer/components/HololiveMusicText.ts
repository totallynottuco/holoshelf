import type { HololiveMusicResolvedItem, HololiveMusicRow } from "../../shared/contracts";

const SONG_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatHololiveSongDate(value?: string | null): string {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return SONG_DATE_FORMATTER.format(new Date(timestamp));
}

export function formatHololiveDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const totalSeconds = Math.round(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function formatHololiveViewCount(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "";
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(millions);
    return `${formatted}M views`;
  }

  return `${INTEGER_FORMATTER.format(Math.round(value))} views`;
}

export function hololiveMusicRowTitle(
  row: HololiveMusicRow | null | undefined,
  fallback = "Unavailable song"
): string {
  return row?.songName || row?.title || fallback;
}

export function hololiveResolvedItemTitle(
  item: HololiveMusicResolvedItem | null | undefined,
  fallback = "Nothing selected"
): string {
  return hololiveMusicRowTitle(item?.music, item?.titleSnapshot || fallback);
}

export function hololiveResolvedItemMeta(item: HololiveMusicResolvedItem): string {
  if (!item.music) {
    return "Unavailable";
  }

  return [
    item.music.channelName,
    formatHololiveSongDate(item.music.publishedAt),
    formatHololiveDuration(item.music.durationSeconds),
    formatHololiveViewCount(item.music.viewCount)
  ]
    .filter(Boolean)
    .join(" / ");
}

export function hololiveMusicMetaParts(music: HololiveMusicRow | null | undefined) {
  if (!music) {
    return null;
  }

  return {
    channelName: music.channelName,
    date: formatHololiveSongDate(music.publishedAt),
    duration: formatHololiveDuration(music.durationSeconds),
    views: formatHololiveViewCount(music.viewCount)
  };
}
