import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseService } from "./database";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import { mergeBundledOfficialData } from "./officialDataMergeService";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error("Unsafe cleanup"); fs.rmSync(dir, {recursive:true,force:true}); } });
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-release-dates-")); directories.push(directory);
  const file = path.join(directory, "holoshelf.sqlite");
  const db = new DatabaseService(file, undefined, {createBackups:false}); await db.init();
  return {db,file,directory};
}
function songs(db: DatabaseService, topicId: "Original_Song" | "Music_Cover" = "Original_Song") {
  const idols = db.listHololiveIdols().filter(idol => idol.source === "official").slice(0,32);
  const bundle: HolodexArtifactBundle = {
    rows: idols.map((idol,i)=>({youtubeVideoId:`release-song-${i}`,youtubeUrl:`https://youtu.be/release-song-${i}`,title:`Release Song ${i}`,status:"past",topicId,channelId:idol.youtubeChannelId!,channelName:idol.displayName,
      publishedAt:i===0?"2023-08-25T12:00:00Z":i===3?"2022-12-31T23:59:59Z":"2022-01-01T00:00:00Z"})),
    detailCache:Object.fromEntries(idols.map((idol,i)=>[`release-song-${i}`,normalizeVideoDetail(`release-song-${i}`,{channelId:idol.youtubeChannelId!,duration:200,songNames:[`Release Song ${i}`],relationshipsLoaded:true})])),duplicateRemovals:[]
  };
  db.importHolodexMusicArtifacts(bundle,"live");db.upsertHololiveMusicVideoStats(idols.map((_,i)=>({youtubeVideoId:`release-song-${i}`,viewCount:100000-i,fetchedAt:"2026-11-09T00:00:00Z"})));
}
const range = {excludeBeforeDate:"2022-01-01",excludeAfterDate:"2022-12-31",maxEntriesPerTalent:null,preferTopicSplitPerTalent:false};

describe("release-date upgrades and bracket filtering",()=>{
  it("uses verified song dates for new filters while legacy video-date filters and saved brackets keep their behavior",async()=>{
    const {db,file}=await fixture();songs(db);
    const original=await db.createHololiveBracket({size:"RO16",format:"double_elimination",filters:range});
    const tables=["hololive_brackets","hololive_bracket_entries","hololive_bracket_matches","hololive_bracket_archives","hololive_bracket_archive_entries","hololive_bracket_archive_matches"];
    const before=tables.map(table=>db.select(`SELECT * FROM ${table}`));
    // A real 1.1.96 database has neither the new table nor its startup marker.
    db.run("DROP TABLE hololive_music_release_dates");db.run("DELETE FROM schema_migrations WHERE version=38");db.run("DELETE FROM settings WHERE key='internal.releaseDatesBackfill'");db.flush();
    const upgraded=new DatabaseService(file,undefined,{createBackups:false});await upgraded.init();
    expect(tables.map(table=>upgraded.select(`SELECT * FROM ${table}`))).toEqual(before);
    expect(upgraded.getHololiveBracket(original.id).generationFilters.dateBasis).toBeUndefined();
    upgraded.upsertHololiveMusicReleaseDates([
      {youtubeVideoId:"release-song-0",releaseDate:"2022-12-19",basis:"official_release",sourceUrl:"https://hololive.hololivepro.com/en/music/244/"},
      {youtubeVideoId:"release-song-1",releaseDate:"2021-06-22",basis:"official_release",sourceUrl:"https://hololive.hololivepro.com/en/music/reflect/"}
    ]);
    const preview=upgraded.previewHololiveBracketSelection({size:"RO16",filters:{...range,dateBasis:"song_release"}});
    expect(preview.entries[0]).toMatchObject({youtubeVideoId:"release-song-0",dateUsed:"2022-12-19",dateBasis:"official_release"});
    expect(preview.entries.some(row=>row.youtubeVideoId==="release-song-1")).toBe(false);
    expect(upgraded.previewHololiveBracketSelection({size:"RO16",filters:range}).entries[0].youtubeVideoId).toBe("release-song-1");
    const legacyFlag=upgraded.previewHololiveBracketSelection({size:"RO16",filters:{...range,dateBasis:"song_release",includeEstimatedReleaseDates:false}});
    expect(legacyFlag.entries).toEqual(preview.entries);
    const generated=await upgraded.createHololiveBracket({size:"RO16",filters:{...range,dateBasis:"song_release"}});
    expect(new Set(generated.entries.map(row=>row.youtubeVideoId))).toEqual(new Set(preview.entries.map(row=>row.youtubeVideoId)));
    expect(upgraded.getHololiveBracket(original.id).entries).toEqual(original.entries);
    expect(upgraded.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it.each(["Original_Song", "Music_Cover"] as const)("uses the retained %s video upload when no explicit release is known",async(topicId)=>{
    const {db}=await fixture();songs(db,topicId);
    db.upsertHololiveMusicReleaseDates([{youtubeVideoId:"release-song-0",releaseDate:"2019-01-01",basis:"recording_upload",sourceUrl:"https://www.youtube.com/watch?v=older-duplicate"}]);
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0]).toMatchObject({releaseDate:"2023-08-25",releaseDateSourceUrl:"https://youtu.be/release-song-0"});
    expect(db.previewHololiveBracketSelection({size:"RO16",filters:{...range,dateBasis:"song_release"}}).entries.some(row=>row.youtubeVideoId==="release-song-0")).toBe(false);
    db.upsertHololiveMusicReleaseDates([{youtubeVideoId:"release-song-0",releaseDate:"2022-12-19",basis:"youtube_release",sourceUrl:"https://www.youtube.com/watch?v=automatic-upload"}]);
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2022-12-19");
    expect(db.previewHololiveBracketSelection({size:"RO16",filters:{...range,dateBasis:"song_release"}}).entries[0].youtubeVideoId).toBe("release-song-0");
  });

  it("keeps source release evidence through deletion, replacement, repeat imports and album reissues",async()=>{
    const {db}=await fixture();const channel=db.listHololiveIdols()[0].youtubeChannelId!;
    const make=(id:string,date:string,provided:boolean)=>({rows:[{youtubeVideoId:id,youtubeUrl:`https://youtu.be/${id}`,title:"Same Recording",topicId:"Original_Song" as const,status:"past",channelId:channel,channelName:"Artist",publishedAt:date}],
      detailCache:{[id]:normalizeVideoDetail(id,{channelId:channel,originalChannelId:provided?channel:"",providedToYoutube:provided,duration:200,songNames:["Same Recording"],description:provided?"Provided to YouTube by Label\nReleased on: 2020-02-29":"",relationshipsLoaded:true})},duplicateRemovals:[]});
    db.importHolodexMusicArtifacts(make("release-audio","2020-02-29T00:00:00Z",true),"live");
    db.importHolodexMusicArtifacts(make("release-mv","2023-01-01T00:00:00Z",false),"live");
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-audio"]})).toHaveLength(0);
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-mv"]})[0]).toMatchObject({publishedAt:"2023-01-01T00:00:00Z",releaseDate:"2020-02-29",releaseDateBasis:"youtube_release"});
    db.excludeHololiveMusicVideo({youtubeVideoId:"release-audio",title:"Excluded audio"});
    const exclusions=db.select("SELECT * FROM hololive_music_exclusions");
    const reissue=make("release-audio","2024-01-01T00:00:00Z",true);reissue.detailCache["release-audio"].description="Provided to YouTube by Label\nReleased on: 2024-01-01";
    db.importHolodexMusicArtifacts(reissue,"live");
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-mv"]})[0].releaseDate).toBe("2020-02-29");
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual(exclusions);
  });

  it("merges release metadata from silent catalogs without changing personal data or erasing it with an older catalog",async()=>{
    const source=await fixture(),client=await fixture();songs(source.db);songs(client.db);
    source.db.upsertHololiveMusicReleaseDates([{youtubeVideoId:"release-song-0",releaseDate:"2022-12-19",basis:"official_release",sourceUrl:"https://hololive.hololivepro.com/en/music/244/"}]);
    client.db.setHololiveMusicMarker({youtubeVideoId:"release-song-0",marker:"favorite"});
    const playlist=client.db.createHololiveMusicPlaylist("Personal playlist").playlists.find(row=>!row.systemId)!.id;
    client.db.addHololiveMusicPlaylistItem({playlistId:playlist,youtubeVideoId:"release-song-0"});client.db.setSetting("personal.preference","keep");
    const tables=["hololive_music_marker_keys","hololive_music_playlists","hololive_music_playlist_items","hololive_brackets","hololive_bracket_matches","hololive_bracket_archives"];
    const before=tables.map(table=>client.db.select(`SELECT * FROM ${table}`));
    fs.copyFileSync(source.file,path.join(source.directory,"holoshelf-template.sqlite"));
    const manifest=(version:string)=>fs.writeFileSync(path.join(source.directory,"official-data.json"),JSON.stringify({schema:1,version,generatedAt:"2026-11-09T00:00:00Z"}));
    manifest("2026-11-09T220000Z");
    const merge=()=>mergeBundledOfficialData({database:client.db,paths:{dataDirectory:client.directory,databasePath:client.file,backupDirectory:path.join(client.directory,"backups"),coversDirectory:"",hololiveImageDirectory:path.join(client.directory,"images"),seedDirectory:source.directory,legacyHololiveIconDirectory:"",legacyDataDirectories:[],dataLocationKind:"custom"},isPackaged:true});
    expect((await merge()).status).toBe("merged");
    expect(client.db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2022-12-19");
    expect(tables.map(table=>client.db.select(`SELECT * FROM ${table}`))).toEqual(before);
    expect(client.db.getSettings()["personal.preference"]).toBe("keep");
    source.db.run("DROP TABLE hololive_music_release_dates");source.db.flush();fs.copyFileSync(source.file,path.join(source.directory,"holoshelf-template.sqlite"));manifest("2026-11-09T230000Z");
    expect((await merge()).status).toBe("merged");
    expect(client.db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2022-12-19");
    expect(tables.map(table=>client.db.select(`SELECT * FROM ${table}`))).toEqual(before);
  });

  it("does not inherit a different performance's date and discards cached facts after rollback",async()=>{
    const {db}=await fixture();songs(db);
    db.upsertHololiveMusicReleaseDates([{youtubeVideoId:"old-live",releaseDate:"2019-01-01",basis:"recording_upload",sourceUrl:"https://www.youtube.com/watch?v=old-live"}]);
    db.run("INSERT INTO hololive_music_duplicate_removals(removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,removed_published_at,updated_at) VALUES('old-live','Live','release-song-0','Studio','canonical_variant_duplicate_of_full','2019-01-01','now')");
    db.refreshHololiveMusicReleaseDates();
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2023-08-25");
    expect(()=>db.transaction(()=>{
      db.upsertHololiveMusicReleaseDates([{youtubeVideoId:"release-song-0",releaseDate:"2022-12-19",basis:"official_release",sourceUrl:"https://hololive.hololivepro.com/en/music/244/"}]);
      expect(db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2022-12-19");
      throw Error("Rollback test");
    })).toThrow("Rollback test");
    expect(db.listHololiveMusicRows({youtubeVideoIds:["release-song-0"]})[0].releaseDate).toBe("2023-08-25");
  });

  it("keeps foreign-key cascades enabled after saving",async()=>{
    const {db}=await fixture();db.run("INSERT INTO lists(id,module_id,name,created_at,updated_at) VALUES('saved-list','hololive','Test','now','now')");
    db.run("INSERT INTO catalog_items(id,module_id,kind,title,created_at,updated_at) VALUES('saved-item','hololive','music','Test','now','now')");
    db.run("INSERT INTO list_items(list_id,item_id,position,created_at) VALUES('saved-list','saved-item',0,'now')");
    db.flush();db.setSetting("save.trigger","save again");db.run("DELETE FROM lists WHERE id='saved-list'");
    expect(db.select("SELECT * FROM list_items WHERE list_id='saved-list'")).toEqual([]);
    expect(db.select("PRAGMA foreign_key_check")).toEqual([]);
  });
});
