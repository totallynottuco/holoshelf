import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragCenterTo(
  page: Page,
  source: Locator,
  target: Locator,
  targetPosition: { x: number; y: number }
): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetPosition.x, targetBox!.y + targetPosition.y, { steps: 18 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const targetWindow = window as typeof window & {
      __holoshelfYoutubePlayCount?: number;
      __holoshelfYoutubeLastVideoId?: string | null;
      __holoshelfYoutubeEmitEnded?: () => void;
      YT?: {
        Player: new (
          element: HTMLElement,
          options: {
            videoId?: string;
            events?: {
              onReady?: () => void;
              onStateChange?: (event: { data: number }) => void;
              onError?: (event: { data: number }) => void;
            };
          }
        ) => {
          loadVideoById(videoId: string): void;
          playVideo(): void;
          pauseVideo(): void;
          destroy(): void;
        };
        PlayerState: {
          ENDED: number;
          PLAYING: number;
          PAUSED: number;
        };
      };
    };

    targetWindow.__holoshelfYoutubePlayCount = 0;
    targetWindow.__holoshelfYoutubeLastVideoId = null;
    targetWindow.__holoshelfYoutubeEmitEnded = undefined;

    type MockYouTubeEvents = {
      onReady?: () => void;
      onStateChange?: (event: { data: number }) => void;
      onError?: (event: { data: number }) => void;
    };

    function getVideoIdFromElement(element: HTMLElement): string | null {
      if (!(element instanceof HTMLIFrameElement)) {
        return null;
      }

      const match = element.src.match(/\/embed\/([^?]+)/);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    }

    class MockYouTubePlayer {
      private videoId: string | null;
      private playerState = -1;
      private readonly events?: MockYouTubeEvents;
      private readonly element: HTMLElement;

      constructor(element: HTMLElement, options: { videoId?: string; events?: MockYouTubeEvents }) {
        this.element = element;
        this.videoId = options.videoId ?? getVideoIdFromElement(element);
        this.events = options.events;
        if (!(element instanceof HTMLIFrameElement)) {
          const iframe = document.createElement("iframe");
          iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(this.videoId ?? "")}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
          iframe.title = "Hololive YouTube player";
          element.appendChild(iframe);
        }
        targetWindow.__holoshelfYoutubeLastVideoId = this.videoId;
        targetWindow.__holoshelfYoutubeEmitEnded = () => {
          this.playerState = 0;
          this.events?.onStateChange?.({ data: 0 });
        };
        window.setTimeout(() => this.events?.onReady?.(), 0);
      }

      loadVideoById(videoId: string) {
        this.videoId = videoId;
        this.playerState = -1;
        targetWindow.__holoshelfYoutubeLastVideoId = videoId;
      }

      playVideo() {
        this.playerState = 1;
        targetWindow.__holoshelfYoutubePlayCount = (targetWindow.__holoshelfYoutubePlayCount ?? 0) + 1;
        targetWindow.__holoshelfYoutubeLastVideoId = this.videoId;
        this.events?.onStateChange?.({ data: 1 });
      }

      pauseVideo() {
        this.playerState = 2;
        this.events?.onStateChange?.({ data: 2 });
      }

      destroy() {
        this.element.parentElement?.removeChild(this.element);
      }
    }

    targetWindow.YT = {
      Player: MockYouTubePlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2
      }
    };
  });
  await page.goto("/#/module/hololive");
});

test("renders the Hololive tier list route", async ({ page }) => {
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".search-box")).toHaveCount(0);
  await expect(page.locator(".path-chip")).toHaveCount(0);
  await expect(page.locator(".hololive-heading")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hololive" })).toHaveCount(0);
  await expect(page.locator(".hololive-page > *").first()).toHaveClass(/hololive-tier-workspace/);
  await expect(page.locator(".hololive-tier-workspace .hololive-board-tabs")).toHaveCount(1);
  await expect(page.locator(".hololive-toolbar")).toHaveCount(0);
  await expect(page.locator(".hololive-board-tab.active")).toContainText("tier list 1");
  await expect(page.locator(".hololive-tier-row")).toHaveCount(6);
  await expect(page.locator(".hololive-idol-tile")).toHaveCount(74);
  await expect(page.locator(".hololive-pool")).toContainText("Unranked");
  await expect(page.locator('.hololive-tier-label input[type="text"]').first()).toHaveValue("S");
  await expect(page.locator(".hololive-color-notch .hololive-color-input").first()).toHaveValue("#2f8fd7");
  await expect(page.getByRole("button", { name: /Clear/ })).toBeVisible();
  await expect(page.locator(".hololive-tier-tools")).toHaveCount(0);
  await expect(page.locator(".hololive-collapsed-row")).toHaveCount(0);
  await expect(page.locator(".hololive-color-notch .hololive-color-input")).toHaveCount(6);
  await expect(page.locator(".hololive-tier-label-resizer")).toHaveCount(6);
  await expect(page.locator(".hololive-tier-delete-button")).toHaveCount(6);
  await expect(page.locator(".hololive-tier-add-button")).toHaveCount(12);
  await expect(page.locator('section[aria-label="Tier board controls"]')).toHaveCount(0);
  await expect(page.locator(".hololive-pool")).toHaveCSS("border-top-width", "1px");
  await expect(page.locator(".hololive-pool-dropzone")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".hololive-size-control")).toHaveCount(0);
  await expect(page.locator(".hololive-pool-actions")).toContainText("Sort");
  await expect(page.locator(".hololive-pool-actions")).toContainText("Clear");
  await expect(page.locator(".hololive-pool-actions")).toContainText("Icons");

  const boardBox = await page.locator(".hololive-tier-board").boundingBox();
  const poolBox = await page.locator(".hololive-pool").boundingBox();
  const rowBox = await page.locator(".hololive-tier-row").first().boundingBox();
  const firstTabBox = await page.locator(".hololive-board-tab.active").boundingBox();
  const firstResizerBox = await page.locator(".hololive-tier-label-resizer").first().boundingBox();

  expect(boardBox?.width).toBeGreaterThan(800);
  expect(Math.abs((rowBox?.height ?? 0) - 76)).toBeLessThanOrEqual(1);
  expect(Math.abs((firstTabBox?.x ?? 0) - ((firstResizerBox?.x ?? 0) + (firstResizerBox?.width ?? 0)))).toBeLessThanOrEqual(2);
  expect(poolBox?.height).toBeGreaterThan(100);
});

test("adds a custom talent from a channel handle", async ({ page }) => {
  await page.getByRole("link", { name: "Talents" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/talents/);
  await expect(page.locator(".hololive-talents-workspace")).toBeVisible();
  await expect(page.locator(".hololive-custom-talent-row")).toHaveCount(0);

  await page.getByLabel("Channel").fill("@SoradukiTyra");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".hololive-talent-preview")).toContainText("Soraduki Tyra");
  await expect(page.locator(".hololive-talent-preview")).toContainText("UCdQYcUyffHZoz0KOwuiG0lQ");

  await page.getByRole("button", { name: "Save" }).click();
  const customRow = page.locator(".hololive-custom-talent-row").filter({ hasText: "Soraduki Tyra" });
  await expect(customRow).toBeVisible();
  await expect(customRow).toContainText("Independents");
  await expect(customRow).toContainText("42,100");

  await page.getByRole("button", { name: "Refresh All" }).click();
  await expect(page.locator(".hololive-talents-message")).toContainText("Custom refresh complete");
  await expect(page.locator(".hololive-talents-message")).toContainText("view counts");

  await page.getByRole("link", { name: "Tier Lists" }).click();
  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(75);
  await expect(page.locator('.hololive-pool .hololive-idol-tile[data-idol-id="custom-soraduki-tyra"]')).toBeVisible();
});

test("creates and plays through a Hololive bracket matchup", async ({ page }) => {
  await page.getByRole("link", { name: "Player" }).click();
  await page.getByTitle("Create playlist").click();
  await page.getByLabel("New playlist name").fill("Arena Picks");
  await page.getByTitle("Create new playlist").click();
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Arena Picks");

  await page.getByRole("link", { name: "Brackets" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/brackets/);
  await expect(page.locator(".hololive-brackets-workspace")).toBeVisible();
  await expect(page.locator(".hololive-bracket-empty")).toContainText("No saved brackets yet");
  await expect(page.locator(".hololive-bracket-toolbar .compact-select")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-create-popover")).toHaveCount(0);

  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".hololive-bracket-create-popover")).toBeVisible();
  await page.getByRole("radio", { name: "RO16" }).click();
  await expect(page.getByRole("radio", { name: "RO16" })).toBeChecked();
  await page.getByRole("radio", { name: "Random Songs" }).click();
  await expect(page.getByRole("radio", { name: "Random Songs" })).toBeChecked();
  await page.locator(".hololive-bracket-create-popover").getByLabel("Name").fill("Singer Showdown");
  await page.getByRole("button", { name: "Create Bracket" }).click();

  const savedBracketSelect = page.getByRole("combobox", { name: "Saved bracket" });
  await expect(savedBracketSelect).toContainText("Random");
  await savedBracketSelect.click();
  await expect(page.getByRole("listbox", { name: "Saved bracket" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Singer Showdown/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hololive-bracket-arena-embed iframe")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-arena-top strong")).toContainText("Singer Showdown");
  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("Round of 16");
  await expect(page.locator(".hololive-bracket-vs-badge")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fullscreen matchup" })).toBeVisible();
  await expect(page.locator(".hololive-bracket-arena-actions .hololive-song-marker-button")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-arena-actions > .hololive-bracket-action-menu > button")).toHaveCount(4);
  await page.locator(".hololive-bracket-arena-actions > .hololive-bracket-action-menu > button").nth(1).click();
  const bracketPlaylistMenu = page.getByRole("menu", { name: /Choose playlist/ });
  await expect(bracketPlaylistMenu).toBeVisible();
  await expect(bracketPlaylistMenu).toHaveCSS("display", "grid");
  await expect(bracketPlaylistMenu).toHaveCSS("border-top-style", "solid");
  await expect
    .poll(() => bracketPlaylistMenu.evaluate((element) => getComputedStyle(element).backgroundImage))
    .toContain("linear-gradient");
  await expect(page.getByRole("menuitemcheckbox", { name: /Arena Picks/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const firstBracketMarker = page.locator(".hololive-bracket-arena-actions .hololive-song-marker-button").first();
  await firstBracketMarker.click();
  await page.getByRole("menuitemradio", { name: "Favorite" }).click();
  await expect(firstBracketMarker).toHaveClass(/favorite/);
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.locator(".hololive-bracket-status-row")).toHaveCount(0);
  await expect(page.locator(".hololive-bracket-tree")).toBeVisible();
  await expect(page.locator(".hololive-bracket-side.left .hololive-bracket-round")).toHaveCount(3);
  await expect(page.locator(".hololive-bracket-final-round")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-side.right .hololive-bracket-round")).toHaveCount(3);
  await expect(page.locator(".hololive-bracket-entry img").first()).toBeVisible();
  await expect(page.locator(".hololive-bracket-match-label").first()).toContainText("R1-1");
  await expect(page.locator(".hololive-bracket-match.current")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-round.current").first()).toBeVisible();
  await expect(page.locator(".hololive-bracket-round-state")).toHaveCount(0);

  await page.getByRole("button", { name: "Play" }).click();
  await page.locator(".hololive-bracket-pick-button").first().click();
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.locator(".hololive-bracket-match.current .hololive-bracket-match-label")).toContainText("R1-2");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".hololive-bracket-match.current .hololive-bracket-match-label")).toContainText("R1-1");

  await page.getByRole("button", { name: "Play" }).click();
  for (let index = 0; index < 15; index += 1) {
    await page.locator(".hololive-bracket-pick-button").first().click();
  }
  await expect(page.locator(".hololive-bracket-champion")).toContainText("Champion");
  await page.getByRole("button", { name: "Export" }).click();
  const exportToast = page.locator(".hololive-export-toast");
  await expect(exportToast).toContainText("Bracket image saved");
  await expect(exportToast).toContainText("mock-bracket-export.png");
  await exportToast.click();
  await expect(exportToast).toHaveCount(0);

  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.locator(".hololive-bracket-stats-view")).toBeVisible();
  await expect(page.locator(".hololive-bracket-stats-totals")).toContainText("Completed");
  await expect(page.locator(".hololive-bracket-stats-totals")).toContainText("1");
  await expect(page.locator(".hololive-bracket-stats-panel.history")).toContainText("Singer Showdown");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".hololive-bracket-toolbar button.danger").click();
  await expect(page.locator(".hololive-bracket-stats-panel.history")).toContainText("Singer Showdown");
  await expect(page.locator(".hololive-bracket-stats-totals")).toContainText("Completed");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /Delete archived bracket Singer Showdown/ }).click();
  await expect(page.locator(".hololive-bracket-stats-panel.history")).toContainText("Completed brackets will appear here");
  await expect(page.locator(".hololive-bracket-stats-totals")).toContainText("0");
});

test("opens a Hololive idol profile shelf from clicking an idol tile", async ({ page }) => {
  const tokinoTile = page.locator('.hololive-pool .hololive-idol-tile[data-idol-id="tokino-sora"]').first();

  await tokinoTile.scrollIntoViewIfNeeded();
  await expect(tokinoTile).toHaveCSS("cursor", "pointer");
  await expect(page.locator(".hololive-idol-info-button")).toHaveCount(0);
  await tokinoTile.click();

  const shelf = page.locator(".hololive-profile-shelf");
  await expect(shelf).toBeVisible();
  await expect(shelf).toContainText("Tokino Sora");
  await expect(shelf).toContainText("Japan");
  await expect(shelf).toContainText("Gen 0");
  await expect(shelf.locator(".hololive-profile-quote")).toContainText("Hey, Sora-tomo!");
  await expect(shelf.locator(".hololive-profile-description")).toHaveCount(0);
  await expect(shelf).toContainText("May 15");
  await expect(shelf.getByRole("link", { name: "Open Tokino Sora official profile" })).toHaveAttribute(
    "href",
    /hololive\.hololivepro\.com/
  );
  await expect(shelf.getByRole("link", { name: /Official Profile/ })).toHaveCount(0);
  await expect(shelf.getByRole("link", { name: /YouTube/ })).toHaveCount(0);
  await expect(shelf.locator(".hololive-profile-links").getByRole("link", { name: /Tokino Sora Channel/ })).toHaveAttribute("href", /youtube\.com/);
  await expect(shelf.locator(".hololive-profile-links").getByRole("link", { name: /@tokino_sora/ })).toHaveAttribute("href", /twitter\.com/);
  await expect(shelf.locator(".hololive-profile-channel")).toHaveCount(0);
  await expect(shelf.locator(".hololive-profile-music-summary")).toHaveCount(0);
  await expect(shelf.locator(".hololive-profile-stats")).toContainText("Subscribers");
  await expect(shelf.locator(".hololive-profile-stats")).toContainText("Videos");
  await expect(shelf.locator(".hololive-profile-stats")).toContainText("Clips");
  await expect(shelf.locator(".hololive-profile-stats")).toContainText("1.23M");
  await expect(shelf.locator(".hololive-profile-stats")).toContainText("2,100");

  const originals = shelf.locator(".hololive-profile-accordion").filter({ hasText: "Original Songs" });
  await expect(originals).not.toHaveAttribute("open", "");
  await expect(originals.locator("summary strong")).toHaveText("3");
  await originals.locator("summary").click();
  await expect(originals).toHaveAttribute("open", "");
  await expect(originals).toContainText("Tokino Sora Original Song");
  await expect(originals.locator(".hololive-song-list")).toHaveCount(1);
  await expect(originals.locator(".hololive-song-row")).toHaveCount(3);
  await expect(originals.locator(".hololive-song-title").first()).toContainText("Tokino Sora Original Song");
  await expect(originals.locator(".hololive-song-meta").first()).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4} \/ 3:30/);
  await expect(originals.locator(".hololive-song-row > a")).toHaveCount(0);
  await expect(originals.locator(".hololive-song-title-link").first()).toHaveAttribute("href", /youtube\.com/);
  await expect(originals.locator("summary")).toHaveCSS("border-bottom-width", "1px");
  const songTitleBox = await originals.locator(".hololive-song-title").first().boundingBox();
  const songMetaBox = await originals.locator(".hololive-song-meta").first().boundingBox();
  const summaryTextBox = await originals.locator("summary span").boundingBox();
  expect(songTitleBox?.height).toBeLessThanOrEqual(18);
  expect(summaryTextBox?.height).toBeGreaterThanOrEqual(17);
  expect(songMetaBox?.y).toBeGreaterThan((songTitleBox?.y ?? 0) + (songTitleBox?.height ?? 0) - 1);
  await expect(originals.getByRole("button", { name: /^Unmarked marker for Tokino Sora Original Song$/ })).toBeVisible();
  await originals.getByRole("button", { name: /^Unmarked marker for Tokino Sora Original Song$/ }).click();
  await expect(originals.getByRole("menu", { name: /Set marker/ })).toBeVisible();
  await originals.getByRole("menuitemradio", { name: "Favorite" }).click();
  await expect(originals.getByRole("button", { name: /^Favorite marker for Tokino Sora Original Song$/ })).toBeVisible();

  const covers = shelf.locator(".hololive-profile-accordion").filter({ hasText: "Covers" });
  await expect(covers.locator("summary strong")).toHaveText("1");
  await covers.locator("summary").click();
  await expect(covers).toContainText("Tokino Sora Cover Song");

  const featured = shelf.locator(".hololive-profile-accordion").filter({ hasText: "Featured In" });
  await expect(featured.locator("summary strong")).toHaveText("1");
  await featured.locator("summary").click();
  await expect(featured).toContainText("Tokino Sora Featured Song");

  await page.keyboard.press("Escape");
  await expect(page.locator(".hololive-profile-shelf")).toHaveCount(0);

  await tokinoTile.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hololive-profile-shelf")).toBeVisible();
  const reopenedOriginals = page.locator(".hololive-profile-shelf .hololive-profile-accordion").filter({ hasText: "Original Songs" });
  await reopenedOriginals.locator("summary").click();
  await expect(reopenedOriginals.getByRole("button", { name: /^Favorite marker for Tokino Sora Original Song$/ })).toBeVisible();
  await reopenedOriginals.getByRole("button", { name: /^Favorite marker for Tokino Sora Original Song$/ }).click();
  await reopenedOriginals.getByRole("menuitemradio", { name: "Favorite" }).click();
  await expect(reopenedOriginals.getByRole("button", { name: /^Unmarked marker for Tokino Sora Original Song$/ })).toBeVisible();
  await reopenedOriginals.getByRole("button", { name: /^Unmarked marker for Tokino Sora Original Song$/ }).click();
  await reopenedOriginals.getByRole("menuitem", { name: "Exclude" }).click();
  await expect(reopenedOriginals.getByRole("group", { name: /Confirm exclusion/ })).toBeVisible();
  await reopenedOriginals.getByRole("menuitem", { name: "Confirm" }).click();
  await expect(reopenedOriginals.locator("summary strong")).toHaveText("2");
  await expect(reopenedOriginals.locator(".hololive-song-row")).toHaveCount(2);
  await page.locator(".hololive-profile-layer").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".hololive-profile-shelf")).toHaveCount(0);
});

test("uses the Hololive player route with playlists and queue actions", async ({ page }) => {
  const switchBoxBefore = await page.locator(".hololive-view-switch").boundingBox();
  await page.getByRole("link", { name: "Player" }).click();

  await expect(page).toHaveURL(/\/module\/hololive\/player/);
  await expect(page.locator(".hololive-player-workspace")).toBeVisible();
  const switchBoxAfter = await page.locator(".hololive-view-switch").boundingBox();
  expect(switchBoxBefore).not.toBeNull();
  expect(switchBoxAfter).not.toBeNull();
  expect(Math.abs(switchBoxAfter!.x - switchBoxBefore!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(switchBoxAfter!.y - switchBoxBefore!.y)).toBeLessThanOrEqual(1);
  await expect(page.locator(".hololive-view-switch")).toHaveCSS("position", "sticky");
  await expect(page.locator(".hololive-youtube-empty")).toContainText("Select a song");
  await expect(page.locator(".hololive-library-row")).toHaveCount(5);
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Favorites");
  await expect(page.locator(".hololive-playlist-panel .hololive-player-song-list li")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Song type" }).click();
  await page.getByRole("listbox", { name: "Song type" }).getByRole("option", { name: "Originals" }).click();
  await expect(page.getByRole("combobox", { name: "Song type" })).toContainText("Originals");
  await page.getByRole("combobox", { name: "Song type" }).click();
  await page.getByRole("listbox", { name: "Song type" }).getByRole("option", { name: "All" }).click();

  await page.getByRole("combobox", { name: "Songs per page" }).click();
  await page.getByRole("listbox", { name: "Songs per page" }).getByRole("option", { name: "25" }).click();
  await expect(page.locator(".hololive-library-footer")).toContainText("1-5");
  await expect(page.locator(".hololive-library-footer")).toContainText("5 songs");
  await expect(page.locator(".hololive-library-page-pill")).toContainText("Page");

  const libraryBox = await page.locator(".hololive-library-panel").boundingBox();
  const queueBox = await page.locator(".hololive-queue-panel").boundingBox();
  const playerBox = await page.locator(".hololive-player-main").boundingBox();
  const playlistsBox = await page.locator(".hololive-playlist-panel").boundingBox();
  expect(libraryBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(playlistsBox).not.toBeNull();
  expect(libraryBox!.x).toBeLessThan(queueBox!.x);
  expect(queueBox!.x).toBeLessThan(playerBox!.x);
  expect(Math.abs(playlistsBox!.x - playerBox!.x)).toBeLessThanOrEqual(1);
  expect(playlistsBox!.y).toBeGreaterThan(playerBox!.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = document.querySelector(".workspace");
        return workspace ? workspace.scrollHeight - workspace.clientHeight : 0;
      })
    )
    .toBeLessThanOrEqual(1);

  await page.getByTitle("Create playlist").click();
  await page.getByLabel("New playlist name").fill("Roadtrip");
  await page.getByTitle("Create new playlist").click();
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Roadtrip");

  const firstSong = page.locator(".hololive-library-row").filter({ hasText: "Tokino Sora Original Song" }).first();
  const secondSong = page.locator(".hololive-library-row").filter({ hasText: "Tokino Sora Cover Song" });
  await expect(firstSong.getByTitle("Play next")).toHaveCount(0);
  await firstSong.getByTitle("Add to queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(1);
  await expect(page.locator(".hololive-youtube-empty")).toContainText("Select a song");
  await page.locator(".hololive-queue-panel").getByTitle("Clear queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(0);
  await firstSong.getByRole("button", { name: /Unmarked marker for Tokino Sora Original Song/ }).click();
  await firstSong.getByRole("menuitemradio", { name: "Favorite" }).click();
  await expect(firstSong.getByRole("button", { name: /Favorite marker for Tokino Sora Original Song/ })).toBeVisible();
  await firstSong.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ }).click();
  await firstSong.getByRole("menuitemcheckbox", { name: /Roadtrip/ }).click();
  const roadtripPlaylist = page.locator(".hololive-playlist-entry").filter({ hasText: "Roadtrip" });
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(1);
  await firstSong.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ }).click();
  const roadtripChoice = firstSong.getByRole("menuitemcheckbox", { name: /Roadtrip/ });
  await expect(roadtripChoice).toHaveAttribute("aria-checked", "true");
  await expect(roadtripChoice.locator(".hololive-playlist-membership.active")).toBeVisible();
  await roadtripChoice.click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(0);
  await expect(page.locator(".hololive-player-status")).toContainText("Removed from Roadtrip");
  await firstSong.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ }).click();
  await firstSong.getByRole("menuitemcheckbox", { name: /Roadtrip/ }).click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(1);
  await roadtripPlaylist.locator(".hololive-playlist-toggle").click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(0);
  await roadtripPlaylist.locator(".hololive-playlist-toggle").click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(1);
  await roadtripPlaylist.locator(".hololive-player-song-main").click();
  await expect(page.locator(".hololive-player-status")).toContainText("Loaded in player");
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li").first()).toHaveClass(/active/);
  await expect(firstSong).toHaveClass(/playing/);

  await roadtripPlaylist.getByTitle("Play playlist").click();
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Original Song");
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(0);
  const playerMain = page.locator(".hololive-player-main");
  await expect(playerMain.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ })).toBeVisible();
  await expect(playerMain.getByRole("button", { name: /Favorite marker for Tokino Sora Original Song/ })).toBeVisible();
  await playerMain.getByRole("button", { name: /Favorite marker for Tokino Sora Original Song/ }).click();
  await playerMain.getByRole("menuitemradio", { name: "Like", exact: true }).click();
  await expect(playerMain.getByRole("button", { name: /Like marker for Tokino Sora Original Song/ })).toBeVisible();

  await firstSong.getByTitle("Add to queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(1);
  const firstQueueRow = page.locator(".hololive-queue-panel .hololive-player-song-list li").first();
  await expect(firstQueueRow.getByRole("button", { name: /Like marker for Tokino Sora Original Song/ })).toBeVisible();
  await expect(firstQueueRow.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ })).toBeVisible();
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Original Song");
  await expect(page.getByTitle("Save queue")).toBeEnabled();
  await expect(page.locator(".hololive-queue-panel").getByTitle("Clear queue")).toBeEnabled();

  const autoplayToggle = page.locator(".hololive-autoplay-toggle");
  await expect(autoplayToggle).toHaveClass(/active/);
  await autoplayToggle.click();
  await expect(autoplayToggle).not.toHaveClass(/active/);
  await expect(autoplayToggle).toHaveAttribute("title", "Autoplay: off");
  await autoplayToggle.click();
  await expect(autoplayToggle).toHaveAttribute("title", "Autoplay: on");

  await secondSong.getByTitle("Add to queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(2);
  const queueRows = page.locator(".hololive-queue-panel .hololive-player-song-list li");
  await expect(queueRows.nth(0)).toContainText("Tokino Sora Original Song");
  await expect(queueRows.nth(1)).toContainText("Tokino Sora Cover Song");
  await expect(queueRows.nth(0).getByTitle("Drag to reorder")).toBeVisible();
  await expect(queueRows.nth(0).getByTitle("Play now")).toBeVisible();
  await dragCenterTo(page, queueRows.nth(1).getByTitle("Drag to reorder"), queueRows.nth(0), { x: 12, y: 8 });
  await expect(queueRows.nth(0)).toContainText("Tokino Sora Cover Song");
  await page.waitForTimeout(180);
  await queueRows.nth(0).locator(".hololive-player-song-main").click();
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Cover Song");
  await expect(page.locator(".hololive-player-status")).toContainText("Loaded in player");

  await secondSong.getByTitle("Play now").click();
  await expect(page.locator(".hololive-player-status")).toContainText("Playing now");
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Cover Song");
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(2);
  await expect(secondSong).toHaveClass(/playing/);

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("link", { name: "Tier Lists" }).click();
    await expect(page.locator(".hololive-tier-board")).toBeVisible();
    await page.getByRole("link", { name: "Player" }).click();
    await expect(page.locator(".hololive-player-workspace")).toBeVisible();
    await expect(page.locator(".boot-screen-error")).toHaveCount(0);
  }

  await page.locator(".hololive-queue-panel").getByTitle("Clear queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(0);
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Cover Song");
});

test("plays a profile song and adds it to a playlist", async ({ page }) => {
  await page.getByRole("link", { name: "Player" }).click();
  await page.getByTitle("Create playlist").click();
  await page.getByLabel("New playlist name").fill("Shelf Picks");
  await page.getByTitle("Create new playlist").click();
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Shelf Picks");
  await page.getByRole("link", { name: "Tier Lists" }).click();

  const tokinoTile = page.locator('.hololive-pool .hololive-idol-tile[data-idol-id="tokino-sora"]').first();

  await tokinoTile.click();
  const originals = page.locator(".hololive-profile-shelf .hololive-profile-accordion").filter({ hasText: "Original Songs" });
  await originals.locator("summary").click();
  await originals.getByRole("button", { name: /^Play Tokino Sora Original Song now$/ }).click();
  await expect(originals.locator(".hololive-song-row").first()).toHaveClass(/playing/);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __holoshelfYoutubePlayCount?: number }).__holoshelfYoutubePlayCount ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original");
  const miniPlayer = page.locator(".hololive-persistent-player.mini");
  await expect(miniPlayer).toBeVisible();
  await expect(miniPlayer.locator("iframe")).toHaveAttribute("src", /tokino-sora-mock-original/);
  const expectedEmbedOrigin = await page.evaluate(() => encodeURIComponent(window.location.origin));
  await expect(miniPlayer.locator("iframe")).toHaveAttribute("src", new RegExp(`origin=${expectedEmbedOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-2");
  await expect(originals.locator(".hololive-song-row").nth(1)).toHaveClass(/playing/);
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-3");
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original");
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-2");
  const miniAutoplayToggle = miniPlayer.getByRole("button", { name: "Toggle autoplay" });
  await expect(miniAutoplayToggle).toHaveAttribute("title", "Autoplay: on");
  await miniAutoplayToggle.click();
  await expect(miniAutoplayToggle).toHaveAttribute("title", "Autoplay: off");
  await miniAutoplayToggle.click();
  await expect(miniAutoplayToggle).toHaveAttribute("title", "Autoplay: on");
  await page.evaluate(() => (window as typeof window & { __holoshelfYoutubeEmitEnded?: () => void }).__holoshelfYoutubeEmitEnded?.());
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-3");
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await miniPlayer.getByTitle("Next Original Songs song").click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-2");
  await expect(originals.locator(".hololive-song-row").nth(1)).toHaveClass(/playing/);
  await miniPlayer.getByRole("button", { name: /Unmarked marker for current song/ }).click();
  await miniPlayer.getByRole("menuitemradio", { name: /^Like$/ }).click();
  await expect(miniPlayer.getByRole("button", { name: /Like marker for current song/ })).toBeVisible();
  await expect(originals.getByRole("button", { name: /^Like marker for Tokino Sora Original Song 2$/ })).toBeVisible();
  await miniPlayer.getByRole("button", { name: "Add current song to playlist" }).click();
  await miniPlayer.getByRole("menuitemcheckbox", { name: /Shelf Picks/ }).click();
  await miniPlayer.getByRole("button", { name: "View current song in profile shelf" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\?profile=tokino-sora&group=original-songs&song=tokino-sora-mock-original-2/);
  await expect(originals).toHaveAttribute("open", "");
  await expect(originals.locator('.hololive-song-row[data-song-id="tokino-sora-mock-original-2"]')).toHaveClass(/focused/);
  await page.getByRole("button", { name: "Close profile" }).click();
  await expect(page.locator(".hololive-profile-shelf")).toHaveCount(0);
  await miniPlayer.getByRole("button", { name: "View current song in profile shelf" }).click();
  await expect(page).toHaveURL(/focus=/);
  await expect(page.locator(".hololive-profile-shelf")).toBeVisible();
  await expect(originals).toHaveAttribute("open", "");
  await expect(originals.locator('.hololive-song-row[data-song-id="tokino-sora-mock-original-2"]')).toHaveClass(/focused/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".hololive-profile-content");
        const row = document.querySelector('.hololive-song-row[data-song-id="tokino-sora-mock-original-2"]');
        if (!(content instanceof HTMLElement) || !(row instanceof HTMLElement)) {
          return false;
        }

        const contentRect = content.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        return rowRect.top >= contentRect.top && rowRect.bottom <= contentRect.bottom;
      })
    )
    .toBe(true);
  const miniBeforeDrag = await miniPlayer.boundingBox();
  const miniHeader = miniPlayer.locator(".hololive-persistent-player-head");
  const headerBox = await miniHeader.boundingBox();
  expect(miniBeforeDrag).not.toBeNull();
  expect(headerBox).not.toBeNull();
  const dragStartX = headerBox!.x + Math.min(48, Math.max(18, headerBox!.width * 0.18));
  const dragStartY = headerBox!.y + headerBox!.height / 2;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 140, dragStartY - 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await miniPlayer.boundingBox())?.x ?? 0).toBeGreaterThan((miniBeforeDrag?.x ?? 0) + 40);
  await expect(miniPlayer).toHaveAttribute("data-dragging", "false");

  const resizeHandle = miniPlayer.locator(".hololive-persistent-player-resize.se");
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2 + 80, resizeBox!.y + resizeBox!.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const miniAfterResize = await miniPlayer.boundingBox();
  expect(miniAfterResize).not.toBeNull();
  expect(Math.abs((miniAfterResize!.width / (miniAfterResize!.height - 30)) - 16 / 9)).toBeLessThan(0.08);

  const eastResizeHandle = miniPlayer.locator(".hololive-persistent-player-resize.e");
  const eastResizeBox = await eastResizeHandle.boundingBox();
  expect(eastResizeBox).not.toBeNull();
  await page.mouse.move(eastResizeBox!.x + eastResizeBox!.width / 2, eastResizeBox!.y + eastResizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(eastResizeBox!.x + eastResizeBox!.width / 2 + 44, eastResizeBox!.y + eastResizeBox!.height / 2, { steps: 4 });
  await page.mouse.up();
  const miniAfterEastResize = await miniPlayer.boundingBox();
  expect(miniAfterEastResize).not.toBeNull();
  expect(miniAfterEastResize!.width).toBeGreaterThan(miniAfterResize!.width + 20);

  await expect(originals.getByRole("button", { name: /Add Tokino Sora Original Song to queue/ })).toHaveCount(0);
  await originals.getByRole("button", { name: /^Add Tokino Sora Original Song to playlist$/ }).click();
  await expect(originals.getByRole("menu", { name: /^Choose playlist for Tokino Sora Original Song$/ })).toBeVisible();
  await originals.getByRole("menuitemcheckbox", { name: /Shelf Picks/ }).click();
  await page.getByRole("button", { name: "Close profile" }).click();

  await page.getByRole("link", { name: "Player" }).click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(0);
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Original Song 2");
  const shelfPicks = page.locator(".hololive-playlist-entry").filter({ hasText: "Shelf Picks" });
  await expect(shelfPicks.locator(".hololive-playlist-toggle strong")).toHaveText("2");
  await shelfPicks.locator(".hololive-playlist-toggle").click();
  await expect(shelfPicks.locator(".hololive-player-song-list li")).toHaveCount(2);
  await expect(shelfPicks).toContainText("Tokino Sora Original Song");

  await page.getByRole("link", { name: "Tier Lists" }).click();
  const reopenedMiniPlayer = page.locator(".hololive-persistent-player.mini");
  await expect(reopenedMiniPlayer).toBeVisible();
  await reopenedMiniPlayer.getByRole("button", { name: "Close mini player" }).click();
  await expect(page.locator(".hololive-persistent-player.mini")).toHaveCount(0);
  await tokinoTile.click();
  const clearedOriginals = page.locator(".hololive-profile-shelf .hololive-profile-accordion").filter({ hasText: "Original Songs" });
  await clearedOriginals.locator("summary").click();
  await expect(clearedOriginals.locator(".hololive-song-row.playing")).toHaveCount(0);
  await expect(clearedOriginals.locator('.hololive-song-row[data-song-id="tokino-sora-mock-original-2"]')).not.toHaveClass(/playing/);
  const playCountAfterClose = await page.evaluate(
    () => (window as typeof window & { __holoshelfYoutubePlayCount?: number }).__holoshelfYoutubePlayCount ?? 0
  );
  await clearedOriginals.getByRole("button", { name: /^Play Tokino Sora Original Song 2 now$/ }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __holoshelfYoutubePlayCount?: number }).__holoshelfYoutubePlayCount ?? 0))
    .toBeGreaterThan(playCountAfterClose);
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __holoshelfYoutubeLastVideoId?: string | null }).__holoshelfYoutubeLastVideoId)
    )
    .toBe("tokino-sora-mock-original-2");
  await page.locator(".hololive-persistent-player.mini").getByRole("button", { name: "Close mini player" }).click();
  await expect(page.locator(".hololive-persistent-player.mini")).toHaveCount(0);
  await page.getByRole("button", { name: "Close profile" }).click();
  await page.reload();
  await expect(page.locator(".hololive-persistent-player.mini")).toHaveCount(0);
});

test("does not open an idol profile while dragging", async ({ page }) => {
  const tokinoTile = page.locator('.hololive-pool .hololive-idol-tile[data-idol-id="tokino-sora"]').first();
  const sourceBox = await tokinoTile.boundingBox();

  expect(sourceBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await expect(tokinoTile).toHaveCSS("cursor", "pointer");
  await page.mouse.down();

  try {
    await expect(page.locator("body")).not.toHaveClass(/hololive-idol-dragging/);
    await page.mouse.move(sourceBox!.x + 120, sourceBox!.y + 8, { steps: 8 });
    await expect(page.locator("body")).toHaveClass(/hololive-idol-dragging/);
    await expect(page.locator("body")).toHaveCSS("cursor", "grabbing");
  } finally {
    await page.mouse.up();
  }

  await expect(page.locator(".hololive-profile-shelf")).toHaveCount(0);
});

test("uses Hololive view tabs without a sidebar", async ({ page }) => {
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".nav-item")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tier Lists" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Player" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Talents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Brackets" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/settings$/);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveClass(/active/);
  await expect(page.locator(".hololive-settings-panel")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^Save$/ })).toBeVisible();
});

test("keeps the Hololive tabs sticky while the workspace scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.reload();
  await page.locator(".hololive-tier-row").first().waitFor();

  const result = await page.evaluate(() => {
    const workspace = document.querySelector(".workspace") as HTMLElement;
    const appFrame = document.querySelector(".app-frame") as HTMLElement;
    const switcher = document.querySelector(".hololive-view-switch") as HTMLElement;
    const beforeTop = switcher.getBoundingClientRect().top;
    workspace.scrollTop = 420;
    const afterTop = switcher.getBoundingClientRect().top;

    return {
      appFrameWidth: appFrame.getBoundingClientRect().width,
      afterTop,
      beforeTop,
      scrollTop: workspace.scrollTop,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      workspaceOverflowY: getComputedStyle(workspace).overflowY
    };
  });

  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.afterTop).toBeGreaterThanOrEqual(0);
  expect(result.afterTop).toBeLessThanOrEqual(result.beforeTop);
  expect(Math.abs(result.appFrameWidth - result.viewportWidth)).toBeLessThan(2);
  expect(result.workspaceOverflowY).toBe("auto");
});

test("shows delete row action only from the delete notch", async ({ page }) => {
  const firstRow = page.locator(".hololive-tier-row").first();
  const deleteButton = firstRow.locator(".hololive-tier-delete-button");
  const addButtons = firstRow.locator(".hololive-tier-add-button");

  await expect(deleteButton).toHaveCSS("opacity", "0");
  await expect(addButtons.first()).toHaveCSS("opacity", "0");
  await firstRow.locator(".hololive-tier-label").hover();
  await expect(deleteButton).toHaveCSS("opacity", "0");
  await expect(addButtons.first()).toHaveCSS("opacity", "0");
  await firstRow.locator(".hololive-tier-delete-notch").hover();
  await expect(deleteButton).toHaveCSS("opacity", "1");
  await expect(addButtons.first()).toHaveCSS("opacity", "1");
});

test("adds boards from the portfolio tab strip", async ({ page }) => {
  const tabs = page.locator(".hololive-board-tab");

  await expect(tabs).toHaveCount(1);
  await page.getByTitle("Add board").click();

  await expect(tabs).toHaveCount(2);
  await expect(page.locator(".hololive-board-tab.active")).toContainText("tier list 2");
  await page.mouse.move(12, 12);
  await expect(page.locator(".hololive-board-tab.active .hololive-board-tab-delete")).toHaveCSS("opacity", "0");
  await page.locator(".hololive-board-tab.active").hover();
  await expect(page.locator(".hololive-board-tab.active .hololive-board-tab-delete")).toHaveCSS("opacity", "1");
  const activeNameBox = await page.locator(".hololive-board-tab.active .hololive-board-tab-name").boundingBox();
  const activeDeleteBox = await page.locator(".hololive-board-tab.active .hololive-board-tab-delete").boundingBox();
  const addBoardBox = await page.locator(".hololive-board-add-button").boundingBox();
  expect((activeDeleteBox?.x ?? 0) - ((activeNameBox?.x ?? 0) + (activeNameBox?.width ?? 0))).toBeGreaterThanOrEqual(-1);
  expect(addBoardBox?.width).toBeLessThanOrEqual(26);
  await expect(page.locator(".hololive-board-add-button")).toHaveCSS("border-top-left-radius", "0px");
  await expect(page.locator(".hololive-size-control")).toHaveCount(0);
});

test("inserts new boards to the right of the current tab", async ({ page }) => {
  const tabs = page.locator(".hololive-board-tab");

  await page.getByTitle("Add board").click();
  await expect(tabs).toHaveCount(2);
  await page.locator(".hololive-board-tab").filter({ hasText: "tier list 1" }).locator(".hololive-board-tab-name").click();
  await page.getByTitle("Add board").click();

  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toContainText("tier list 1");
  await expect(tabs.nth(1)).toContainText("tier list 3");
  await expect(tabs.nth(2)).toContainText("tier list 2");
});

test("drags board tabs to reorder them", async ({ page }) => {
  const tabs = page.locator(".hololive-board-tab");

  await page.getByTitle("Add board").click();
  await page.getByTitle("Add board").click();
  await expect(tabs).toHaveCount(3);

  const sourceBox = await tabs.nth(2).boundingBox();
  const targetBox = await tabs.nth(0).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + 12, targetBox!.y + 16, { steps: 12 });
  await expect(page.locator("body")).not.toHaveClass(/hololive-dnd-active/);
  await page.mouse.up();

  await expect(tabs.nth(0)).toContainText("tier list 3");
  await expect(tabs.nth(1)).toContainText("tier list 1");
  await expect(tabs.nth(2)).toContainText("tier list 2");
});

test("renames board tabs with a double click", async ({ page }) => {
  const activeTab = page.locator(".hololive-board-tab.active");
  const beforeBox = await activeTab.boundingBox();

  await activeTab.locator(".hololive-board-tab-name").dblclick();
  await expect(activeTab.locator(".hololive-board-rename-input")).toBeVisible();
  const renameBox = await activeTab.boundingBox();
  expect(Math.abs((renameBox?.width ?? 0) - (beforeBox?.width ?? 0))).toBeLessThanOrEqual(1);

  await activeTab.locator(".hololive-board-rename-input").fill("cancelled");
  await page.locator(".hololive-tier-board").click({ position: { x: 240, y: 16 } });
  await expect(activeTab.locator(".hololive-board-tab-name")).toHaveText("tier list 1");

  await activeTab.locator(".hololive-board-tab-name").dblclick();
  await expect(activeTab.locator(".hololive-board-rename-input")).toBeFocused();
  await activeTab.locator(".hololive-board-rename-input").fill("");
  await activeTab.locator(".hololive-board-rename-input").type("favorites");
  await activeTab.locator(".hololive-board-rename-input").press("Enter");

  await expect(activeTab.locator(".hololive-board-tab-name")).toHaveText("favorites");
});

test("adds tier rows from the row options notch", async ({ page }) => {
  const firstRow = page.locator(".hololive-tier-row").first();

  await firstRow.locator(".hololive-tier-delete-notch").hover();
  await firstRow.getByRole("button", { name: "Add row below S" }).click();

  await expect(page.locator(".hololive-tier-row")).toHaveCount(7);
  await expect(page.locator('.hololive-tier-label input[type="text"]').nth(1)).toHaveValue("Tier 7");
});

test("drags idols into a tier and clears the board", async ({ page }) => {
  const firstTier = page.locator(".hololive-tier-row").first();
  const firstTierDropzone = firstTier.locator(".hololive-tier-dropzone");
  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  const rowBefore = await firstTier.boundingBox();

  await dragCenterTo(page, poolTiles.first(), firstTierDropzone, { x: 36, y: 36 });

  const rowAfter = await firstTier.boundingBox();
  const placedTileBox = await firstTier.locator(".hololive-idol-tile").first().boundingBox();
  expect(Math.abs((rowAfter?.height ?? 0) - (rowBefore?.height ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rowAfter?.height ?? 0) - ((placedTileBox?.height ?? 0) + 12))).toBeLessThanOrEqual(1);
  await expect(firstTier.locator(".hololive-idol-tile")).toHaveCount(1);
  await expect(firstTier.locator(".hololive-idol-tile").first()).toHaveAttribute("data-idol-id", "tokino-sora");
  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(73);
  await expect(page.locator(".hololive-idol-tile:disabled")).toHaveCount(0);
  await expect(page.locator(".drop-over")).toHaveCount(0);

  const clearButton = page.getByRole("button", { name: /Clear/ });
  await expect(clearButton).toBeEnabled();
  await clearButton.click();

  await expect(firstTier.locator(".hololive-idol-tile")).toHaveCount(0);
  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(74);
  await expect(page.locator(".hololive-pool .hololive-idol-tile").first()).toHaveAttribute("data-idol-id", "tokino-sora");
});

test("slides neighboring idols aside while dragging", async ({ page }) => {
  await page.getByRole("button", { name: /Clear/ }).click();

  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  await expect(poolTiles).toHaveCount(74);

  const sourceBox = await poolTiles.first().boundingBox();
  const targetBox = await poolTiles.nth(5).boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();

  try {
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });

    await expect
      .poll(
        async () =>
          poolTiles.nth(1).evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              duration: style.transitionDuration,
              property: style.transitionProperty,
              timing: style.transitionTimingFunction,
              transform: style.transform
            };
          }),
        { timeout: 1000 }
      )
      .toMatchObject({
        duration: /^(?!0s)/,
        property: /transform/,
        timing: /cubic-bezier/,
        transform: /^(?!none$)/
      });
  } finally {
    await page.mouse.up();
  }
});

test("shows a translucent placement preview while dragging an idol", async ({ page }) => {
  await page.getByRole("button", { name: /Clear/ }).click();

  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  await expect(poolTiles).toHaveCount(74);

  const sourceBox = await poolTiles.first().boundingBox();
  const targetBox = await poolTiles.nth(5).boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();

  try {
    await page.mouse.move(targetBox!.x + 4, targetBox!.y + targetBox!.height / 2, { steps: 12 });

    await expect(page.locator(".hololive-idol-tile.dragging")).toHaveCount(1);
    await expect(page.locator(".hololive-idol-tile.dragging")).toHaveAttribute("data-idol-id", "tokino-sora");

    const opacity = await page.locator(".hololive-idol-tile.dragging").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).opacity)
    );
    const dragVisuals = await page.evaluate(() => {
      const preview = document.querySelector(".hololive-idol-tile.dragging");
      const overlay = document.querySelector(".hololive-idol-tile.overlay");
      const pool = document.querySelector(".hololive-pool");
      const previewStyle = preview ? getComputedStyle(preview) : null;
      const overlayStyle = overlay ? getComputedStyle(overlay) : null;
      const poolStyle = pool ? getComputedStyle(pool) : null;

      return {
        bodyCursor: getComputedStyle(document.body).cursor,
        poolCursor: poolStyle?.cursor ?? null,
        previewShadow: previewStyle?.boxShadow ?? null,
        overlayShadow: overlayStyle?.boxShadow ?? null
      };
    });

    expect(opacity).toBeGreaterThan(0.2);
    expect(opacity).toBeLessThan(0.75);
    expect(dragVisuals.bodyCursor).toBe("grabbing");
    expect(dragVisuals.poolCursor).toBe("grabbing");
    expect(dragVisuals.previewShadow).toContain("inset");
    expect(dragVisuals.previewShadow).not.toContain("14px");
    expect(dragVisuals.overlayShadow).toContain("18px");
    expect(dragVisuals.overlayShadow).not.toContain("30px");
  } finally {
    await page.mouse.up();
  }
});

test("drags within the unranked shelf without blanking the shelf", async ({ page }) => {
  await page.getByRole("button", { name: /Clear/ }).click();

  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  await expect(poolTiles).toHaveCount(74);

  await expect(poolTiles.first()).toHaveAttribute("data-idol-id", "tokino-sora");
  await dragCenterTo(page, poolTiles.first(), poolTiles.nth(4), { x: 4, y: 28 });

  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(74);
  await expect(page.locator(".hololive-tier-row .hololive-idol-tile")).toHaveCount(0);
  await expect(page.locator(".hololive-pool .hololive-idol-tile").first()).toHaveAttribute("data-idol-id", "roboco-san");
  await expect(page.locator(".hololive-pool .hololive-idol-tile").nth(3)).toHaveAttribute("data-idol-id", "tokino-sora");
  await expect(page.locator(".hololive-pool")).toContainText("Unranked");
});

test("places idols before and after target icons without snap-back", async ({ page }) => {
  await page.getByRole("button", { name: /Clear/ }).click();

  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  await expect(poolTiles).toHaveCount(74);

  await dragCenterTo(page, poolTiles.first(), poolTiles.nth(4), { x: 4, y: 32 });
  await expect(poolTiles.nth(3)).toHaveAttribute("data-idol-id", "tokino-sora");

  await page.getByRole("button", { name: /Clear/ }).click();
  await expect(poolTiles.first()).toHaveAttribute("data-idol-id", "tokino-sora");

  await dragCenterTo(page, poolTiles.first(), poolTiles.nth(4), { x: 60, y: 32 });
  await expect(poolTiles.nth(4)).toHaveAttribute("data-idol-id", "tokino-sora");
});

test("drags idols back from a tier into a precise pool position", async ({ page }) => {
  await page.getByRole("button", { name: /Clear/ }).click();

  const firstTier = page.locator(".hololive-tier-row").first();
  const firstTierDropzone = firstTier.locator(".hololive-tier-dropzone");
  const poolDropzone = page.locator(".hololive-pool .hololive-tier-dropzone");
  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");

  await dragCenterTo(page, poolTiles.first(), firstTierDropzone, { x: 36, y: 36 });
  await expect(firstTier.locator(".hololive-idol-tile")).toHaveCount(1);
  await expect(firstTier.locator(".hololive-idol-tile").first()).toHaveAttribute("data-idol-id", "tokino-sora");

  await dragCenterTo(page, firstTier.locator(".hololive-idol-tile").first(), poolDropzone, { x: 4, y: 36 });
  await expect(firstTier.locator(".hololive-idol-tile")).toHaveCount(0);
  await expect(poolTiles).toHaveCount(74);
  await expect(poolTiles.first()).toHaveAttribute("data-idol-id", "tokino-sora");
});

test("survives repeated icon repositioning without renderer errors or blanking", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByRole("button", { name: /Clear/ }).click();
  const poolTiles = page.locator(".hololive-pool .hololive-idol-tile");
  await expect(poolTiles).toHaveCount(74);

  const sourceBox = await poolTiles.first().boundingBox();
  expect(sourceBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();

  for (const index of [8, 2, 12, 4, 16, 6, 20, 10]) {
    const targetBox = await poolTiles.nth(index).boundingBox();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 10 });
  }

  await page.mouse.up();

  await expect(page.locator(".hololive-tier-workspace")).toBeVisible();
  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(74);
  expect(pageErrors).toEqual([]);
});

test("drags tier rows by the grip handle", async ({ page }) => {
  const firstGrip = page.locator(".hololive-tier-grip").first();
  const secondRow = page.locator(".hololive-tier-row").nth(1);

  await expect(page.locator('.hololive-tier-label input[type="text"]').first()).toHaveValue("S");
  await dragCenterTo(page, firstGrip, secondRow, { x: 40, y: 36 });

  await expect(page.locator('.hololive-tier-label input[type="text"]').first()).toHaveValue("A");
  await expect(page.locator('.hololive-tier-label input[type="text"]').nth(1)).toHaveValue("S");
});
