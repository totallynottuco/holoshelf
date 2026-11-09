import { describe, expect, it } from "vitest";
import { chooseReleaseDate, isCalendarDate, parseBracketYears, parseYoutubeReleaseDate } from "./musicReleaseDates";

describe("recording dates and year shortcuts", () => {
  it.each(["2022", "2020-2022", "2020 – 2022"])("expands an inclusive calendar range: %s", value => {
    expect(parseBracketYears(value)).toEqual({ from: value === "2022" ? "2022-01-01" : "2020-01-01", to: "2022-12-31" });
  });
  it.each(["2022-2020", "202", "2020-", "abcd", "2020-2022-2023", "1899"])("rejects ambiguous or reversed years: %s", value => expect(parseBracketYears(value)).toBeNull());
  it("validates leap days and real dates", () => {
    expect(isCalendarDate("2020-02-29")).toBe(true);
    for (const value of ["2022-02-29", "2022-02-31", "2022-13-01", "2022-1-1"]) expect(isCalendarDate(value)).toBe(false);
  });
  it("reads only an explicit distributor release credit", () => {
    expect(parseYoutubeReleaseDate("Provided to YouTube by Label\nSong\nReleased on: 2022-12-19")).toBe("2022-12-19");
    expect(parseYoutubeReleaseDate("New video!\nReleased on: 2022-12-19")).toBeNull();
    expect(parseYoutubeReleaseDate("Provided to YouTube by Label\nReleased on: 2022-12-19\nReleased on: 2023-01-25")).toBeNull();
  });
  it("keeps the earliest verified release across album reissues, without treating an upload estimate as verified", () => {
    const facts = [
      { releaseDate: "2023-01-25", basis: "youtube_release" as const, sourceUrl: "https://youtu.be/album" },
      { releaseDate: "2022-12-19", basis: "official_release" as const, sourceUrl: "https://hololive.hololivepro.com/en/music/244/" },
      { releaseDate: "2022-12-18", basis: "recording_upload" as const, sourceUrl: "https://youtu.be/premiere" }
    ];
    expect(chooseReleaseDate(facts)?.releaseDate).toBe("2022-12-19");
    expect(chooseReleaseDate(facts.slice(2))?.basis).toBe("recording_upload");
  });
});
