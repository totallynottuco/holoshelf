import { describe, expect, it } from "vitest";
import { buildHololiveMusicSongKey, extractHololiveBroadcastSongTitle, hasHololiveBroadcastEditMarker } from "./classification";
import { buildDuplicateTitleCore } from "./cleanup";

describe("broadcast edit identity", () => {
  it.each(["TV Size", "TV Sized", "TV-size", "TV Size Version", "TV size ver.", "TV ver.", "TVアニメver.", "テレビサイズ", "アニメsize", "アニメサイズ", "TVサイズ"])("recognizes and strips %s consistently", label => {
    expect(hasHololiveBroadcastEditMarker(label)).toBe(true);
    expect(buildHololiveMusicSongKey({ songName: `Song (${label})` })).toBe("song");
    expect(buildHololiveMusicSongKey({ songName: `Song ${label}` })).toBe("song");
  });

  it("extracts the credited song, not the quoted anime title", () => {
    expect(buildDuplicateTitleCore('TVアニメ『株式会社マジルミエ』第2期ノンクレジットエンディング映像｜宝鐘マリン「BooooM!!!」')).toBe("boooom");
    expect(buildDuplicateTitleCore('TVアニメ「Show」ノンクレジットエンディング映像｜Artist「Song」')).toBe("song");
    expect(buildDuplicateTitleCore('Anime creditless opening | Artist “Song”')).toBe("song");
  });

  it("does not infer a song from ambiguous credits or ordinary quoted titles", () => {
    expect(buildDuplicateTitleCore('ノンクレジットエンディング映像｜「Song A」「Song B」')).not.toBe("song a");
    expect(hasHololiveBroadcastEditMarker('【original MV】Song【TVアニメ「Show」EDテーマ】')).toBe(false);
    expect(hasHololiveBroadcastEditMarker("TV Station / Live Forever")).toBe(false);
  });

  it("reads only the matching theme credit when the title contains just the show", () => {
    const title = '『追放された転生重騎士はゲーム知識で無双する』第2クールノンクレジットオープニング映像';
    const description = 'オープニング主題歌：常闇トワ「Rewrite the Answer」\nエンディングテーマ：Other「Different Song」';
    expect(extractHololiveBroadcastSongTitle(title, description)).toBe("Rewrite the Answer");
    expect(extractHololiveBroadcastSongTitle(title, 'エンディングテーマ：Other「Different Song」')).toBeNull();
    expect(extractHololiveBroadcastSongTitle(title, description + '\nオープニング主題歌：Artist「Ambiguous」')).toBeNull();
    expect(extractHololiveBroadcastSongTitle('『Show』ノンクレジットED映像', description)).toBe("Different Song");
  });
});
