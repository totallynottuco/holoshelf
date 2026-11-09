import fs from "node:fs";
import path from "node:path";

const ROOT = "https://hololive.hololivepro.com/en/music/";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const text = html => html.replace(/<[^>]*>/g, " ").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const key = value => value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const artists = value => value.split(/\s*[,×＆&]\s*/u).map(key).filter(Boolean).sort().join("+");

export function parseOfficialMusicIndex(html) {
  const list = /<ul class="music_list[^"]*">([\s\S]*?)<\/ul>/u.exec(html)?.[1];
  if (!list) throw new Error("Official music index structure was not recognized");
  return [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gu)].flatMap(([, item]) => {
    const url = /<a\s+href="([^"]+)"/u.exec(item)?.[1], title = /<h3[^>]*>([\s\S]*?)<\/h3>/u.exec(item)?.[1], artist = /<p[^>]*>([\s\S]*?)<\/p>/u.exec(item)?.[1];
    if (!url?.startsWith(ROOT) || !title || !artist || !/^https:\/\/hololive\.hololivepro\.com\/en\/music\/[^/?#]+\/$/u.test(url)) return [];
    return [{ url, title: text(title), artist: text(artist) }];
  });
}

export function parseOfficialMusicDate(html) {
  const block = /<p class="price_release">([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? "";
  const match = /(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})(?:日|\b)/u.exec(text(block));
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}

export function matchOfficialRelease(entry, row) {
  if (row.topicId !== "Original_Song" || row.sourceKind === "user") return false;
  // Do not date a cover, live performance, translated version or alternate take
  // using the original studio single's release page.
  if (/\b(acoustic|live|remix|piano|remaster|solo\s+ver|english\s+ver|japanese\s+ver)\b|ライブ/iu.test(`${row.title} ${row.songName ?? ""}`)) return false;
  const names = (row.songName ?? row.title).split(/\s+\/\s+/u).map(key);
  if (!names.includes(key(entry.title))) return false;
  const singers = [...new Set([...(row.ownedIdolIds ?? []), ...(row.featuredIdolIds ?? [])])];
  const singerNames = singers.map(id => row.artistNames?.[id] ?? "");
  if (singerNames.every(Boolean) && artists(entry.artist) === singerNames.map(key).sort().join("+")) return true;
  return row.uploaderChannelKind === "group" && artists(entry.artist) === artists(row.channelName.replace(/^hololive\s*/iu, ""));
}

/** Public metadata only. Cache the index and matched detail pages between runs. */
export async function refreshSongReleaseCatalog(database, {cacheFile, fetcher = fetch, now = Date.now(), log = () => {}}) {
  let cache = { schema: 1, checkedAt: 0, entries: {} };
  try { const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8")); if (saved.schema === 1) cache = saved; } catch { /* First run. */ }
  let requests = 0;
  const get = async url => {
    requests++;
    const response = await fetcher(url, {signal: AbortSignal.timeout(30_000)});
    if (!response.ok) throw new Error(`Official release metadata HTTP ${response.status}`);
    return response.text();
  };
  const save = () => {
    fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
    fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache));fs.renameSync(`${cacheFile}.tmp`, cacheFile);
  };
  let complete = true;
  try {
    const full = !cache.indexComplete || now - cache.checkedAt > WEEK;
    for (let page = 1; page <= 100; page++) {
      const html = await get(page === 1 ? ROOT : `${ROOT}?paged=${page}`);
      const entries = parseOfficialMusicIndex(html);
      const known = entries.every(entry => cache.entries[entry.url]);
      for (const entry of entries) cache.entries[entry.url] = { ...cache.entries[entry.url], ...entry };
      save();
      const pages = [...html.matchAll(/(?:\?paged=|\/en\/music\/page\/)(\d+)/g)].map(match => Number(match[1]));
      const lastPage = Math.max(page, ...pages);
      if (page % 10 === 0) log(`Release-date index: ${page}/${lastPage} pages`);
      if (!entries.length || page >= lastPage) { cache.indexComplete = true; break; }
      if (!full && known) break;
      if (page === 100) throw new Error("Official release metadata exceeded page bound");
    }
    cache.checkedAt = now;
  } catch (error) { complete = false; log(`Release-date catalog discovery deferred: ${error.message}; preserving cached evidence.`); }
  const artistNames = Object.fromEntries(database.listHololiveIdols().map(idol => [idol.id, idol.displayName]));
  const ids = database.select("SELECT youtube_video_id FROM hololive_music_videos WHERE COALESCE(source_kind,'official')='official' AND COALESCE(official_catalog_active,1)=1").map(row => row.youtube_video_id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) rows.push(...database.listHololiveMusicRows({youtubeVideoIds: ids.slice(i, i + 500), limit: 500}).map(row => ({...row, artistNames})));
  // Index by title before checking artist sets; no all-pairs catalog scan.
  const byTitle = new Map();
  for (const row of rows) for (const name of (row.songName ?? row.title).split(/\s+\/\s+/u)) {
    const songKey = key(name), group = byTitle.get(songKey) ?? []; group.push(row); byTitle.set(songKey, group);
  }
  const matched = Object.values(cache.entries).flatMap(entry => {
    const matches = (byTitle.get(key(entry.title)) ?? []).filter(row => matchOfficialRelease(entry, row));
    return matches.length ? [{entry, rows: matches}] : [];
  });
  for (let i = 0; i < matched.length; i += 2) {
    await Promise.all(matched.slice(i, i + 2).map(async ({entry}) => {
      if (entry.checkedAt && now - entry.checkedAt < WEEK) return;
      try { entry.date = parseOfficialMusicDate(await get(entry.url)); entry.checkedAt = now; }
      catch (error) { complete = false; log(`Release-date page deferred: ${entry.url}: ${error.message}`); }
    }));
    save();
  }
  const facts = matched.flatMap(({entry, rows}) => entry.date ? rows.map(row => ({youtubeVideoId: row.youtubeVideoId, releaseDate: entry.date, basis: "official_release", sourceUrl: entry.url})) : []);
  database.upsertHololiveMusicReleaseDates(facts);
  save();
  return { complete, requests, indexedReleases: Object.keys(cache.entries).length, matchedDates: facts.length };
}
