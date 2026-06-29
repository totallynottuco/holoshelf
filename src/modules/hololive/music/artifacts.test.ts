import { describe, expect, it } from "vitest";
import {
  parseHolodexDetailCacheJson,
  parseHolodexDuplicateReportCsv,
  parseHolodexVideosCsv
} from "./artifacts";

describe("Holodex artifact parsing", () => {
  it("parses videos CSV rows", () => {
    const rows = parseHolodexVideosCsv(
      [
        "youtube_video_id,youtube_url,title,status,topic_id,channel_name,published_at",
        "abc,https://www.youtube.com/watch?v=abc,Stellar Stellar,past,Original_Song,Suisei Ch.,2026-01-01T00:00:00.000Z"
      ].join("\n")
    );

    expect(rows).toEqual([
      {
        youtubeVideoId: "abc",
        youtubeUrl: "https://www.youtube.com/watch?v=abc",
        title: "Stellar Stellar",
        status: "past",
        topicId: "Original_Song",
        channelName: "Suisei Ch.",
        publishedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
  });

  it("parses detail cache JSON and duplicate report CSV", () => {
    const details = parseHolodexDetailCacheJson(
      JSON.stringify({
        abc: {
          youtube_video_id: "abc",
          channel_id: "channel",
          duration: 180,
          original_channel_id: "topic-owner",
          provided_to_youtube: true,
          song_names: ["Song"]
        }
      })
    );
    const duplicates = parseHolodexDuplicateReportCsv(
      [
        "removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,song_name,removed_published_at,kept_published_at",
        "topic,Topic Song,official,Official Song,topic_duplicate_of_non_topic,Song,2026-01-02T00:00:00.000Z,2026-01-01T00:00:00.000Z"
      ].join("\n")
    );

    expect(details.abc).toMatchObject({
      youtubeVideoId: "abc",
      channelId: "channel",
      duration: 180,
      providedToYoutube: true,
      songNames: ["Song"]
    });
    expect(duplicates[0]).toMatchObject({
      removedYoutubeVideoId: "topic",
      keptYoutubeVideoId: "official",
      reason: "topic_duplicate_of_non_topic"
    });
  });
});
