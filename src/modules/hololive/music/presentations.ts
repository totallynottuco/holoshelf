import { buildNormalizedHololiveMusicKey as key, hasHololiveBroadcastEditMarker } from "./classification";
import { hasCompatibleHolodexTopicDuplicateDuration, isHololiveOfficialAudioMirror, parsePublishedAt,
  type HololiveOfficialAudioMirrorCandidate } from "./cleanup";

export interface SongUpload extends HololiveOfficialAudioMirrorCandidate {
  channelName?: string | null;
  publishedAt?: string | null;
  excluded?: boolean;
  description?: string | null;
}

const liveVideo = /\b(?:3d\s+live|live\s+(?:performance\s+)?video)\b|生歌LIVE/iu;
const performanceVideo = /\b(?:3d\s+)?(?:dance|performance|choreography)\s+(?:video|film)\b/iu;
const musicVideo = /\b(?:official[\s_-]+(?:music[\s_-]+)?video|music[\s_-]+video|mv)\b/iu;
const distinctVersion = /\b(?:acoustic|piano|remix|repaint|tour|solo|instrumental|karaoke|medley|mash[ -]?up|rehearsal|remaster(?:ed)?|re[- ]?record(?:ed|ing)?|ver(?:sion)?|edit|mix|take|cover by)\b|ライブ|アコースティック|ピアノ|歌い分け|メドレー|アレンジ|弾き語り/iu;
const presentationOrder = ["mv", "release", "audio", "advance", "performance", "live", "program"] as const;
type Format = typeof presentationOrder[number];

// Require an exact artist credit before reading a broadcaster's Artist - Song title.
// Holodex can list the artist as the channel even when a TV network uploaded it.
function creditedProgramSong(title: string, channelName: string): string | undefined {
  const credit = title.replace(/^(?:\s*\[[^\]]+\]\s*)+/u, "").split(/\s+[-–—]\s+/u);
  if (credit.length !== 2 || !channelName) return;
  const artist = key(channelName);
  const aliases = [credit[0].replace(/\([^()]+\)/gu, ""), ...Array.from(credit[0].matchAll(/\(([^()]+)\)/gu), match => match[1])];
  if (!aliases.some(alias => key(alias) === artist)) return;
  // NFKC represents the Korean vertical separator ㅣ as ᅵ.
  const segments = credit[1].split(/[|ᅵ]/u);
  if (segments.length > 1 && !/^\s*(?:ep(?:isode)?\.?\s*\d|#|\[)/iu.test(segments[1])) return;
  return segments[0].trim();
}

function describe(row: SongUpload) {
  if (!row.channelId || row.providedToYoutube || (row.songNames?.length ?? 0) > 1) return;
  const title = row.title.normalize("NFKC");
  const external = Boolean(row.originalChannelId && row.originalChannelId !== row.channelId);
  const credited = creditedProgramSong(title, row.channelName ?? "");
  const program = Boolean(credited && (external || /^\[.+?\]/u.test(title)));
  if (external && (!program || !row.participantIds?.length)) return;
  const audio = /\bofficial[\s_-]+audio\b/iu.test(title);
  const kind: Format = program ? "program" : audio ? "audio" : liveVideo.test(title) ? "live" :
    performanceVideo.test(title) ? "performance" : /先行MV|\badvance\s+mv\b/iu.test(title) ? "advance" :
    musicVideo.test(title) ? "mv" : "release";
  const song = (row.songName || row.songNames?.[0] || "").normalize("NFKC");
  const withoutFormat = title.replace(liveVideo, "").replace(performanceVideo, "");
  const metadataName = song.replace(/\s*\[(?:3d\s+)?live\]\s*$/iu, "");
  const protectedVersion = distinctVersion.test(title + " " + song) || hasHololiveBroadcastEditMarker(title + " " + song) ||
    /\b(?:live|concert)\b/iu.test(withoutFormat + " " + metadataName);
  if (protectedVersion && kind !== "audio" && kind !== "mv") return;
  // A quoted work inside a trailing source credit (e.g. an anime title) isn't the song.
  const headline = title.replace(/\([^()]*[『「][^()]*[』」][^()]*\)/gu, "");
  const quotes = [...headline.matchAll(/‘([^’]+)’|“([^”]+)”|「([^」]+)」|『([^』]+)』|"([^"\n]+)"/gu)];
  if (quotes.length > 1) return;
  const quoted = quotes[0]?.slice(1).find(Boolean);
  const inferred = program ? credited : quoted || (!song && credited) || undefined;
  const aliases = metadataName.split(/\s+\/\s+/u).map(key).filter(Boolean);
  const name = aliases[0] || key(inferred || "");
  if (!name || (inferred && aliases.length && !aliases.includes(key(inferred)))) return;
  if (row.songNames?.length && row.songName && key(row.songNames[0]) !== key(row.songName)) return;
  // An unlabeled upload needs independent song evidence in its displayed title.
  if (kind === "release" && ((!metadataName && !credited && !quoted) || !(" " + key(title) + " ").includes(" " + name + " "))) return;
  const participants = [...new Set(row.participantIds ?? [])].sort();
  const guest = /\((?:feat\.?|featuring|ft\.?)\s+([^()]+)\)/iu.exec(title + " " + song)?.[1];
  const languages = [...new Set((title + " " + song).toLowerCase().match(/\b(?:english|japanese|korean|chinese|spanish|indonesian)\b/gu))].sort();
  const group = JSON.stringify([row.topicId, row.channelId, participants, name, languages]);
  const plainTitle = key(title.replace(/^\s*(?:\[original\]|【original】)\s*/iu, ""));
  const songHeadline = key(title.replace(performanceVideo, "").replace(musicVideo, "").replace(liveVideo, ""));
  const movieCredit = /^\s*(?:movie|animation|映像|動画制作)\s*[-:：]/imu.test(row.description ?? "");
  return { row, group, kind, plainTitle, movieCredit, protectedVersion, songHeadline, guest: key(guest || ""), aliases };
}

/** Each alternate points directly to a playable representative it matched itself. */
export function planSongPresentations(rows: readonly SongUpload[]) {
  type Entry = NonNullable<ReturnType<typeof describe>>;
  const groups = new Map<string, Entry[]>();
  for (const row of rows) {
    const entry = describe(row);
    if (!entry) continue;
    const group = groups.get(entry.group);
    if (group) group.push(entry);
    else groups.set(entry.group, [entry]);
  }
  const matches: Array<{ removed: SongUpload; kept: SongUpload; reason: string }> = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => presentationOrder.indexOf(a.kind) - presentationOrder.indexOf(b.kind) ||
      Number(b.movieCredit) - Number(a.movieCredit) ||
      parsePublishedAt(a.row.publishedAt) - parsePublishedAt(b.row.publishedAt) || a.row.youtubeVideoId.localeCompare(b.row.youtubeVideoId));
    const representatives: Entry[] = [];
    for (const alternate of group) {
      const kept = representatives.find(rep => {
        if (alternate.kind === "audio") return isHololiveOfficialAudioMirror(alternate.row, rep.row);
        if (alternate.protectedVersion || rep.protectedVersion || alternate.row.excluded ||
            alternate.guest !== rep.guest ||
            (alternate.aliases.length > 1 && rep.aliases.length > 1 && alternate.aliases.join("/") !== rep.aliases.join("/") &&
              alternate.songHeadline !== rep.songHeadline) ||
            (alternate.kind === rep.kind && ["release", "mv"].includes(rep.kind) && rep.plainTitle !== alternate.plainTitle)) return false;
        return hasCompatibleHolodexTopicDuplicateDuration(rep.row.durationSeconds ?? 0, alternate.row.durationSeconds ?? 0);
      });
      if (kept) matches.push({ removed: alternate.row, kept: kept.row,
        reason: alternate.kind === "audio" ? "official_audio_duplicate_of_mv" : "canonical_variant_duplicate_of_full" });
      else if (!alternate.row.excluded) representatives.push(alternate);
    }
  }
  return matches;
}
