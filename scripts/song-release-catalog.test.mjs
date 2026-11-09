import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOfficialMusicDate, parseOfficialMusicIndex, matchOfficialRelease, refreshSongReleaseCatalog } from "./song-release-catalog.mjs";

describe("official release catalog evidence", () => {
  it("extracts only release metadata and safe official index links", () => {
    expect(parseOfficialMusicIndex('<ul class="music_list clearfix"><li><a href="https://hololive.hololivepro.com/en/music/244/"><h3>Soirée</h3><p>Hoshimachi Suisei</p></a></li></ul>')).toEqual([{url:"https://hololive.hololivepro.com/en/music/244/",title:"Soirée",artist:"Hoshimachi Suisei"}]);
    expect(parseOfficialMusicDate('<p class="price_release">Price: 255 <strong>2022/12/19 on sale</strong></p>')).toBe("2022-12-19");
    expect(parseOfficialMusicDate('<p class="price_release">2022/02/31 on sale</p>')).toBeNull();
    expect(parseOfficialMusicDate('<p>Upcoming concert 2022/12/19</p>')).toBeNull();
  });
  const entry = {title:"Soirée",artist:"Hoshimachi Suisei"};
  const row = {title:"ソワレ / 星街すいせい(official)",songName:"ソワレ / Soirée",topicId:"Original_Song",sourceKind:"official",ownedIdolIds:["suisei"],featuredIdolIds:[],artistNames:{suisei:"Hoshimachi Suisei"}};
  it("matches the exact song and singer, preserving the recording's own year for covers and variants", () => {
    expect(matchOfficialRelease(entry,row)).toBe(true);
    for(const changed of [{topicId:"Music_Cover"},{sourceKind:"user"},{title:row.title+" (Acoustic)"},{songName:"Different Song"},{featuredIdolIds:["other"],artistNames:{suisei:"Hoshimachi Suisei",other:"Another Singer"}}]) expect(matchOfficialRelease(entry,{...row,...changed})).toBe(false);
  });
  it("follows the site's query pagination and reuses historical metadata on the next run", async () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"holoshelf-release-cache-"));
    try {
      const calls=[],facts=[];
      const database={listHololiveIdols:()=>[{id:"suisei",displayName:"Hoshimachi Suisei"}],select:()=>[{youtube_video_id:"mv"}],listHololiveMusicRows:()=>[{...row,youtubeVideoId:"mv"}],upsertHololiveMusicReleaseDates:rows=>facts.push(...rows)};
      const item=(id,title)=>`<li><a href="https://hololive.hololivepro.com/en/music/${id}/"><h3>${title}</h3><p>Hoshimachi Suisei</p></a></li>`;
      const fetcher=async url=>{calls.push(url);return new Response(url.endsWith('/244/')?'<p class="price_release">2022/12/19 on sale</p>':`<ul class="music_list">${url.includes('paged=2')?item('244','Soirée'):item('new','Different Song')}</ul><a href="?paged=2">2</a>`);};
      const options={cacheFile:path.join(directory,"cache.json"),fetcher,now:1794250000000};
      expect((await refreshSongReleaseCatalog(database,options)).requests).toBe(3);
      expect(calls.some(url=>url.endsWith('?paged=2'))).toBe(true);
      expect(facts).toMatchObject([{youtubeVideoId:"mv",releaseDate:"2022-12-19",basis:"official_release"}]);
      expect((await refreshSongReleaseCatalog(database,{...options,now:options.now+1000})).requests).toBe(1);
      const cached=await refreshSongReleaseCatalog(database,{...options,now:options.now+2000,fetcher:async()=>new Response('',{status:503})});
      expect(cached.complete).toBe(false);expect(cached.matchedDates).toBe(1);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
  });
});
