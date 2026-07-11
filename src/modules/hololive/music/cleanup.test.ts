import { describe, expect, it } from "vitest";
import { buildHololiveMusicSongKey } from "./classification";
import { buildDuplicateTitleCore, cleanupCatalogRows, normalizeVideoDetail } from "./cleanup";
import type { HolodexCatalogRow, HolodexVideoDetail, HolodexVideoRecord } from "./types";

function row(input: Partial<HolodexCatalogRow> & Pick<HolodexCatalogRow, "youtubeVideoId" | "title">): HolodexCatalogRow {
  return {
    youtubeVideoId: input.youtubeVideoId,
    youtubeUrl: input.youtubeUrl ?? `https://www.youtube.com/watch?v=${input.youtubeVideoId}`,
    title: input.title,
    status: input.status ?? "past",
    topicId: input.topicId ?? "Original_Song",
    channelName: input.channelName ?? "Talent Ch.",
    publishedAt: input.publishedAt ?? "2026-01-01T00:00:00.000Z"
  };
}

function detail(input: Partial<HolodexVideoDetail> & Pick<HolodexVideoDetail, "youtubeVideoId">): HolodexVideoDetail {
  return normalizeVideoDetail(input.youtubeVideoId, {
    youtubeVideoId: input.youtubeVideoId,
    channelId: input.channelId ?? "channel",
    duration: input.duration ?? 180,
    originalChannelId: input.originalChannelId ?? "",
    providedToYoutube: input.providedToYoutube ?? false,
    songNames: input.songNames ?? []
  });
}

describe("Holodex cleanup rules", () => {
  it("filters missing, short, preview, remix, instrumental, and vocal-only rows", () => {
    const rows = [
      row({ youtubeVideoId: "ok", title: "Full Song" }),
      row({ youtubeVideoId: "missing", title: "Gone", status: "missing" }),
      row({ youtubeVideoId: "short", title: "Tiny Song" }),
      row({ youtubeVideoId: "under-90", title: "Almost Full Song" }),
      row({ youtubeVideoId: "exact-90", title: "Ninety Second Song" }),
      row({ youtubeVideoId: "preview", title: "Song preview" }),
      row({ youtubeVideoId: "crossfade", title: "Acoustic Cover Album Crossfade" }),
      row({ youtubeVideoId: "remix", title: "Song remix" }),
      row({ youtubeVideoId: "inst", title: "Song instrumental" }),
      row({ youtubeVideoId: "inst-ver", title: "Song inst ver" }),
      row({ youtubeVideoId: "off-vocal", title: "Song (Karaoke Off-Vocal)" }),
      row({ youtubeVideoId: "on-vocal", title: "Song (Karaoke On-Vocal)" }),
      row({ youtubeVideoId: "karaoke", title: "Song Karaoke Edition" }),
      row({ youtubeVideoId: "false-instant", title: "Instant Heaven" })
    ];
    const details = Object.fromEntries(
      [
        detail({ youtubeVideoId: "ok", duration: 180 }),
        detail({ youtubeVideoId: "missing", duration: 180 }),
        detail({ youtubeVideoId: "short", duration: 59 }),
        detail({ youtubeVideoId: "under-90", duration: 89 }),
        detail({ youtubeVideoId: "exact-90", duration: 90 }),
        detail({ youtubeVideoId: "preview", duration: 180 }),
        detail({ youtubeVideoId: "crossfade", duration: 180 }),
        detail({ youtubeVideoId: "remix", duration: 180 }),
        detail({ youtubeVideoId: "inst", duration: 180 }),
        detail({ youtubeVideoId: "inst-ver", duration: 180 }),
        detail({ youtubeVideoId: "off-vocal", duration: 180 }),
        detail({ youtubeVideoId: "on-vocal", duration: 180 }),
        detail({ youtubeVideoId: "karaoke", duration: 180 }),
        detail({ youtubeVideoId: "false-instant", duration: 180 })
      ].map((entry) => [entry.youtubeVideoId, entry])
    );

    const result = cleanupCatalogRows(rows, {}, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["ok", "exact-90", "false-instant"]);
    expect(result.removedByBaseRules).toBe(11);
  });

  it("filters obvious compilation, BGM mix, and soundtrack rows", () => {
    const rows = [
      row({ youtubeVideoId: "song", title: "[Official MV] Real Song" }),
      row({ youtubeVideoId: "medley", title: "hololive Medley mix by Batsu" }),
      row({ youtubeVideoId: "bgm", title: "hololive music studio - lofi & chill mix" }),
      row({ youtubeVideoId: "plain-bgm", title: "Original BGM Loop" }),
      row({ youtubeVideoId: "attached-bgm", title: "Among us memeBGM?" }),
      row({ youtubeVideoId: "lofi-version", title: "Guh (Lofi Ver.)" }),
      row({ youtubeVideoId: "lo-fi-version", title: "Everlasting knife (Lo-fi ver.)" }),
      row({ youtubeVideoId: "midnight-version", title: "Song (Midnight ver.)" }),
      row({ youtubeVideoId: "bouquet-version", title: "Song (Bouquet ver.)" }),
      row({ youtubeVideoId: "twilight-version", title: "Song (Twilight ver.)" }),
      row({ youtubeVideoId: "daybreak-version", title: "\u6d77\u60f3\u5217\u8eca (Daybreak ver.)" }),
      row({ youtubeVideoId: "remastered-version", title: "RED HEART (Remastered)" }),
      row({ youtubeVideoId: "remastered-ver-version", title: "High Tide (Remastered ver.)" }),
      row({ youtubeVideoId: "solo-version", title: "\u77ac\u9593\u30cf\u30fc\u30c8\u30d3\u30fc\u30c8 (\u4e00\u6761\u8389\u3005\u83ef SOLO ver.)" }),
      row({ youtubeVideoId: "solo-lower-version", title: "\u30bb\u30ab\u30a4\u306e\u8272\u5f69 (AZKi solo ver.)" }),
      row({ youtubeVideoId: "promo-mv", title: "\u300eRED HEART\u300f1st\u30aa\u30ea\u30b8\u30ca\u30eb\u30bd\u30f3\u30b0-\u5ba3\u4f1dMV-" }),
      row({ youtubeVideoId: "daybreak-frontline", title: "DAYBREAK FRONTLINE" }),
      row({ youtubeVideoId: "false-promotion", title: "Promotion Day" }),
      row({ youtubeVideoId: "song-name-variant", title: "Plain Display Title" }),
      row({ youtubeVideoId: "song-name-twilight-variant", title: "Another Plain Display Title" }),
      row({ youtubeVideoId: "song-name-solo-variant", title: "Third Plain Display Title" }),
      row({ youtubeVideoId: "soundtrack", title: "Hololive English -Myth- Image Soundtrack (Release PV)" })
    ];
    const details = Object.fromEntries(
      rows.map((entry) => [
        entry.youtubeVideoId,
        detail({
          youtubeVideoId: entry.youtubeVideoId,
          duration: 180,
          songNames: [
            entry.youtubeVideoId === "song-name-variant"
              ? "Plain Display Title (Bouquet ver.)"
              : entry.youtubeVideoId === "song-name-twilight-variant"
                ? "Another Plain Display Title (Twilight ver.)"
                : entry.youtubeVideoId === "song-name-solo-variant"
                  ? "\u77ac\u9593\u30cf\u30fc\u30c8\u30d3\u30fc\u30c8 (\u4e00\u6761\u8389\u3005\u83ef SOLO ver.)"
                : entry.title
          ]
        })
      ])
    );

    const result = cleanupCatalogRows(rows, {}, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["song", "daybreak-frontline", "false-promotion"]);
    expect(result.removedByBaseRules).toBe(19);
    expect(buildHololiveMusicSongKey({ songName: "\u6d77\u60f3\u5217\u8eca (Daybreak ver.)" })).toBe(
      buildHololiveMusicSongKey({ songName: "\u6d77\u60f3\u5217\u8eca" })
    );
    expect(buildHololiveMusicSongKey({ songName: "High Tide (Remastered ver.)" })).toBe(
      buildHololiveMusicSongKey({ songName: "High Tide" })
    );
    expect(buildHololiveMusicSongKey({ songName: "Kamouflage [3D Live]" })).toBe(
      buildHololiveMusicSongKey({ songName: "Kamouflage" })
    );
    expect(buildHololiveMusicSongKey({ songName: "\u30bb\u30ab\u30a4\u306e\u8272\u5f69 (AZKi solo ver.)" })).toBe(
      buildHololiveMusicSongKey({ songName: "\u30bb\u30ab\u30a4\u306e\u8272\u5f69" })
    );
    expect(buildHololiveMusicSongKey({ songName: "DAYBREAK FRONTLINE" })).toBe("daybreak frontline");
  });

  it("filters non-song variants without dropping similar normal words", () => {
    const rows = [
      row({ youtubeVideoId: "song", title: "[Official MV] Real Song" }),
      row({ youtubeVideoId: "behind", title: "DO U - Without Music Version (Behind The Scenes)" }),
      row({ youtubeVideoId: "making", title: "Song Making Of" }),
      row({ youtubeVideoId: "demo", title: "\u3010demo\u3011Flagrance" }),
      row({ youtubeVideoId: "false-demon", title: "Demon Lord" })
    ];
    const details = Object.fromEntries(
      rows.map((entry) => [
        entry.youtubeVideoId,
        detail({ youtubeVideoId: entry.youtubeVideoId, duration: 180, songNames: [entry.title] })
      ])
    );

    const result = cleanupCatalogRows(rows, {}, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["song", "false-demon"]);
    expect(result.removedByBaseRules).toBe(3);
  });

  it("removes topic auto-upload duplicates when a non-topic official video exists", () => {
    const rows = [
      row({
        youtubeVideoId: "official",
        title: "[Official MV] Stellar Stellar / Hoshimachi Suisei",
        topicId: "Original_Song",
        publishedAt: "2021-01-01T00:00:00.000Z"
      }),
      row({
        youtubeVideoId: "topic",
        title: "Stellar Stellar",
        topicId: "Original_Song",
        publishedAt: "2021-01-02T00:00:00.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      official: { channelId: "suisei" } as HolodexVideoRecord,
      topic: { channelId: "suisei-topic" } as HolodexVideoRecord
    };
    const details = {
      official: detail({ youtubeVideoId: "official", channelId: "suisei", songNames: ["Stellar Stellar"] }),
      topic: detail({
        youtubeVideoId: "topic",
        channelId: "suisei-topic",
        originalChannelId: "suisei",
        providedToYoutube: true,
        songNames: ["Stellar Stellar"]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["official"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "topic",
        keptYoutubeVideoId: "official",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("removes topic duplicates with noisy group suffixes when the official upload has overlapping performers", () => {
    const rows = [
      row({
        youtubeVideoId: "official",
        title: "\u3010MV\u3011Run Back 'Round\u3010hololive English -Promise- Original Song\u3011",
        topicId: "Original_Song",
        publishedAt: "2026-01-01T00:00:00.000Z"
      }),
      row({
        youtubeVideoId: "topic",
        title: "Run Back 'Round",
        topicId: "Original_Song",
        publishedAt: "2026-01-02T00:00:00.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      official: { channelId: "hololive-english" } as HolodexVideoRecord,
      topic: { channelId: "irys-topic" } as HolodexVideoRecord
    };
    const details = {
      official: normalizeVideoDetail("official", {
        youtubeVideoId: "official",
        channelId: "hololive-english",
        duration: 186,
        songNames: ["Run Back 'Round"],
        mentions: [{ channelId: "irys", name: "IRyS", englishName: "IRyS", type: "vtuber", photoUrl: "", org: "Hololive" }]
      }),
      topic: normalizeVideoDetail("topic", {
        youtubeVideoId: "topic",
        channelId: "irys-topic",
        originalChannelId: "topic-original-owner",
        providedToYoutube: true,
        duration: 188,
        songNames: ["Run Back 'Round (-Promise-)"],
        mentions: [{ channelId: "irys", name: "IRyS", englishName: "IRyS", type: "vtuber", photoUrl: "", org: "Hololive" }]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["official"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "topic",
        keptYoutubeVideoId: "official",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("removes provider topic mirrors of official talent uploads with slightly different durations", () => {
    const rows = [
      row({
        youtubeVideoId: "kPqmld3_lSs",
        title: "BEEP BEEP / Hoshimatic Project (official)",
        topicId: "Original_Song",
        channelId: "suisei-main",
        channelName: "Suisei Channel",
        publishedAt: "2026-04-17T12:00:06.000Z"
      }),
      row({
        youtubeVideoId: "Hew0tgd9Ipg",
        title: "BEEP BEEP",
        topicId: "Original_Song",
        channelId: "hololive-group",
        channelName: "hololive ホロライブ - VTuber Group",
        publishedAt: "2026-04-17T15:01:10.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      kPqmld3_lSs: { channelId: "suisei-main", duration: 209 } as HolodexVideoRecord,
      Hew0tgd9Ipg: { channelId: "hololive-group", duration: 193 } as HolodexVideoRecord
    };
    const details = {
      kPqmld3_lSs: normalizeVideoDetail("kPqmld3_lSs", {
        youtubeVideoId: "kPqmld3_lSs",
        channelId: "suisei-main",
        duration: 209,
        songNames: ["BEEP BEEP"],
        mentions: [{ channelId: "suisei-main", name: "Hoshimachi Suisei", englishName: "", type: "vtuber", photoUrl: "", org: "Hololive" }]
      }),
      Hew0tgd9Ipg: normalizeVideoDetail("Hew0tgd9Ipg", {
        youtubeVideoId: "Hew0tgd9Ipg",
        channelId: "hololive-group",
        originalChannelId: "provider-topic-owner",
        providedToYoutube: true,
        duration: 193,
        songNames: ["BEEP BEEP"],
        mentions: [{ channelId: "suisei-main", name: "Hoshimachi Suisei", englishName: "", type: "vtuber", photoUrl: "", org: "Hololive" }]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["kPqmld3_lSs"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "Hew0tgd9Ipg",
        keptYoutubeVideoId: "kPqmld3_lSs",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("removes topic duplicates when the official upload only has an artist-prefixed title", () => {
    const rows = [
      row({
        youtubeVideoId: "qTr2x78_u4k",
        title: "\u3010Original Song\u3011 Moona Hoshinova - Taut Hati\u3010Official Animated MV\u3011",
        topicId: "Original_Song",
        channelId: "moona-main",
        channelName: "Moona Hoshinova hololive-ID",
        publishedAt: "2024-01-06T14:00:08.000Z"
      }),
      row({
        youtubeVideoId: "XawCyDAz0Ic",
        title: "Taut Hati",
        topicId: "Original_Song",
        channelId: "moona-main",
        channelName: "Moona Hoshinova hololive-ID",
        publishedAt: "2024-01-05T15:00:32.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      qTr2x78_u4k: { channelId: "moona-main" } as HolodexVideoRecord,
      XawCyDAz0Ic: { channelId: "moona-main" } as HolodexVideoRecord
    };
    const details = {
      qTr2x78_u4k: normalizeVideoDetail("qTr2x78_u4k", {
        youtubeVideoId: "qTr2x78_u4k",
        channelId: "moona-main",
        duration: 224,
        songNames: []
      }),
      XawCyDAz0Ic: normalizeVideoDetail("XawCyDAz0Ic", {
        youtubeVideoId: "XawCyDAz0Ic",
        channelId: "moona-main",
        originalChannelId: "moona-topic-owner",
        providedToYoutube: true,
        duration: 218,
        songNames: ["Taut Hati"]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(buildDuplicateTitleCore(rows[0].title, { channelName: rows[0].channelName })).toBe("taut hati");
    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["qTr2x78_u4k"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "XawCyDAz0Ic",
        keptYoutubeVideoId: "qTr2x78_u4k",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("matches topic duplicates against alternate bilingual song-name segments", () => {
    const rows = [
      row({
        youtubeVideoId: "official",
        title: "\u3010MV\u3011\u672a\u6765\u5cf6 ~Future Island~ / Mori Calliope",
        topicId: "Original_Song",
        channelId: "calli-main",
        channelName: "Mori Calliope Ch. hololive-EN",
        publishedAt: "2024-02-01T00:00:00.000Z"
      }),
      row({
        youtubeVideoId: "topic",
        title: "Future Island",
        topicId: "Original_Song",
        channelId: "calli-topic",
        channelName: "Mori Calliope - Topic",
        publishedAt: "2024-02-02T00:00:00.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      official: { channelId: "calli-main" } as HolodexVideoRecord,
      topic: { channelId: "calli-topic" } as HolodexVideoRecord
    };
    const details = {
      official: normalizeVideoDetail("official", {
        youtubeVideoId: "official",
        channelId: "calli-main",
        duration: 204,
        songNames: ["\u672a\u6765\u5cf6 / Future Island"]
      }),
      topic: normalizeVideoDetail("topic", {
        youtubeVideoId: "topic",
        channelId: "calli-topic",
        originalChannelId: "calli-main",
        providedToYoutube: true,
        duration: 202,
        songNames: ["Future Island"]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["official"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "topic",
        keptYoutubeVideoId: "official",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("keeps short numeric song titles useful for duplicate matching", () => {
    const rows = [
      row({
        youtubeVideoId: "official",
        title: "\u3010Original Song\u3011100% feat Nerissa Ravencroft\u3010Moona Hoshinova\u3011",
        topicId: "Original_Song",
        channelId: "moona-main",
        channelName: "Moona Hoshinova hololive-ID",
        publishedAt: "2025-01-01T00:00:00.000Z"
      }),
      row({
        youtubeVideoId: "topic",
        title: "100%",
        topicId: "Original_Song",
        channelId: "moona-main",
        channelName: "Moona Hoshinova hololive-ID",
        publishedAt: "2025-01-02T00:00:00.000Z"
      })
    ];
    const records: Record<string, HolodexVideoRecord> = {
      official: { channelId: "moona-main" } as HolodexVideoRecord,
      topic: { channelId: "moona-main" } as HolodexVideoRecord
    };
    const details = {
      official: normalizeVideoDetail("official", {
        youtubeVideoId: "official",
        channelId: "moona-main",
        duration: 247,
        songNames: ["100% (feat. Nerissa Ravencroft)"]
      }),
      topic: normalizeVideoDetail("topic", {
        youtubeVideoId: "topic",
        channelId: "moona-main",
        originalChannelId: "moona-topic-owner",
        providedToYoutube: true,
        duration: 247,
        songNames: ["100%"]
      })
    };

    const result = cleanupCatalogRows(rows, records, details);

    expect(result.rows.map((entry) => entry.youtubeVideoId)).toEqual(["official"]);
    expect(result.duplicateRemovals).toMatchObject([
      {
        removedYoutubeVideoId: "topic",
        keptYoutubeVideoId: "official",
        reason: "topic_duplicate_of_non_topic"
      }
    ]);
  });

  it("handles Japanese preview markers and Japanese bracket title cores", () => {
    const result = cleanupCatalogRows(
      [row({ youtubeVideoId: "jp-preview", title: "新曲 試聴動画" })],
      {},
      { "jp-preview": detail({ youtubeVideoId: "jp-preview", duration: 180 }) }
    );

    expect(result.rows).toHaveLength(0);
    expect(result.removedByBaseRules).toBe(1);
    expect(buildDuplicateTitleCore("【Official MV】Stellar Stellar / Hoshimachi Suisei")).toBe("stellar stellar");
  });
});
