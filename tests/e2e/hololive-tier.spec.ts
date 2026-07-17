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

async function createBracket(
  page: Page,
  size: string,
  name: string,
  format: "Single" | "Double" = "Single"
): Promise<void> {
  await page.getByRole("button", { name: "Create" }).click();
  const popover = page.locator(".hololive-bracket-create-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("radio", { name: size }).click();
  await popover.getByRole("radio", { name: format, exact: true }).click();
  await popover.getByRole("radio", { name: "Random Songs" }).click();
  await popover.getByLabel("Name").fill(name);
  await popover.getByRole("button", { name: "Create Bracket" }).click();
  await expect(popover).toHaveCount(0);
}

async function bracketVerticalFitGap(viewport: Locator): Promise<number> {
  return viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    const paddingBottom = Number.parseFloat(window.getComputedStyle(element).paddingBottom || "0");
    const matchBottom = Math.max(
      ...Array.from(element.querySelectorAll<HTMLElement>(".hololive-bracket-match-body")).map(
        (match) => match.getBoundingClientRect().bottom
      )
    );
    return viewportRect.bottom - paddingBottom - matchBottom;
  });
}

async function bracketHorizontalFitGap(viewport: Locator): Promise<number> {
  return viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    const paddingRight = Number.parseFloat(window.getComputedStyle(element).paddingRight || "0");
    const contentRight = Math.max(
      ...Array.from(
        element.querySelectorAll<HTMLElement>(
          ".hololive-bracket-round > header, .hololive-bracket-match-body, .hololive-bracket-champion-strip"
        )
      ).map((content) => content.getBoundingClientRect().right)
    );
    return viewportRect.right - paddingRight - contentRight;
  });
}

async function bracketPanPoint(viewport: Locator): Promise<{ x: number; y: number }> {
  return viewport.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let y = rect.top + 30; y < rect.bottom - 30; y += 24) {
      for (let x = rect.left + 30; x < rect.right - 30; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (
          target &&
          element.contains(target) &&
          !target.closest("button, input, select, a, [data-bracket-selectable-text]")
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("Could not find a bracket pan surface.");
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Mock YouTube</title>" });
  });
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

test("@smoke renders the Hololive tier list route", async ({ page }) => {
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".search-box")).toHaveCount(0);
  await expect(page.locator(".path-chip")).toHaveCount(0);
  await expect(page.locator(".hololive-heading")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hololive" })).toHaveCount(0);
  await expect(page.locator(".page")).toHaveCount(0);
  await expect(page.locator(".hololive-page.hololive-tier-layout")).toHaveCount(1);
  await expect(page.locator(".hololive-page > .hololive-tier-layout")).toHaveCount(0);
  await expect(page.locator(".hololive-tier-layout .hololive-board-tabs")).toHaveCount(1);
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
  expect(firstTabBox?.x ?? 999).toBeLessThan(32);
  expect((firstResizerBox?.x ?? 0) - (firstTabBox?.x ?? 0)).toBeGreaterThan(40);
  expect(poolBox?.height).toBeGreaterThan(100);
});

test("@smoke shows installed update notes and acknowledges them", async ({ page }) => {
  await page.goto("/?updatePreview=1#/module/hololive");

  const dialog = page.getByRole("dialog", { name: "What's new in Holoshelf 1.1.7" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Official song removals now carry into installed libraries");
  await expect(dialog).toContainText("Playlists, ratings, brackets, and custom imports remain protected");

  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toHaveCount(0);
});

test("renders bracket result exports with bounded layouts for every bracket size", async ({ page }) => {
  const thumbnailPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({
      body: thumbnailPng,
      contentType: "image/png",
      headers: {
        "access-control-allow-origin": "*"
      }
    })
  );

  const results = await page.evaluate(async () => {
    const { calculateHololiveBracketExportLayout, renderHololiveBracketExportPng } = await import(
      "/src/renderer/lib/hololiveBracketExport.ts"
    );

    function roundLabel(size: number, roundIndex: number) {
      const roundSize = size / 2 ** roundIndex;
      if (roundSize === 2) {
        return "Final";
      }
      if (roundSize === 4) {
        return "Semi Final";
      }
      if (roundSize === 8) {
        return "Quarter Final";
      }
      return `Round of ${roundSize}`;
    }

    function makeEntry(index: number, size: number) {
      return {
        id: `entry-${index}`,
        bracketId: `export-${size}`,
        slotIndex: index,
        youtubeVideoId: "exportthumb",
        title: `Export Song ${index + 1}`,
        songName: null,
        topicId: "Original_Song" as const,
        youtubeUrl: "https://www.youtube.com/watch?v=exportthumb",
        channelName: "Export Channel",
        idolId: `idol-${index % 8}`,
        idolName: `Talent ${index % 8}`,
        canonicalPerformanceKey: `export-song-${index}`,
        viewCount: 1_000_000 + index,
        publishedAt: "2026-01-01T00:00:00.000Z",
        durationSeconds: 210
      };
    }

    function makeBracket(size: number) {
      const entries = Array.from({ length: size }, (_, index) => makeEntry(index, size));
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      let activeEntryIds = entries.map((entry) => entry.id);
      const rounds = [];
      let roundIndex = 0;

      while (activeEntryIds.length > 1) {
        const winners = [];
        const matches = [];
        for (let index = 0; index < activeEntryIds.length; index += 2) {
          const entryA = byId.get(activeEntryIds[index]);
          const entryB = byId.get(activeEntryIds[index + 1]);
          if (!entryA || !entryB) {
            continue;
          }
          winners.push(entryA.id);
          matches.push({
            id: `r${roundIndex}-m${index / 2}`,
            bracketId: `export-${size}`,
            roundIndex,
            matchIndex: index / 2,
            entryA,
            entryB,
            winnerEntryId: entryA.id,
            winner: entryA,
            completedAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z"
          });
        }
        rounds.push({
          roundIndex,
          label: roundLabel(size, roundIndex),
          matches
        });
        activeEntryIds = winners;
        roundIndex += 1;
      }

      return {
        id: `export-${size}`,
        name: `Export RO${size}`,
        size: `RO${size}`,
        generationStyle: "random",
        generationFilters: {},
        seed: "export-test",
        status: "completed",
        currentMatchId: null,
        currentMatch: null,
        champion: entries[0],
        entries,
        rounds,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      };
    }

    function makeDoubleBracket(size: number) {
      const entries = Array.from({ length: size }, (_, index) => makeEntry(index, size));
      let globalRoundIndex = 0;
      let playOrder = 0;
      const makeStageRound = (
        stage: "winners" | "losers" | "grand_final",
        stageRoundIndex: number,
        matchCount: number
      ) => {
        const matches = Array.from({ length: matchCount }, (_, matchIndex) => {
          const entryA = entries[0];
          const entryB = entries[(matchIndex + stageRoundIndex + 1) % entries.length];
          return {
            id: `${stage}-${stageRoundIndex}-${matchIndex}`,
            bracketId: `export-double-${size}`,
            roundIndex: globalRoundIndex,
            matchIndex,
            stage,
            stageRoundIndex,
            playOrder: playOrder++,
            lateRoundWeight: stage === "grand_final" ? 1.5 : 0,
            engineMatchId: playOrder,
            entryA,
            entryB,
            winnerEntryId: entryA.id,
            winner: entryA,
            completedAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z"
          };
        });
        const label =
          stage === "winners"
            ? roundLabel(size, stageRoundIndex)
            : stage === "losers"
              ? `Losers Round ${stageRoundIndex + 1}`
              : "Grand Final";
        const round = { roundIndex: globalRoundIndex, stage, stageRoundIndex, label, matches };
        globalRoundIndex += 1;
        return round;
      };
      const rounds = [];
      const winnerRoundCount = Math.log2(size);
      for (let index = 0; index < winnerRoundCount; index += 1) {
        rounds.push(makeStageRound("winners", index, size / 2 ** (index + 1)));
      }
      const loserCounts = [];
      for (let count = size / 4; count >= 1; count /= 2) {
        loserCounts.push(count, count);
      }
      loserCounts.forEach((count, index) => rounds.push(makeStageRound("losers", index, count)));
      rounds.push(makeStageRound("grand_final", 0, 1));
      return {
        id: `export-double-${size}`,
        name: `Export Double RO${size}`,
        size: `RO${size}`,
        format: "double_elimination",
        generationStyle: "random_songs",
        generationFilters: {},
        seed: "export-double-test",
        status: "complete",
        currentMatchId: null,
        currentMatch: null,
        champion: entries[0],
        entries,
        rounds,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      };
    }

    function measureDataUrl(dataUrl: string) {
      return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Could not load exported bracket image."));
        image.src = dataUrl;
      });
    }

    const sizes = [16, 32, 64, 128, 256];
    const rendered = [];
    for (const size of sizes) {
      const bracket = makeBracket(size);
      const baseMatches = Math.max(1, bracket.rounds[0].matches.length / 2);
      const layout = calculateHololiveBracketExportLayout(bracket.rounds.length - 1, baseMatches);
      const dataUrl = await renderHololiveBracketExportPng(bracket as never);
      rendered.push({
        size,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        image: await measureDataUrl(dataUrl)
      });
    }
    const doubleRendered = [];
    for (const size of sizes) {
      const dataUrl = await renderHololiveBracketExportPng(makeDoubleBracket(size) as never);
      doubleRendered.push({ size, image: await measureDataUrl(dataUrl) });
    }
    return { single: rendered, double: doubleRendered };
  });

  for (const result of results.single) {
    expect(result.image.width).toBe(Math.ceil(result.layoutWidth * 1.25));
    expect(result.image.height).toBe(Math.ceil(result.layoutHeight * 1.25));
    expect(result.image.width).toBeLessThanOrEqual(8192);
    expect(result.image.height).toBeLessThanOrEqual(8192);
  }
  expect(results.single[0].image.width).toBeLessThan(results.single[1].image.width);
  expect(results.single.at(-1)?.image.width).toBeLessThan(3000);
  for (const result of results.double) {
    expect(result.image.width).toBeGreaterThan(0);
    expect(result.image.height).toBeGreaterThan(0);
    expect(result.image.width).toBeLessThanOrEqual(8192);
    expect(result.image.height).toBeLessThanOrEqual(8192);
  }
});

test("adds a custom talent from a channel handle", async ({ page }) => {
  await page.getByRole("link", { name: "Custom Import" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/custom-import/);
  await expect(page.locator(".hololive-custom-import-layout")).toBeVisible();
  await expect(page.locator(".hololive-custom-import-page.hololive-custom-import-layout")).toHaveCount(1);
  await expect(page.locator(".hololive-custom-import-page > .hololive-custom-import-layout")).toHaveCount(0);
  await expect(page.locator(".hololive-custom-talent-row")).toHaveCount(0);

  await page.getByLabel("Channel").fill("@SoradukiTyra");
  await page.getByLabel("Overview image").fill(
    "https://static.wikia.nocookie.net/virtualyoutuber/images/c/cc/ReawakeR_Tyra.jpg/revision/latest?cb=20260516193557"
  );
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".hololive-talent-preview")).toContainText("Soraduki Tyra");
  await expect(page.locator(".hololive-talent-preview")).toContainText("UCdQYcUyffHZoz0KOwuiG0lQ");

  await page.getByRole("button", { name: "Save" }).click();
  const customRow = page.locator(".hololive-custom-talent-row").filter({ hasText: "Soraduki Tyra" });
  await expect(customRow).toBeVisible();
  await expect(customRow).toContainText("Independents");
  await expect(customRow).toContainText("42,100");

  await page.getByRole("button", { name: "Refresh All" }).click();
  await expect(page.locator(".hololive-action-toast")).toContainText("Custom refresh complete");
  await expect(page.locator(".hololive-action-toast")).toContainText("view counts");

  await page.getByRole("link", { name: "Tier List" }).click();
  await expect(page.locator(".hololive-pool .hololive-idol-tile")).toHaveCount(75);
  await expect(page.locator('.hololive-pool .hololive-idol-tile[data-idol-id="custom-soraduki-tyra"]')).toBeVisible();
});

test("@smoke requires complete custom song metadata before import save", async ({ page }) => {
  await page.getByRole("link", { name: "Custom Import" }).click();
  await page.getByRole("button", { name: "Import Song" }).click();
  const sheet = page.locator(".hololive-custom-song-sheet");
  const saveButton = sheet.getByRole("button", { name: "Save" });

  await expect(sheet).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Import Song" }).click();
  await expect(sheet).toBeVisible();
  await page.locator(".hololive-custom-song-panel").click({ position: { x: 4, y: 4 } });
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Import Song" }).click();
  await expect(sheet).toBeVisible();

  await sheet.getByLabel("YouTube link").fill("https://youtu.be/manual12345");
  await sheet.getByLabel("Title").fill("Manual Import Song");
  await sheet.getByRole("button", { name: "Choose owners" }).click();
  await page.getByRole("button", { name: "Tokino Sora" }).click();
  await sheet.getByLabel("Channel").fill("Manual Channel");
  await expect(saveButton).toBeDisabled();

  await sheet.getByLabel("Published").fill("not a date");
  await expect(saveButton).toBeDisabled();
  await sheet.getByLabel("Published").fill("2026-07-01");
  await expect(saveButton).toBeEnabled();

  await sheet.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Import Song" }).click();
  const apiSheet = page.locator(".hololive-custom-song-sheet");
  const apiSaveButton = apiSheet.getByRole("button", { name: "Save" });
  await apiSheet.getByLabel("YouTube link").fill("https://youtu.be/apiSong1234");
  await apiSheet.getByRole("button", { name: "Load" }).click();
  await expect(apiSheet.getByLabel("Title")).toHaveValue("Mock Imported Song");
  await expect(apiSheet.getByLabel("Channel")).toHaveValue("Mock Import Channel");
  await apiSheet.getByRole("button", { name: "Choose owners" }).click();
  await page.getByRole("button", { name: "Tokino Sora" }).click();
  await expect(apiSaveButton).toBeEnabled();
  await apiSaveButton.click();
  await expect(apiSheet).toBeHidden();

  const customSongRow = page.locator(".hololive-custom-song-row").filter({ hasText: "Mock Imported Song" });
  await expect(customSongRow).toBeVisible();
  await customSongRow.getByRole("button", { name: /Edit/ }).click();
  await expect(page.locator(".hololive-custom-song-sheet")).toContainText("Edit Song");
});

test("@smoke creates and plays through a Hololive bracket matchup", async ({ page }) => {
  await page.route("https://i.ytimg.com/vi/**/maxresdefault.jpg", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#777"/></svg>'
    });
  });
  await page.route("https://i.ytimg.com/vi/**/maxres1.jpg", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#7b62c6"/></svg>'
    });
  });
  await page.getByRole("link", { name: "Player" }).click();
  await page.getByTitle("Create playlist").click();
  await page.getByLabel("New playlist name").fill("Arena Picks");
  await page.getByTitle("Create new playlist").click();
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Arena Picks");
  await page.locator(".hololive-action-toast").filter({ hasText: "Playlist created" }).click();
  await expect(page.locator(".hololive-action-toast")).toHaveCount(0);

  await page.getByRole("link", { name: "Bracket" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/bracket/);
  await expect(page.locator(".hololive-bracket-layout")).toBeVisible();
  await expect(page.locator(".hololive-bracket-page.hololive-bracket-layout")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-page > .hololive-bracket-layout")).toHaveCount(0);
  await expect(page.locator(".hololive-bracket-empty")).toContainText("No saved brackets yet");
  await expect(page.locator(".hololive-bracket-toolbar .compact-select")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-create-popover")).toHaveCount(0);

  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".hololive-bracket-create-popover")).toBeVisible();
  await page.getByRole("radio", { name: "RO16" }).click();
  await expect(page.getByRole("radio", { name: "RO16" })).toBeChecked();
  await page.getByRole("radio", { name: "Random Songs" }).click();
  await expect(page.getByRole("radio", { name: "Random Songs" })).toBeChecked();
  const createPopover = page.locator(".hololive-bracket-create-popover");
  const collapsedPopoverBox = await createPopover.boundingBox();
  const collapsedNameBox = await createPopover.getByLabel("Name").boundingBox();
  const collapsedPoolBox = await createPopover.locator(".hololive-bracket-filter-row").boundingBox();
  expect(collapsedPopoverBox?.width).toBeLessThanOrEqual(461);
  await createPopover.getByRole("button", { name: /Edit Filters/ }).click();
  const expandedNameBox = await createPopover.getByLabel("Name").boundingBox();
  const expandedPoolBox = await createPopover.locator(".hololive-bracket-filter-row").boundingBox();
  expect(Math.abs((expandedNameBox?.y ?? 0) - (collapsedNameBox?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((expandedPoolBox?.y ?? 0) - (collapsedPoolBox?.y ?? 0))).toBeLessThanOrEqual(1);
  expect((expandedPoolBox?.y ?? 0) - ((expandedNameBox?.y ?? 0) + (expandedNameBox?.height ?? 0))).toBeGreaterThanOrEqual(8);
  await expect(createPopover.getByRole("checkbox", { name: "Active", exact: true })).toBeChecked();
  await expect(createPopover.getByRole("checkbox", { name: "Alumni", exact: true })).toBeChecked();
  await expect(createPopover.getByRole("checkbox", { name: "Custom", exact: true })).toBeChecked();
  await createPopover.getByRole("checkbox", { name: "Alumni", exact: true }).uncheck();
  await expect(createPopover.locator(".hololive-bracket-filter-chips")).toContainText("Active + Custom");
  await createPopover.getByRole("combobox", { name: "History participation" }).click();
  await createPopover.getByRole("option", { name: "Never appeared" }).click();
  await expect(createPopover.locator(".hololive-bracket-filter-chips")).toContainText("Never appeared");
  await expect(createPopover.getByLabel("Solo songs")).toBeChecked();
  await expect(createPopover.getByLabel("Group Songs")).toBeChecked();
  await createPopover.getByLabel("Group Songs").uncheck();
  await expect(createPopover.getByLabel("Solo songs")).toBeDisabled();
  await expect(createPopover.locator(".hololive-bracket-filter-chips")).toContainText("Solo only");
  await expect(createPopover.getByRole("checkbox", { name: "Max per talent", exact: true })).toBeChecked();
  await expect(createPopover.getByLabel("Max songs per talent")).toBeEnabled();
  await expect(createPopover.getByLabel("Max songs per talent")).toHaveValue("2");
  await createPopover.getByLabel("Max songs per talent").fill("1");
  await createPopover.getByRole("checkbox", { name: "Prefer original/cover split", exact: true }).uncheck();
  await expect(createPopover.locator(".hololive-bracket-filter-chips")).toContainText("Max 1 per talent");
  await expect(createPopover.locator(".hololive-bracket-filter-chips")).toContainText("No type split");
  await page.locator(".hololive-bracket-create-popover").getByLabel("Name").fill("Singer Showdown");
  await page.getByRole("button", { name: "Create Bracket" }).click();
  const relaxedCapToast = page.locator(".hololive-action-toast").filter({ hasText: "Max per talent was relaxed" });
  await expect(relaxedCapToast).toHaveCount(0);

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
  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Undo pick" }).click();
  await expect(page.locator(".hololive-bracket-match.current .hololive-bracket-match-label")).toContainText("R1-1");

  await page.getByRole("button", { name: "Play" }).click();
  for (let index = 0; index < 8; index += 1) {
    await page.locator(".hololive-bracket-pick-button").first().click();
  }
  await expect(page.locator(".hololive-bracket-arena-meta .song-record")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-arena-meta .song-record").first()).toContainText("1-0 W-L");
  for (let index = 0; index < 7; index += 1) {
    await page.locator(".hololive-bracket-pick-button").first().click();
  }
  await expect(page.locator(".hololive-bracket-champion")).toContainText("Champion");
  await page.getByRole("button", { name: "Export" }).click();
  const exportToast = page.locator(".hololive-export-toast");
  await expect(exportToast).toContainText("Bracket image saved");
  await expect(exportToast).toContainText("mock-bracket-export.png");
  await expect(exportToast).toHaveCSS("position", "fixed");
  await expect(exportToast).toHaveCSS("top", "42px");
  await expect(exportToast.locator(".hololive-toast-progress")).toBeVisible();
  await exportToast.click();
  await expect(exportToast).toHaveCount(0);

  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.locator(".hololive-bracket-stats-view")).toBeVisible();
  await expect(page.locator(".hololive-bracket-stats-totals")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Talent View" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Song View" })).toBeEnabled();
  const overviewAwards = page.locator(".hololive-bracket-award-grid");
  await expect(overviewAwards.locator(".hololive-bracket-award-card")).toHaveCount(12);
  await expect(overviewAwards).toContainText("Top Talent");
  await expect(overviewAwards).toContainText("Most Titles");
  await expect(overviewAwards).toContainText("Most Deep Runs");
  await expect(overviewAwards).toContainText("Strength of Wins");
  await expect(overviewAwards).toContainText("Most Clutch");
  await expect(overviewAwards).toContainText("Overperformer");
  await expect(overviewAwards).toContainText("Most Wins");
  await expect(overviewAwards).toContainText("Most 2nd Places");
  await expect(overviewAwards).toContainText("Most Early Exits");
  await expect(overviewAwards).toContainText("Strength of Losses");
  await expect(overviewAwards).toContainText("Under Pressure");
  await expect(overviewAwards).toContainText("Most Reliable");
  await expect
    .poll(async () =>
      overviewAwards.locator("img").evaluateAll(
        (images) =>
          images.length > 0 &&
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              image.naturalHeight > 0
          )
      )
    )
    .toBe(true);
  await expect
    .poll(() => overviewAwards.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length))
    .toBe(6);

  await page.getByRole("button", { name: "Song View" }).click();
  await expect(page.getByRole("button", { name: "Song View" })).toHaveAttribute("aria-pressed", "true");
  await expect(overviewAwards.locator(".hololive-bracket-award-card.song")).toHaveCount(12);
  await expect(overviewAwards).toContainText("Top Song");
  await expect(overviewAwards).not.toContainText("Top Talent");
  await expect(overviewAwards.locator("img").first()).toHaveAttribute("src", /i\.ytimg\.com\/vi\/.*\/maxres1\.jpg/);
  await overviewAwards.locator(".hololive-bracket-award-card.song .hololive-bracket-award-body").first().hover();
  await expect(overviewAwards.locator(".hololive-bracket-award-reveal").first()).toBeVisible();
  await expect
    .poll(() => overviewAwards.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length))
    .toBe(4);
  await page.setViewportSize({ width: 1100, height: 860 });
  await expect
    .poll(() => overviewAwards.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length))
    .toBe(4);
  const compactSongCardRatio = await overviewAwards
    .locator(".hololive-bracket-award-card.song .hololive-bracket-award-body")
    .first()
    .evaluate((card) => card.getBoundingClientRect().width / card.getBoundingClientRect().height);
  expect(compactSongCardRatio).toBeGreaterThan(1.7);
  expect(compactSongCardRatio).toBeLessThan(1.85);
  expect(
    await page.locator(".hololive-bracket-stats-overview.song").evaluate((overview) => overview.scrollHeight <= overview.clientHeight + 1)
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Talent View" }).click();
  await expect(page.getByRole("button", { name: "Talent View" })).toHaveAttribute("aria-pressed", "true");
  await expect(overviewAwards).toContainText("Top Talent");

  const statsTabs = page.locator(".hololive-bracket-stats-tabs");
  const overviewTabsBounds = await statsTabs.evaluate((tabs) => {
    const bounds = tabs.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height, gap: getComputedStyle(tabs).gap };
  });
  expect(overviewTabsBounds.gap).toBe("0px");
  await page.getByRole("tab", { name: "Detailed Stats" }).click();
  await expect(page.getByRole("tab", { name: "Detailed Stats" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("group", { name: "Stats subject" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Talent View" })).toHaveAttribute("aria-pressed", "true");
  const detailedTabsBounds = await statsTabs.evaluate((tabs) => {
    const bounds = tabs.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height };
  });
  expect(Math.abs(detailedTabsBounds.top - overviewTabsBounds.top)).toBeLessThan(0.5);
  expect(Math.abs(detailedTabsBounds.height - overviewTabsBounds.height)).toBeLessThan(0.5);
  const detailedTable = page.locator(".hololive-bracket-detailed-table");
  await expect(detailedTable).toBeVisible();
  await expect(detailedTable.locator("tbody tr")).not.toHaveCount(0);
  for (const heading of [
    "Talent",
    "Elo Rating",
    "Wins",
    "Titles",
    "2nd Places",
    "Deep Runs",
    "Early Exits",
    "Strength of Wins",
    "Strength of Losses",
    "Most Clutch",
    "Under Pressure",
    "Overperformer",
    "Most Reliable"
  ]) {
    await expect(page.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
  }
  const detailedScroll = page.locator(".hololive-bracket-detailed-table-scroll");
  const detailedSizing = await detailedScroll.evaluate((scroll) => {
    const table = scroll.querySelector<HTMLElement>(".hololive-bracket-detailed-table");
    const header = table?.querySelector<HTMLTableCellElement>("thead th");
    const row = table?.querySelector<HTMLTableRowElement>("tbody tr");
    const cell = row?.querySelector<HTMLTableCellElement>("td");
    return {
      fontSize: table ? getComputedStyle(table).fontSize : "",
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      rowHeight: row?.getBoundingClientRect().height ?? 0,
      cellPaddingLeft: cell ? getComputedStyle(cell).paddingLeft : "",
      hasHorizontalOverflow: scroll.scrollWidth > scroll.clientWidth + 1
    };
  });
  expect(detailedSizing.fontSize).toBe("12.5px");
  expect(detailedSizing.headerHeight).toBeGreaterThanOrEqual(31);
  expect(detailedSizing.headerHeight).toBeLessThanOrEqual(33);
  expect(detailedSizing.rowHeight).toBeGreaterThanOrEqual(29);
  expect(detailedSizing.rowHeight).toBeLessThanOrEqual(31);
  expect(detailedSizing.cellPaddingLeft).toBe("10px");
  expect(detailedSizing.hasHorizontalOverflow).toBe(true);

  const stickyPositions = await detailedScroll.evaluate((scroll) => {
    scroll.scrollLeft = 360;
    const row = scroll.querySelector<HTMLTableRowElement>("tbody tr");
    const rank = row?.querySelector<HTMLTableCellElement>("td.rank");
    const talent = row?.querySelector<HTMLTableCellElement>("td.talent");
    const scrollRect = scroll.getBoundingClientRect();
    return {
      rankOffset: (rank?.getBoundingClientRect().left ?? 0) - scrollRect.left,
      talentOffset: (talent?.getBoundingClientRect().left ?? 0) - scrollRect.left
    };
  });
  expect(Math.abs(stickyPositions.rankOffset)).toBeLessThanOrEqual(2);
  expect(Math.abs(stickyPositions.talentOffset - 46)).toBeLessThanOrEqual(2);
  await detailedScroll.evaluate((scroll) => {
    scroll.scrollLeft = 0;
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect
    .poll(() => detailedScroll.evaluate((scroll) => scroll.scrollWidth <= scroll.clientWidth + 1))
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  const ratingHeader = page.getByRole("columnheader", { name: "Elo Rating", exact: true });
  await expect(ratingHeader).toHaveAttribute("aria-sort", "descending");
  const readFirstTwoSortValues = async (cellIndex: number) =>
    detailedTable.locator("tbody tr").evaluateAll((rows, index) =>
      rows.slice(0, 2).map((row) => Number(row.querySelectorAll("td")[index]?.getAttribute("data-sort-value"))), cellIndex
    );
  const initialRatings = await readFirstTwoSortValues(2);
  expect(initialRatings[0]).toBeGreaterThanOrEqual(initialRatings[1]);
  const winsHeader = page.getByRole("columnheader", { name: "Wins", exact: true });
  await winsHeader.getByRole("button").click();
  await expect(winsHeader).toHaveAttribute("aria-sort", "descending");
  const descendingWins = await readFirstTwoSortValues(3);
  expect(descendingWins[0]).toBeGreaterThanOrEqual(descendingWins[1]);
  await winsHeader.getByRole("button").click();
  await expect(winsHeader).toHaveAttribute("aria-sort", "ascending");
  const ascendingWins = await readFirstTwoSortValues(3);
  expect(ascendingWins[0]).toBeLessThanOrEqual(ascendingWins[1]);

  const historyShelf = page.locator(".hololive-bracket-history-shelf");
  await expect(historyShelf).toHaveCount(0);
  await detailedTable.locator("tbody td.column-wins").last().click();
  await expect(historyShelf).toBeVisible();
  await expect(historyShelf.getByText("Stat History", { exact: true })).toBeVisible();
  const compactWinRow = historyShelf.locator(".hololive-bracket-history-row-layout").first();
  await expect(compactWinRow.locator(".hololive-bracket-history-contribution")).toHaveCount(0);
  await expect(compactWinRow.locator("strong")).toContainText(/^WIN vs /);
  await expect(compactWinRow.locator("small")).toHaveCount(1);
  await expect(historyShelf.locator(".hololive-bracket-history-result-toggle")).toHaveCount(0);
  await expect(historyShelf.getByText(/Raw log sample|Adjusted sample|Volatility|Performance edge/)).toHaveCount(0);
  const historyGrouping = historyShelf.getByRole("combobox", { name: "Group stat history" });
  await expect(historyGrouping).toContainText("Bracket");
  expect((await historyGrouping.boundingBox())?.width ?? 0).toBeLessThanOrEqual(96);
  await historyGrouping.click();
  const bracketGroupingOption = historyShelf.getByRole("option", { name: "Bracket", exact: true });
  await expect(bracketGroupingOption).toBeVisible();
  const groupingTypography = await Promise.all([
    historyGrouping.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    }),
    bracketGroupingOption.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    })
  ]);
  expect(groupingTypography[0]).toEqual(groupingTypography[1]);
  await bracketGroupingOption.click();
  const historyGroups = historyShelf.locator(".hololive-bracket-history-group-toggle");
  await expect(historyGroups.first()).toBeVisible();
  await expect(historyGroups.first()).toHaveAttribute("aria-expanded", "true");
  const historyDates = await historyGroups.evaluateAll((toggles) =>
    toggles.map((toggle) => Date.parse(toggle.getAttribute("data-latest-at") ?? ""))
  );
  expect(historyDates).toEqual([...historyDates].sort((left, right) => right - left));
  await historyGroups.first().click();
  await expect(historyGroups.first()).toHaveAttribute("aria-expanded", "false");
  await historyGroups.first().click();
  await expect(historyGroups.first()).toHaveAttribute("aria-expanded", "true");
  await historyGrouping.click();
  await historyShelf.getByRole("option", { name: "Date", exact: true }).click();
  await expect(historyGroups.first()).toHaveAttribute("aria-expanded", "true");
  await historyGrouping.click();
  await historyShelf.getByRole("option", { name: "No grouping", exact: true }).click();
  await expect(historyShelf.locator(".hololive-bracket-history-group-toggle")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 360 });
  const historyList = historyShelf.locator(".hololive-bracket-history-list");
  await expect
    .poll(() => historyList.evaluate((list) => list.scrollHeight > list.clientHeight))
    .toBe(true);
  await historyList.evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect.poll(() => historyList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(historyShelf).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });

  await detailedTable.locator("tbody td.column-rating").last().click();
  await expect(historyShelf).toBeVisible();
  const ratingSummary = historyShelf.locator(".hololive-bracket-history-row-layout").first();
  await expect(ratingSummary.locator("strong")).toContainText(/^(WIN|LOSS) vs .+/);
  await expect(ratingSummary.locator("small")).toContainText(/\d+% expected win \| [\d,]+ -> [\d,]+$/);
  const ratingDeltaBadge = ratingSummary.locator(".hololive-bracket-history-contribution");
  await expect(ratingDeltaBadge).toBeVisible();
  const ratingAlignment = await ratingSummary.evaluate((summary) => {
    const badge = summary.querySelector<HTMLElement>(".hololive-bracket-history-contribution");
    const result = summary.querySelector<HTMLElement>("strong");
    const detail = summary.querySelector<HTMLElement>("small");
    const summaryRect = summary.getBoundingClientRect();
    const badgeRect = badge?.getBoundingClientRect();
    const resultRect = result?.getBoundingClientRect();
    return {
      badgeRight: badgeRect?.right ?? 0,
      resultLeft: resultRect?.left ?? 0,
      badgeCenterY: badgeRect ? badgeRect.top + badgeRect.height / 2 : 0,
      resultCenterY: resultRect ? resultRect.top + resultRect.height / 2 : 0,
      detailLeftOffset: (detail?.getBoundingClientRect().left ?? 0) - summaryRect.left
    };
  });
  expect(ratingAlignment.badgeRight).toBeLessThan(ratingAlignment.resultLeft);
  expect(Math.abs(ratingAlignment.badgeCenterY - ratingAlignment.resultCenterY)).toBeLessThanOrEqual(1);
  expect(Math.abs(ratingAlignment.detailLeftOffset)).toBeLessThanOrEqual(1);
  await expect(historyShelf.locator(".hololive-bracket-history-result-toggle")).toHaveCount(0);
  await expect(historyShelf.getByText(/^RD /)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(historyShelf).toHaveCount(0);

  const derivedHistoryChecks = [
    { column: "strengthWins", context: /opponent views$/, badgeTitle: "Effect on final Strength score" },
    { column: "strengthLosses", context: /opponent views$/, badgeTitle: "Effect on final Strength score" },
    { column: "clutch", context: /\d+\.\d{2}x impact$/ },
    { column: "pressure", context: /\d+% expected win \| .+$/ },
    { column: "overperformer", context: /\d+\.\d{2}x underdog \| \d+% expected win$/ },
    { column: "reliable", context: /\d+\.\d{2}x favorite \| \d+% expected win$/ }
  ];
  for (const check of derivedHistoryChecks) {
    const cells = detailedTable.locator(`tbody td.column-${check.column}`);
    const sortValues = await cells.evaluateAll((items) =>
      items.map((item) => Number(item.getAttribute("data-sort-value") ?? 0))
    );
    const evidenceIndex = sortValues.findIndex((value) => Math.abs(value) > 0.0001);
    expect(evidenceIndex).toBeGreaterThanOrEqual(0);
    await cells.nth(evidenceIndex).click();
    await expect(historyShelf).toBeVisible();
    const evidenceRow = historyShelf.locator(".hololive-bracket-history-row-layout").first();
    const contributionBadge = evidenceRow.locator(".hololive-bracket-history-contribution");
    await expect(contributionBadge).toBeVisible();
    if ("badgeTitle" in check && check.badgeTitle) {
      await expect(contributionBadge).toHaveAttribute("title", check.badgeTitle);
    }
    await expect(evidenceRow.locator("strong")).toContainText(/^(WIN|LOSS) vs /);
    await expect(evidenceRow.locator("small")).toContainText(check.context);
    await expect(historyShelf.getByText(/Raw log|Adjusted log|Volatility|RD |Actual \d+%|confidence/i)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(historyShelf).toHaveCount(0);
  }

  const titleCell = detailedTable.locator("tbody td.column-titles").filter({ hasText: /^[1-9]/ }).first();
  await titleCell.click();
  await expect(historyShelf).toBeVisible();
  const placementGroup = historyShelf.locator(".hololive-bracket-history-group-toggle").first();
  await expect(placementGroup).toHaveAttribute("aria-expanded", "true");
  const placementEntry = historyShelf.locator(".hololive-bracket-history-entry").first();
  await expect(placementEntry).toBeVisible();
  await expect(placementEntry.locator(".hololive-bracket-history-contribution")).toHaveCount(0);
  await expect(historyShelf.locator(".hololive-bracket-history-result-toggle")).toHaveCount(0);
  await expect(historyShelf.locator(".hololive-bracket-history-run, .hololive-bracket-history-inline-run, .hololive-bracket-history-run-entries")).toHaveCount(0);
  const placementBadges = await historyShelf.locator(".hololive-bracket-history-contribution").allTextContents();
  expect(placementBadges.every((badge) => !["W", "L"].includes(badge.trim()))).toBe(true);
  const placementGrouping = historyShelf.getByRole("combobox", { name: "Group stat history" });
  await placementGrouping.click();
  await historyShelf.getByRole("option", { name: "Date", exact: true }).click();
  await expect(historyShelf.locator(".hololive-bracket-history-entry").first()).toBeVisible();
  await expect(historyShelf.locator(".hololive-bracket-history-result-toggle")).toHaveCount(0);
  await placementGrouping.click();
  await historyShelf.getByRole("option", { name: "No grouping", exact: true }).click();
  await expect(historyShelf.locator(".hololive-bracket-history-entry").first()).toBeVisible();
  await expect(historyShelf.locator(".hololive-bracket-history-result-toggle")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(historyShelf).toHaveCount(0);

  await detailedTable.locator("tbody tr").first().click({ position: { x: 2, y: 15 } });
  await expect(historyShelf).toBeVisible();
  await historyShelf.getByRole("button", { name: "Close stat history" }).click();
  await expect(historyShelf).toHaveCount(0);

  await page.getByRole("button", { name: "Song View" }).click();
  await expect(page.getByRole("button", { name: "Song View" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hololive-bracket-detailed-stats")).toHaveAttribute("aria-label", "Detailed song stats");
  await expect(detailedTable).toHaveClass(/song-view/);
  await expect(detailedTable.locator("tbody tr")).not.toHaveCount(0);
  const songHeadings = [
    "Song",
    "Talent",
    "Elo Rating",
    "Wins",
    "Titles",
    "2nd Places",
    "Deep Runs",
    "Early Exits",
    "Strength of Wins",
    "Strength of Losses",
    "Most Clutch",
    "Under Pressure",
    "Overperformer",
    "Most Reliable"
  ];
  for (const heading of songHeadings) {
    const header = page.getByRole("columnheader", { name: heading, exact: true });
    await expect(header).toBeVisible();
    await expect(header.getByRole("button")).toBeEnabled();
  }
  await expect(detailedTable.locator("thead th button")).toHaveCount(songHeadings.length);
  const songRatingHeader = page.getByRole("columnheader", { name: "Elo Rating", exact: true });
  await expect(songRatingHeader).toHaveAttribute("aria-sort", "descending");
  await songRatingHeader.getByRole("button").click();
  await expect(songRatingHeader).toHaveAttribute("aria-sort", "ascending");
  await songRatingHeader.getByRole("button").click();
  await expect(songRatingHeader).toHaveAttribute("aria-sort", "descending");
  const songRatings = await readFirstTwoSortValues(3);
  expect(songRatings[0]).toBeGreaterThanOrEqual(songRatings[1]);
  const firstSongCell = detailedTable.locator("tbody td.song").first();
  await expect(firstSongCell).not.toHaveAttribute("title", "");
  const songStickyPosition = await detailedScroll.evaluate((scroll) => {
    scroll.scrollLeft = 360;
    const row = scroll.querySelector<HTMLTableRowElement>("tbody tr");
    const song = row?.querySelector<HTMLTableCellElement>("td.song");
    const scrollRect = scroll.getBoundingClientRect();
    return (song?.getBoundingClientRect().left ?? 0) - scrollRect.left;
  });
  expect(Math.abs(songStickyPosition - 46)).toBeLessThanOrEqual(2);
  const songWinsHeader = page.getByRole("columnheader", { name: "Wins", exact: true });
  await songWinsHeader.getByRole("button").click();
  await expect(songWinsHeader).toHaveAttribute("aria-sort", "descending");
  const ownerCell = detailedTable.locator("tbody td.column-owner").first();
  const ownerName = (await ownerCell.textContent())?.trim() ?? "";
  await ownerCell.click();
  await expect(historyShelf).toBeVisible();
  await expect(historyShelf.locator(":scope > header strong")).toHaveText(ownerName);
  const statsTopbar = page.locator(".hololive-bracket-stats-topbar");
  const topbarBox = await statsTopbar.boundingBox();
  if (topbarBox) {
    await page.mouse.click(topbarBox.x + topbarBox.width / 2, topbarBox.y + topbarBox.height / 2);
  }
  await expect(historyShelf).toHaveCount(0);

  await page.getByRole("button", { name: "Talent View" }).click();
  await expect(page.getByRole("columnheader", { name: "Wins", exact: true })).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("button", { name: "Song View" }).click();
  await expect(page.getByRole("columnheader", { name: "Wins", exact: true })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Song View" })).toHaveAttribute("aria-pressed", "true");
  await expect(overviewAwards).toContainText("Top Song");

  await expect(page.getByRole("tab", { name: "Songs" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Talents" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Records" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Matchups" })).toHaveCount(0);

  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await expect(page.getByRole("menuitem", { name: "Duplicate bracket" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Duplicate bracket" }).click();
  await expect(page.getByText("Bracket duplicated")).toBeVisible();
  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await expect(page.getByRole("menuitem", { name: "Reset bracket" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete bracket" }).click();
  await page.locator(".hololive-action-toast").filter({ hasText: "Delete Copy of Singer Showdown?" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hololive-bracket-stats-totals")).toHaveCount(0);
});

test("creates, navigates, and completes a double-elimination bracket", async ({ page }) => {
  await page.getByRole("link", { name: "Bracket" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  const popover = page.locator(".hololive-bracket-create-popover");
  await popover.getByRole("radio", { name: "RO16" }).click();
  await popover.getByRole("radio", { name: "Double", exact: true }).click();
  await expect(popover.locator(".hololive-bracket-match-count")).toHaveCount(0);
  await popover.getByRole("radio", { name: "Random Songs" }).click();
  await popover.getByLabel("Name").fill("Double Elimination Probe");
  await popover.getByRole("button", { name: "Create Bracket" }).click();

  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("Winners");
  await expect(page.locator(".hololive-bracket-arena-meta .song-record")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-arena-meta .song-record")).toHaveText(["0-0 W-L", "0-0 W-L"]);

  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.getByRole("tab", { name: "Winners Bracket" })).toHaveAttribute("aria-selected", "true");
  const grandFinalTab = page.getByRole("tab", { name: "Grand Finals" });
  await expect(grandFinalTab).toBeVisible();
  await grandFinalTab.click();
  await expect(grandFinalTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hololive-bracket-grand-final-view")).toContainText("Pending");
  await page.getByRole("tab", { name: "Winners Bracket" }).click();
  const doubleRoundView = page.getByRole("combobox", { name: "View bracket from round" });
  await expect(doubleRoundView).toContainText("Full bracket");
  await doubleRoundView.click();
  await page.getByRole("option", { name: "Semi Final" }).click();
  await expect(doubleRoundView).toContainText("Semi Final");
  await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
  await expect(page.locator(".hololive-bracket-side.left .hololive-bracket-round")).toHaveCount(1);
  await expect(page.locator(".hololive-bracket-side.right .hololive-bracket-round")).toHaveCount(1);
  await page.getByRole("tab", { name: "Losers Bracket" }).click();
  await expect(doubleRoundView).toContainText("Full bracket");
  await doubleRoundView.click();
  await page.getByRole("option", { name: "Losers Round 3" }).click();
  await expect(doubleRoundView).toContainText("Losers Round 3");
  await page.getByRole("tab", { name: "Winners Bracket" }).click();
  await expect(doubleRoundView).toContainText("Semi Final");
  await doubleRoundView.click();
  await page.getByRole("option", { name: "Full bracket" }).click();
  await expect(page.locator(".hololive-bracket-side.left .hololive-bracket-round")).toHaveCount(3);
  await expect(page.locator(".hololive-bracket-side.right .hololive-bracket-round")).toHaveCount(3);
  await expect(page.locator(".hololive-bracket-final-round")).toHaveCount(1);
  const resetZoom = page.getByRole("button", { name: "Reset zoom" });
  await expect(resetZoom).toHaveText("100%");
  await expect(page.locator(".hololive-bracket-tree")).not.toHaveAttribute("data-bracket-fit-width", "true");
  await expect(page.locator(".hololive-bracket-tree")).not.toHaveAttribute("data-bracket-fit-height", "true");
  const baselineScale = await page.locator(".hololive-bracket-zoom-content").evaluate((canvas) =>
    Number.parseFloat((canvas as HTMLElement).style.getPropertyValue("--bracket-zoom"))
  );
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(resetZoom).toHaveText("110%");
  await expect.poll(() => page.locator(".hololive-bracket-zoom-content").evaluate((canvas) =>
    Number.parseFloat((canvas as HTMLElement).style.getPropertyValue("--bracket-zoom"))
  )).toBeGreaterThan(baselineScale);
  await resetZoom.click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(resetZoom).toHaveText("90%");
  await resetZoom.click();
  await expect(resetZoom).toHaveText("100%");
  const bracketViewport = page.locator(".hololive-bracket-tree");
  await bracketViewport.hover();
  const scrollBeforeWheel = await bracketViewport.evaluate((viewport) => ({
    left: viewport.scrollLeft,
    top: viewport.scrollTop
  }));
  await page.mouse.wheel(0, 100);
  await expect(resetZoom).toHaveText("100%");
  await expect.poll(() => bracketViewport.evaluate(
    (viewport, before) => Math.abs(viewport.scrollLeft - before.left) + Math.abs(viewport.scrollTop - before.top),
    scrollBeforeWheel
  )).toBeGreaterThan(0);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await expect(resetZoom).toHaveText("90%");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(resetZoom).toHaveText("100%");
  await page.getByRole("button", { name: "Fit width" }).click();
  await expect.poll(async () => Number.parseInt((await resetZoom.innerText()).replace("%", ""), 10)).toBeLessThan(100);
  await expect
    .poll(() => bracketViewport.evaluate((viewport) => viewport.scrollWidth - viewport.clientWidth))
    .toBeLessThanOrEqual(2);
  const fittedZoom = await page.locator(".hololive-bracket-zoom-content").evaluate((canvas) =>
    Number.parseFloat((canvas as HTMLElement).style.getPropertyValue("--bracket-zoom"))
  );
  expect(Math.abs(fittedZoom * 20 - Math.round(fittedZoom * 20))).toBeGreaterThan(0.01);
  const losersTab = page.getByRole("tab", { name: "Losers Bracket" });
  await losersTab.hover();
  await expect(losersTab).toHaveCSS("color", "rgb(255, 255, 255)");
  await losersTab.click();
  await expect(page.getByRole("tab", { name: "Losers Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hololive-double-bracket-canvas.stage-losers")).toBeVisible();
  await expect(resetZoom).toHaveText("100%");
  await expect(page.locator(".hololive-double-bracket-canvas.stage-losers")).not.toHaveAttribute("data-bracket-fit-width", "true");
  await expect(page.locator(".hololive-double-bracket-canvas.stage-losers")).not.toHaveAttribute("data-bracket-fit-height", "true");
  await resetZoom.click();
  const losersCanvas = page.locator(".hololive-double-bracket-content");
  const readLosersGeometry = () =>
    losersCanvas.evaluate((canvas) => {
      const zoom = Number.parseFloat((canvas as HTMLElement).style.getPropertyValue("--bracket-zoom")) || 1;
      const canvasRect = canvas.getBoundingClientRect();
      return {
        rounds: Array.from(canvas.querySelectorAll<HTMLElement>(".hololive-double-bracket-round")).map((round) => {
          const rect = round.getBoundingClientRect();
          return {
            x: Math.round(((rect.left - canvasRect.left) / zoom) * 10) / 10,
            y: Math.round(((rect.top - canvasRect.top) / zoom) * 10) / 10,
            width: Math.round((rect.width / zoom) * 10) / 10,
            height: Math.round((rect.height / zoom) * 10) / 10
          };
        }),
        paths: Array.from(canvas.querySelectorAll<SVGPathElement>(".hololive-bracket-lines path")).map((path) =>
          path.getAttribute("d")?.replace(/-?\d+(?:\.\d+)?/g, (value) => String(Math.round(Number(value))))
        )
      };
    });
  const baseLosersGeometry = await readLosersGeometry();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(resetZoom).toHaveText("90%");
  await expect.poll(async () => {
    const zoomedRounds = (await readLosersGeometry()).rounds;
    return zoomedRounds.every((round, index) => {
      const baseline = baseLosersGeometry.rounds[index];
      return baseline && ["x", "y", "width", "height"].every(
        (key) => Math.abs(round[key as keyof typeof round] - baseline[key as keyof typeof baseline]) <= 0.2
      );
    });
  }).toBe(true);
  await expect.poll(async () => JSON.stringify((await readLosersGeometry()).paths)).toBe(JSON.stringify(baseLosersGeometry.paths));

  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(resetZoom).toHaveText("90%");

  await page.getByRole("button", { name: "Play" }).click();
  await page.locator(".hololive-bracket-pick-button").first().click();
  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Undo pick" }).click();
  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("1/8");

  await page.locator(".hololive-bracket-pick-button").first().click();
  await page.locator(".hololive-bracket-pick-button").first().click();
  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Reset bracket" }).click();
  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("1/8");

  for (let index = 0; index < 8; index += 1) {
    await page.locator(".hololive-bracket-pick-button").first().click();
  }
  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("Losers");
  await expect(page.locator(".hololive-bracket-arena-meta .song-record")).toHaveText(["0-1 W-L", "0-1 W-L"]);

  for (let index = 8; index < 29; index += 1) {
    await page.locator(".hololive-bracket-pick-button").first().click();
  }
  await expect(page.locator(".hololive-bracket-arena-top span")).toContainText("Grand Final");

  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(grandFinalTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hololive-bracket-grand-final-view .hololive-bracket-entry:not(.empty)")).toHaveCount(2);

  await page.getByRole("button", { name: "Play" }).click();
  await page.locator(".hololive-bracket-toolbar").getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Undo pick" }).click();
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.getByRole("tab", { name: "Losers Bracket" })).toHaveAttribute("aria-selected", "true");
  await grandFinalTab.click();
  await expect(page.locator(".hololive-bracket-grand-final-view")).toContainText("Pending");
  await page.getByRole("tab", { name: "Losers Bracket" }).click();

  await page.getByRole("button", { name: "Play" }).click();
  await page.locator(".hololive-bracket-pick-button").first().click();
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(grandFinalTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hololive-bracket-grand-final-view .hololive-bracket-entry:not(.empty)")).toHaveCount(2);

  await page.getByRole("button", { name: "Play" }).click();
  await page.locator(".hololive-bracket-pick-button").first().click();
  await expect(page.locator(".hololive-bracket-champion")).toContainText("Champion");

  await page.getByRole("button", { name: "Stats" }).click();
  const formatSelect = page.getByRole("combobox", { name: "Bracket format history" });
  await formatSelect.click();
  await page.getByRole("option", { name: "Double", exact: true }).click();
  await expect(formatSelect).toContainText("Double");
  await expect(page.locator(".hololive-bracket-award-grid .hololive-bracket-award-card")).toHaveCount(12);
});

test("defaults every bracket stage and round view to 100 percent without automatic fitting", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("link", { name: "Bracket" }).click();
  await page.getByRole("button", { name: "Create" }).click();
  const popover = page.locator(".hololive-bracket-create-popover");
  await popover.getByRole("radio", { name: "RO32" }).click();
  await popover.getByRole("radio", { name: "Double", exact: true }).click();
  await popover.getByRole("radio", { name: "Random Songs" }).click();
  await popover.getByLabel("Name").fill("Fixed Zoom Policy Probe");
  await popover.getByRole("button", { name: "Create Bracket" }).click();
  await page.getByRole("button", { name: "Bracket" }).click();

  const winnersViewport = page.locator(".hololive-bracket-tree");
  const resetZoom = page.getByRole("button", { name: "Reset zoom" });
  await expect(resetZoom).toHaveText("100%");
  await expect(winnersViewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(winnersViewport).not.toHaveAttribute("data-bracket-fit-width", "true");

  await page.getByRole("tab", { name: "Losers Bracket" }).click();
  const losersViewport = page.locator(".hololive-double-bracket-canvas.stage-losers");
  await expect(resetZoom).toHaveText("100%");
  await expect(losersViewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(losersViewport).not.toHaveAttribute("data-bracket-fit-width", "true");

  await page.getByRole("tab", { name: "Grand Finals" }).click();
  const grandFinalViewport = page.locator(".hololive-bracket-grand-final-view");
  await expect(resetZoom).toHaveText("100%");
  await expect(grandFinalViewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(grandFinalViewport).not.toHaveAttribute("data-bracket-fit-width", "true");

  await page.getByRole("tab", { name: "Winners Bracket" }).click();
  await page.getByRole("button", { name: "Fit height" }).click();
  await expect.poll(async () => Math.abs(await bracketVerticalFitGap(winnersViewport))).toBeLessThanOrEqual(3);
  const rememberedFullViewZoom = (await resetZoom.innerText()).trim();
  const roundView = page.getByRole("combobox", { name: "View bracket from round" });
  await roundView.click();
  await page.getByRole("option", { name: "Quarter Final" }).click();
  await expect(resetZoom).toHaveText("100%");
  await expect(winnersViewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(winnersViewport).not.toHaveAttribute("data-bracket-fit-width", "true");

  await roundView.click();
  await page.getByRole("option", { name: "Full bracket" }).click();
  await expect(resetZoom).toHaveText(rememberedFullViewZoom);
  await expect(winnersViewport).toHaveAttribute("data-bracket-fit-height", "true");
});

test("keeps wheel scrolling and Ctrl-wheel zoom consistent on large bracket formats", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("link", { name: "Bracket" }).click();

  const verifyWheelPolicy = async (viewport: Locator) => {
    const zoomButton = page.getByRole("button", { name: "Reset zoom" });
    await expect(viewport).toBeVisible();

    for (let index = 0; index < 6; index += 1) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    await expect.poll(() => viewport.evaluate((element) =>
      element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
    )).toBe(true);

    const zoomBeforeScroll = (await zoomButton.innerText()).trim();
    await viewport.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
    await viewport.hover();
    await page.mouse.wheel(0, 160);
    await expect(zoomButton).toHaveText(zoomBeforeScroll);
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft + element.scrollTop)).toBeGreaterThan(0);

    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 160);
    await page.keyboard.up("Control");
    await expect(zoomButton).not.toHaveText(zoomBeforeScroll);
  };

  for (const format of ["Single", "Double"] as const) {
    await createBracket(page, "RO128", `RO128 ${format} Wheel Probe`, format);
    await page.getByRole("button", { name: "Bracket" }).click();
    await verifyWheelPolicy(page.locator(".hololive-bracket-tree"));
    if (format === "Double") {
      await page.getByRole("tab", { name: "Losers Bracket" }).click();
      await verifyWheelPolicy(page.locator(".hololive-double-bracket-canvas.stage-losers"));
    }
  }
});

test("filters bracket rounds, preserves text selection, and finds rendered text", async ({ page }) => {
  await page.getByRole("link", { name: "Bracket" }).click();
  await createBracket(page, "RO64", "Round View Search Probe");
  await page.getByRole("button", { name: "Bracket" }).click();

  const viewport = page.locator(".hololive-bracket-tree");
  const resetZoom = page.getByRole("button", { name: "Reset zoom" });
  await expect(resetZoom).toHaveText("100%");
  await expect(viewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(viewport).not.toHaveAttribute("data-bracket-fit-width", "true");
  const initialZoomLabel = (await resetZoom.innerText()).trim();
  const roundView = page.getByRole("combobox", { name: "View bracket from round" });
  await expect(roundView).toContainText("Full bracket");
  await expect(page.locator(".hololive-bracket-side.left .hololive-bracket-round")).toHaveCount(5);
  await expect(page.locator(".hololive-bracket-side.right .hololive-bracket-round")).toHaveCount(5);
  const firstSongTitle = page.locator(".hololive-bracket-entry strong").first();
  const searchableSongTitle = (await firstSongTitle.innerText()).trim();
  expect(searchableSongTitle).not.toBe("");

  await page.keyboard.press("Control+f");
  const findInput = page.getByRole("textbox", { name: "Find text" });
  await expect(findInput).toBeVisible();
  await findInput.fill(searchableSongTitle);
  await expect(page.locator(".app-find-count")).toHaveText("1/1");
  await expect.poll(() => page.evaluate(() => {
    const highlights = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
    return Boolean(highlights?.has("holoshelf-find-match") && highlights.has("holoshelf-find-active"));
  })).toBe(true);

  await roundView.click();
  await page.getByRole("option", { name: "Quarter Final" }).click();
  await expect(roundView).toContainText("Quarter Final");
  await expect(page.locator(".hololive-bracket-side.left .hololive-bracket-round")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-side.right .hololive-bracket-round")).toHaveCount(2);
  await expect(page.locator(".hololive-bracket-final-round")).toHaveCount(1);
  await expect(page.locator(".app-find-count")).toHaveText("0/0");
  await expect(resetZoom).toHaveText("100%");
  await expect(viewport).not.toHaveAttribute("data-bracket-fit-height", "true");
  await expect(viewport).not.toHaveAttribute("data-bracket-fit-width", "true");
  await resetZoom.click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Fit height" }).click();
  await expect(viewport).toHaveCSS("overflow-y", "hidden");
  await expect.poll(async () => Number.parseInt((await resetZoom.innerText()).replace("%", ""), 10)).toBeGreaterThan(100);
  await expect.poll(async () => Math.abs(await bracketVerticalFitGap(viewport))).toBeLessThanOrEqual(3);
  const fitHeightPanPoint = await bracketPanPoint(viewport);
  await page.mouse.move(fitHeightPanPoint.x, fitHeightPanPoint.y);
  await page.mouse.down();
  await page.mouse.move(fitHeightPanPoint.x, fitHeightPanPoint.y - 80, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).toHaveJSProperty("scrollTop", 0);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit width" }).click();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(await bracketHorizontalFitGap(viewport))).toBeLessThanOrEqual(3);
  await expect(viewport).toHaveAttribute("data-bracket-fit-width", "true");
  await expect(viewport).toHaveCSS("overflow-x", "hidden");
  const fitWidthPanPoint = await bracketPanPoint(viewport);
  await page.mouse.move(fitWidthPanPoint.x, fitWidthPanPoint.y);
  await page.mouse.down();
  await page.mouse.move(fitWidthPanPoint.x - 80, fitWidthPanPoint.y, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).toHaveJSProperty("scrollLeft", 0);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(viewport).not.toHaveAttribute("data-bracket-fit-width", "true");
  const rememberedQuarterZoomLabel = (await resetZoom.innerText()).trim();

  await roundView.click();
  await page.getByRole("option", { name: "Full bracket" }).click();
  await expect(page.locator(".app-find-count")).toHaveText("1/1");
  await expect(resetZoom).toHaveText(initialZoomLabel);
  await roundView.click();
  await page.getByRole("option", { name: "Quarter Final" }).click();
  await expect(resetZoom).toHaveText(rememberedQuarterZoomLabel);
  await roundView.click();
  await page.getByRole("option", { name: "Full bracket" }).click();
  await expect(resetZoom).toHaveText(initialZoomLabel);
  await findInput.fill("Original");
  await expect.poll(async () => Number((await page.locator(".app-find-count").innerText()).split("/")[1])).toBeGreaterThan(1);
  const totalOriginalMatches = Number((await page.locator(".app-find-count").innerText()).split("/")[1]);
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.locator(".app-find-count")).toHaveText(`2/${totalOriginalMatches}`);
  await page.getByRole("button", { name: "Previous match" }).click();
  await expect(page.locator(".app-find-count")).toHaveText(`1/${totalOriginalMatches}`);
  await findInput.press("Shift+Enter");
  await expect(page.locator(".app-find-count")).toHaveText(`${totalOriginalMatches}/${totalOriginalMatches}`);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-find-bar")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const highlights = (CSS as unknown as { highlights?: { has(name: string): boolean } }).highlights;
    return Boolean(highlights?.has("holoshelf-find-match") || highlights?.has("holoshelf-find-active"));
  })).toBe(false);

  await resetZoom.click();
  const scrollBeforeWheelZoom = await viewport.evaluate((element) => {
    element.scrollLeft = Math.min(80, Math.max(0, element.scrollWidth - element.clientWidth));
    element.scrollTop = Math.min(80, Math.max(0, element.scrollHeight - element.clientHeight));
    return { left: element.scrollLeft, top: element.scrollTop };
  });
  await viewport.hover();
  await page.mouse.wheel(0, 100);
  await expect(resetZoom).toHaveText("100%");
  await expect.poll(() => viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })))
    .not.toEqual(scrollBeforeWheelZoom);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await expect(resetZoom).toHaveText("90%");
  await resetZoom.click();
  const songTitle = page.getByText(searchableSongTitle, { exact: true });
  await songTitle.scrollIntoViewIfNeeded();
  const titleBox = await songTitle.boundingBox();
  expect(titleBox).not.toBeNull();
  const scrollBeforeSelection = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
  await page.mouse.move((titleBox?.x ?? 0) + 2, (titleBox?.y ?? 0) + (titleBox?.height ?? 0) / 2);
  await page.mouse.down();
  await expect(viewport).toHaveAttribute("data-bracket-selecting-text", "true");
  await page.mouse.move((titleBox?.x ?? 0) + (titleBox?.width ?? 0) + 90, (titleBox?.y ?? 0) + (titleBox?.height ?? 0) + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? "")).toBe(searchableSongTitle);
  await expect(viewport).toHaveJSProperty("scrollLeft", scrollBeforeSelection.left);
  await expect(viewport).toHaveJSProperty("scrollTop", scrollBeforeSelection.top);

  const entry = songTitle.locator("xpath=ancestor::div[contains(@class, 'hololive-bracket-entry')][1]");
  const entryBox = await entry.boundingBox();
  expect(entryBox).not.toBeNull();
  const cellPanPoint = {
    x: (entryBox?.x ?? 0) + (entryBox?.width ?? 0) - 4,
    y: (entryBox?.y ?? 0) + (entryBox?.height ?? 0) / 2
  };
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return Boolean(target?.closest("[data-bracket-selectable-text]"));
  }, cellPanPoint)).toBe(false);
  await page.mouse.click(cellPanPoint.x, cellPanPoint.y);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  const scrollBeforeCellPan = await viewport.evaluate((element) => element.scrollLeft);
  await page.mouse.move(cellPanPoint.x, cellPanPoint.y);
  await page.mouse.down();
  await page.mouse.move(cellPanPoint.x - 120, cellPanPoint.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(scrollBeforeCellPan);
});

test("sizes bracket connector overlay to the active bracket", async ({ page }) => {
  await page.getByRole("link", { name: "Bracket" }).click();

  await createBracket(page, "RO64", "Large Scroll Probe");
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.locator(".hololive-bracket-tree")).toBeVisible();
  await expect(page.locator(".hololive-bracket-lines")).toBeVisible();

  await createBracket(page, "RO16", "Small Scroll Probe");
  await page.getByRole("button", { name: "Bracket" }).click();
  await expect(page.locator(".hololive-bracket-tree")).toBeVisible();

  const readMetrics = () =>
    page.evaluate(() => {
      const tree = document.querySelector<HTMLElement>(".hololive-bracket-tree");
      const canvas = document.querySelector<HTMLElement>(".hololive-bracket-canvas");
      const svg = document.querySelector<SVGSVGElement>(".hololive-bracket-lines");
      if (!tree || !canvas || !svg) {
        return null;
      }
      const style = window.getComputedStyle(tree);
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      return {
        canvasWidth: Math.ceil(canvas.getBoundingClientRect().width),
        svgWidth: Math.ceil(svg.getBoundingClientRect().width),
        treeScrollWidth: tree.scrollWidth,
        treeExpectedWidth: Math.ceil(canvas.getBoundingClientRect().width + horizontalPadding)
      };
    });

  await expect
    .poll(readMetrics)
    .toMatchObject({
      svgWidth: expect.any(Number),
      canvasWidth: expect.any(Number),
      treeScrollWidth: expect.any(Number),
      treeExpectedWidth: expect.any(Number)
    });

  const metrics = await readMetrics();
  expect(metrics).not.toBeNull();
  expect(metrics!.svgWidth).toBeLessThanOrEqual(metrics!.canvasWidth + 2);
  expect(metrics!.treeScrollWidth).toBeLessThanOrEqual(metrics!.treeExpectedWidth + 2);
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

test("@smoke uses the Hololive player route with playlists and queue actions", async ({ page }) => {
  const switchBoxBefore = await page.locator(".hololive-view-switch").boundingBox();
  await page.getByRole("link", { name: "Player" }).click();

  await expect(page).toHaveURL(/\/module\/hololive\/player/);
  await expect(page.locator(".hololive-player-layout")).toBeVisible();
  await expect(page.locator(".hololive-player-page.hololive-player-layout")).toHaveCount(1);
  await expect(page.locator(".hololive-player-page > .hololive-player-layout")).toHaveCount(0);
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

  await page.getByRole("combobox", { name: "Sort songs" }).click();
  await page.getByRole("listbox", { name: "Sort songs" }).getByRole("option", { name: "Most views" }).click();
  await expect(page.getByRole("combobox", { name: "Sort songs" })).toContainText("Most views");
  await page.getByRole("combobox", { name: "Sort songs" }).click();
  await page.getByRole("listbox", { name: "Sort songs" }).getByRole("option", { name: "Newest" }).click();
  await expect(page.getByRole("combobox", { name: "Sort songs" })).toContainText("Newest");

  const talentFilter = page.getByRole("combobox", { name: "Talent" });
  await talentFilter.click();
  await talentFilter.fill("sora");
  await page.getByRole("listbox", { name: "Talent" }).getByRole("option", { name: "Tokino Sora" }).click();
  await expect(talentFilter).toHaveValue("Tokino Sora");
  await talentFilter.click();
  await talentFilter.fill("all");
  await page.getByRole("listbox", { name: "Talent" }).getByRole("option", { name: "All talents" }).click();
  await expect(talentFilter).toHaveValue("All talents");

  await page.getByRole("combobox", { name: "Collaboration scope" }).click();
  await page.getByRole("listbox", { name: "Collaboration scope" }).getByRole("option", { name: "Solo" }).click();
  await expect(page.getByRole("combobox", { name: "Collaboration scope" })).toContainText("Solo");
  await page.getByRole("combobox", { name: "Collaboration scope" }).click();
  await page.getByRole("listbox", { name: "Collaboration scope" }).getByRole("option", { name: "All songs" }).click();

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
  expect(Math.abs(queueBox!.y - libraryBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(queueBox!.height - libraryBox!.height)).toBeLessThanOrEqual(2);
  expect(playlistsBox!.y).toBeGreaterThan(playerBox!.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const playerPage = document.querySelector(".hololive-player-page");
        return playerPage ? playerPage.scrollHeight - playerPage.clientHeight : 0;
      })
    )
    .toBeLessThanOrEqual(1);

  await page.getByTitle("Create playlist").click();
  await page.getByLabel("New playlist name").fill("Roadtrip");
  await page.getByTitle("Create new playlist").click();
  await expect(page.locator(".hololive-playlist-stack")).toContainText("Roadtrip");

  await page.getByRole("button", { name: "Queue visible" }).click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(5);
  await page.locator(".hololive-queue-panel").getByTitle("Clear queue").click();
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(0);

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
  await expect(page.locator(".hololive-action-toast")).toContainText("Removed from Roadtrip");
  await firstSong.getByRole("button", { name: /Add Tokino Sora Original Song to playlist/ }).click();
  await firstSong.getByRole("menuitemcheckbox", { name: /Roadtrip/ }).click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(1);
  await roadtripPlaylist.locator(".hololive-playlist-toggle").click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(0);
  await roadtripPlaylist.locator(".hololive-playlist-toggle").click();
  await expect(roadtripPlaylist.locator(".hololive-player-song-list li")).toHaveCount(1);
  await roadtripPlaylist.locator(".hololive-player-song-main").click();
  await expect(page.locator(".hololive-action-toast")).toContainText("Loaded in player");
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
  await expect(page.locator(".hololive-action-toast")).toContainText("Loaded in player");

  await secondSong.getByTitle("Play now").click();
  await expect(page.locator(".hololive-action-toast")).toContainText("Playing now");
  await expect(page.locator(".hololive-now-playing")).toContainText("Tokino Sora Cover Song");
  await expect(page.locator(".hololive-queue-panel .hololive-player-song-list li")).toHaveCount(2);
  await expect(secondSong).toHaveClass(/playing/);

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("link", { name: "Tier List" }).click();
    await expect(page.locator(".hololive-tier-board")).toBeVisible();
    await page.getByRole("link", { name: "Player" }).click();
    await expect(page.locator(".hololive-player-layout")).toBeVisible();
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
  await page.getByRole("link", { name: "Tier List" }).click();

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
  await page.locator(".hololive-profile-content").click({ position: { x: 8, y: 8 } });
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

  await page.getByRole("link", { name: "Tier List" }).click();
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
  await expect(page.getByRole("link", { name: "Tier List" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Player" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bracket" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Custom Import" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".hololive-view-switch a")).toHaveText([
    "Tier List",
    "Player",
    "Bracket",
    "Custom Import",
    "Settings"
  ]);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/module\/hololive\/settings$/);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveClass(/active/);
  await expect(page.locator(".hololive-settings-page.hololive-settings-layout")).toHaveCount(1);
  await expect(page.locator(".hololive-settings-page > .hololive-settings-layout")).toHaveCount(0);
  await expect(page.locator(".hololive-settings-panel")).toHaveCount(5);
  await page.getByRole("button", { name: /API Keys/ }).click();
  await expect(page.getByRole("button", { name: /^Save$/ })).toBeVisible();
  await page.getByRole("button", { name: /Data Safety/ }).click();
  await expect(page.getByRole("button", { name: "Open data folder" })).toBeVisible();
  await page.getByRole("button", { name: "Export backup" }).click();
  const backupToast = page.locator(".hololive-action-toast");
  await expect(backupToast).toContainText("Backup exported");
  await expect(backupToast).toContainText("Holoshelf Backup mock.holoshelf-backup");
  await expect(backupToast).toHaveCSS("position", "fixed");
  await expect(backupToast).toHaveCSS("top", "42px");
  await expect(backupToast.locator(".hololive-toast-progress")).toBeVisible();
  await backupToast.click();
  await expect(backupToast).toHaveCount(0);

  await page.getByRole("button", { name: "Import backup" }).click();
  const importConfirmToast = page.locator(".hololive-action-toast");
  await expect(importConfirmToast).toContainText("Import backup?");
  await importConfirmToast.getByRole("button", { name: "Import" }).click();
  const importToast = page.locator(".hololive-action-toast");
  await expect(importToast).toContainText("Backup imported");
  await expect(importToast).toContainText("Restarting Holoshelf.");
  await importToast.click();
  await expect(importToast).toHaveCount(0);

  await page.getByRole("button", { name: "Reset local data" }).click();
  const resetWarningToast = page.locator(".hololive-action-toast");
  await expect(resetWarningToast).toContainText("Reset local data?");
  await expect(resetWarningToast).toContainText("custom talents");
  await resetWarningToast.getByRole("button", { name: "Continue" }).click();
  const resetExportToast = page.locator(".hololive-action-toast");
  await expect(resetExportToast).toContainText("Export a backup first?");
  await expect(resetExportToast.getByRole("button", { name: "Export backup" })).toBeVisible();
  await resetExportToast.getByRole("button", { name: "Skip" }).click();
  const resetFinalToast = page.locator(".hololive-action-toast");
  await expect(resetFinalToast).toContainText("Are you sure?");
  await expect(resetFinalToast).toContainText("reset to bundled defaults");
  await expect(resetFinalToast.getByRole("button", { name: "Erase data" })).toBeVisible();
  await resetFinalToast.click();
  await expect(resetFinalToast).toHaveCount(0);
});

test("keeps the Hololive tabs sticky while the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.reload();
  await page.locator(".hololive-tier-row").first().waitFor();

  const result = await page.evaluate(() => {
    const tierPage = document.querySelector(".hololive-tier-layout") as HTMLElement;
    const root = document.querySelector("#root") as HTMLElement;
    const switcher = document.querySelector(".hololive-view-switch") as HTMLElement;
    const beforeTop = switcher.getBoundingClientRect().top;
    tierPage.scrollTop = 420;
    const afterTop = switcher.getBoundingClientRect().top;

    return {
      rootWidth: root.getBoundingClientRect().width,
      afterTop,
      beforeTop,
      scrollTop: tierPage.scrollTop,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      pageOverflowY: getComputedStyle(tierPage).overflowY,
      globalWorkspaceCount: document.querySelectorAll(".workspace").length,
      globalFrameCount: document.querySelectorAll(".app-frame").length,
      legacyPageCount: document.querySelectorAll(".page").length
    };
  });

  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.afterTop).toBeGreaterThanOrEqual(0);
  expect(result.afterTop).toBeLessThanOrEqual(result.beforeTop);
  expect(Math.abs(result.rootWidth - result.viewportWidth)).toBeLessThan(2);
  expect(result.pageOverflowY).toBe("auto");
  expect(result.globalWorkspaceCount).toBe(0);
  expect(result.globalFrameCount).toBe(0);
  expect(result.legacyPageCount).toBe(0);
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

test("@smoke drags idols into a tier and clears the board", async ({ page }) => {
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

  await expect(page.locator(".hololive-page.hololive-tier-layout")).toBeVisible();
  await expect(page.locator(".hololive-page > .hololive-tier-layout")).toHaveCount(0);
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
