import type { HololiveBracket, HololiveBracketEntry, HololiveBracketMatch, HololiveBracketRound } from "../../shared/contracts";
import { displayHololiveBracketRoundLabel } from "../../shared/hololiveBracketLabels";

type MatchRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerY: number;
};

type ChampionStory = {
  championMatchIds: Set<string>;
};

type RoundHeader = {
  label: string;
  x: number;
  width: number;
  state: "current" | "complete" | "upcoming";
};

const EXPORT_MAX_CANVAS_DIMENSION = 8192;
const EXPORT_PIXEL_SCALE = 1.25;
const EXPORT_BASE_LAYOUT = {
  thumbnailAspectRatio: 16 / 9
} as const;

type ExportLayoutTier = {
  maxBaseMatches: number;
  columnWidth: number;
  finalWidth: number;
  columnGap: number;
  padding: number;
  matchPaddingX: number;
  matchPaddingY: number;
  entryHeight: number;
  entryGap: number;
  entryHighlightInsetY: number;
  thumbnailHeight: number;
  thumbnailGap: number;
  roundHeaderHeight: number;
  headerTop: number;
  rowHeight: number;
  titleFontSize: number;
  metaFontSize: number;
  pendingFontSize: number;
  matchLabelFontSize: number;
  roundHeaderFontSize: number;
  minHeight: number;
  championPlaqueWidth: number;
  championPlaqueHeight: number;
  championBadgeWidth: number;
  championBadgeHeight: number;
  championTitleMaxFontSize: number;
  championTitleMinFontSize: number;
  championDetailMaxFontSize: number;
  championDetailMinFontSize: number;
  championImageWidth: number;
  championImageAnchor: number;
};

const EXPORT_LAYOUT_TIERS: readonly ExportLayoutTier[] = [
  {
    maxBaseMatches: 4,
    columnWidth: 172,
    finalWidth: 232,
    columnGap: 14,
    padding: 14,
    matchPaddingX: 4,
    matchPaddingY: 4,
    entryHeight: 29,
    entryGap: 4,
    entryHighlightInsetY: 5,
    thumbnailHeight: 21,
    thumbnailGap: 7,
    roundHeaderHeight: 22,
    headerTop: 14,
    rowHeight: 96,
    titleFontSize: 9.8,
    metaFontSize: 7.8,
    pendingFontSize: 10,
    matchLabelFontSize: 8.8,
    roundHeaderFontSize: 11,
    minHeight: 540,
    championPlaqueWidth: 430,
    championPlaqueHeight: 106,
    championBadgeWidth: 138,
    championBadgeHeight: 28,
    championTitleMaxFontSize: 30,
    championTitleMinFontSize: 18,
    championDetailMaxFontSize: 15,
    championDetailMinFontSize: 11,
    championImageWidth: 320,
    championImageAnchor: 0.74
  },
  {
    maxBaseMatches: 8,
    columnWidth: 178,
    finalWidth: 238,
    columnGap: 15,
    padding: 16,
    matchPaddingX: 4,
    matchPaddingY: 4,
    entryHeight: 27,
    entryGap: 4,
    entryHighlightInsetY: 4,
    thumbnailHeight: 20,
    thumbnailGap: 7,
    roundHeaderHeight: 22,
    headerTop: 14,
    rowHeight: 76,
    titleFontSize: 9.6,
    metaFontSize: 7.8,
    pendingFontSize: 10,
    matchLabelFontSize: 8.8,
    roundHeaderFontSize: 11,
    minHeight: 640,
    championPlaqueWidth: 480,
    championPlaqueHeight: 110,
    championBadgeWidth: 142,
    championBadgeHeight: 28,
    championTitleMaxFontSize: 31,
    championTitleMinFontSize: 19,
    championDetailMaxFontSize: 15,
    championDetailMinFontSize: 11,
    championImageWidth: 326,
    championImageAnchor: 0.62
  },
  {
    maxBaseMatches: 16,
    columnWidth: 166,
    finalWidth: 226,
    columnGap: 14,
    padding: 16,
    matchPaddingX: 4,
    matchPaddingY: 3,
    entryHeight: 24,
    entryGap: 3,
    entryHighlightInsetY: 4,
    thumbnailHeight: 18,
    thumbnailGap: 6,
    roundHeaderHeight: 21,
    headerTop: 14,
    rowHeight: 62,
    titleFontSize: 8.8,
    metaFontSize: 7,
    pendingFontSize: 9,
    matchLabelFontSize: 8,
    roundHeaderFontSize: 10.5,
    minHeight: 900,
    championPlaqueWidth: 400,
    championPlaqueHeight: 90,
    championBadgeWidth: 124,
    championBadgeHeight: 24,
    championTitleMaxFontSize: 24,
    championTitleMinFontSize: 16,
    championDetailMaxFontSize: 13,
    championDetailMinFontSize: 10,
    championImageWidth: 250,
    championImageAnchor: 0.39
  },
  {
    maxBaseMatches: 32,
    columnWidth: 150,
    finalWidth: 208,
    columnGap: 12,
    padding: 14,
    matchPaddingX: 3,
    matchPaddingY: 2,
    entryHeight: 20,
    entryGap: 3,
    entryHighlightInsetY: 3,
    thumbnailHeight: 15,
    thumbnailGap: 5,
    roundHeaderHeight: 20,
    headerTop: 12,
    rowHeight: 50,
    titleFontSize: 7.8,
    metaFontSize: 6.2,
    pendingFontSize: 8,
    matchLabelFontSize: 7.2,
    roundHeaderFontSize: 9.6,
    minHeight: 1500,
    championPlaqueWidth: 340,
    championPlaqueHeight: 74,
    championBadgeWidth: 104,
    championBadgeHeight: 20,
    championTitleMaxFontSize: 19,
    championTitleMinFontSize: 13,
    championDetailMaxFontSize: 11,
    championDetailMinFontSize: 9,
    championImageWidth: 190,
    championImageAnchor: 0.12
  },
  {
    maxBaseMatches: 64,
    columnWidth: 136,
    finalWidth: 190,
    columnGap: 10,
    padding: 12,
    matchPaddingX: 3,
    matchPaddingY: 2,
    entryHeight: 16,
    entryGap: 2,
    entryHighlightInsetY: 3,
    thumbnailHeight: 12,
    thumbnailGap: 4,
    roundHeaderHeight: 18,
    headerTop: 10,
    rowHeight: 40,
    titleFontSize: 6.9,
    metaFontSize: 5.6,
    pendingFontSize: 7,
    matchLabelFontSize: 6.5,
    roundHeaderFontSize: 8.8,
    minHeight: 2500,
    championPlaqueWidth: 300,
    championPlaqueHeight: 64,
    championBadgeWidth: 92,
    championBadgeHeight: 18,
    championTitleMaxFontSize: 16,
    championTitleMinFontSize: 11,
    championDetailMaxFontSize: 9.5,
    championDetailMinFontSize: 8,
    championImageWidth: 150,
    championImageAnchor: 0.1
  }
] as const;

export type HololiveBracketExportLayout = ExportLayoutTier & {
  sideRoundCount: number;
  baseMatches: number;
  matchHeight: number;
  bracketTop: number;
  matchAreaHeight: number;
  width: number;
  height: number;
  championPlaqueTop: number;
  championImageTop: number;
  championImageHeight: number;
};

function selectExportLayoutTier(baseMatches: number): ExportLayoutTier {
  return EXPORT_LAYOUT_TIERS.find((tier) => baseMatches <= tier.maxBaseMatches) ?? EXPORT_LAYOUT_TIERS[EXPORT_LAYOUT_TIERS.length - 1];
}

export function calculateHololiveBracketExportLayout(sideRoundCount: number, baseMatches: number): HololiveBracketExportLayout {
  const safeSideRoundCount = Math.max(1, Math.round(sideRoundCount));
  const safeBaseMatches = Math.max(1, Math.round(baseMatches));
  const tier = selectExportLayoutTier(safeBaseMatches);
  const matchHeight = tier.entryHeight * 2 + tier.entryGap + tier.matchPaddingY * 2;
  const rowHeight = Math.max(tier.rowHeight, matchHeight + 2);
  const bracketTop = tier.headerTop + tier.roundHeaderHeight + 8;
  const matchAreaHeight = safeBaseMatches * rowHeight;
  const width =
    tier.padding * 2 +
    safeSideRoundCount * tier.columnWidth +
    safeSideRoundCount * tier.columnGap +
    tier.finalWidth +
    safeSideRoundCount * tier.columnGap +
    safeSideRoundCount * tier.columnWidth;
  const championPlaqueTop = Math.max(tier.headerTop + tier.roundHeaderHeight + 26, bracketTop + Math.min(matchAreaHeight * 0.07, 58));
  const championImageHeight = Math.round((tier.championImageWidth * 9) / 16);
  const anchoredImageTop = bracketTop + matchAreaHeight * tier.championImageAnchor;
  const championImageTop = Math.max(championPlaqueTop + tier.championPlaqueHeight + 14, anchoredImageTop);
  const height = Math.max(
    tier.minHeight,
    bracketTop + matchAreaHeight + tier.padding,
    championImageTop + championImageHeight + tier.padding
  );

  return {
    ...tier,
    sideRoundCount: safeSideRoundCount,
    baseMatches: safeBaseMatches,
    matchHeight,
    rowHeight,
    bracketTop,
    matchAreaHeight,
    width,
    height,
    championPlaqueTop,
    championImageTop,
    championImageHeight
  };
}

function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function displayExportSongTitle(title: string): string {
  const original = title.trim();
  let next = original;
  const slashParts = next
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (slashParts.length >= 2) {
    const asciiPart = slashParts.find((part) => /[A-Za-z]/.test(part));
    next = asciiPart ?? slashParts[0] ?? next;
  }

  next = next
    .replace(/^\u3010[^\u3011]*(?:mv|music video|original song|cover)[^\u3011]*\u3011\s*/iu, "")
    .replace(/\s*\u3010[^\u3011]*(?:mv|music video|original song|cover|hololive)[^\u3011]*\u3011\s*$/iu, "")
    .replace(/^【[^】]*(?:mv|music video|original song|cover)[^】]*】\s*/iu, "")
    .replace(/\s*【[^】]*(?:mv|music video|original song|cover|hololive)[^】]*】\s*$/iu, "")
    .replace(/\s*\[[^\]]*(?:mv|music video|original song|cover|hololive)[^\]]*\]\s*$/iu, "")
    .replace(/\s*\((?:official\s*)?(?:music\s*)?(?:video|mv)\)\s*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();

  return next || original;
}

function topicLabel(entry: Pick<HololiveBracketEntry, "topicId"> | null | undefined): string {
  return entry?.topicId === "Music_Cover" ? "Cover" : "Original";
}

function matchLabel(match: HololiveBracketMatch): string {
  return `R${match.roundIndex + 1}-${match.matchIndex + 1}`;
}

function roundState(round: HololiveBracketRound, bracket: HololiveBracket): "current" | "complete" | "upcoming" {
  const matches = round.matches;
  if (matches.some((match) => match.id === bracket.currentMatchId)) {
    return "current";
  }
  if (matches.length > 0 && matches.every((match) => match.winnerEntryId)) {
    return "complete";
  }
  return "upcoming";
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next.trimEnd()}...`;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontWeight: number,
  maxSize: number,
  minSize: number
): number {
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `${fontWeight} ${size}px Segoe UI, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
  }
  ctx.font = `${fontWeight} ${minSize}px Segoe UI, Arial, sans-serif`;
  return minSize;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const nextRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + nextRadius, y);
  ctx.lineTo(x + width - nextRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  ctx.lineTo(x + width, y + height - nextRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  ctx.lineTo(x + nextRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  ctx.lineTo(x, y + nextRadius);
  ctx.quadraticCurveTo(x, y, x + nextRadius, y);
  ctx.closePath();
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
  const sourceRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

async function loadImage(url: string, timeoutMs = 3500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(image);
      }
    };
    image.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    };
    image.src = url;
  });
}

async function loadThumbnails(bracket: HololiveBracket): Promise<Map<string, HTMLImageElement | null>> {
  const videoIds = [...new Set(bracket.entries.map((entry) => entry.youtubeVideoId))];
  const result = new Map<string, HTMLImageElement | null>();
  const concurrency = 8;
  let index = 0;

  async function worker() {
    while (index < videoIds.length) {
      const videoId = videoIds[index];
      index += 1;
      result.set(videoId, await loadImage(youtubeThumbnailUrl(videoId)));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, videoIds.length) }, () => worker()));
  return result;
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#06141f");
  background.addColorStop(0.48, "#082438");
  background.addColorStop(1, "#041017");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const spotlight = ctx.createRadialGradient(width / 2, height * 0.24, 80, width / 2, height * 0.24, width * 0.38);
  spotlight.addColorStop(0, "rgba(69, 213, 255, 0.16)");
  spotlight.addColorStop(0.46, "rgba(125, 231, 191, 0.06)");
  spotlight.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spotlight;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width / 2, height * 0.52, width * 0.34, width / 2, height * 0.52, width * 0.82);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawEntry(
  ctx: CanvasRenderingContext2D,
  entry: HololiveBracketEntry | null | undefined,
  highlight: "champion-path" | "winner" | "none",
  x: number,
  y: number,
  width: number,
  image: HTMLImageElement | null | undefined,
  layout: HololiveBracketExportLayout
): void {
  const height = layout.entryHeight;
  roundRect(ctx, x, y, width, height, 5);
  if (!entry) {
    ctx.fillStyle = "rgba(2, 11, 17, 0.48)";
  } else if (highlight === "champion-path") {
    const fill = ctx.createLinearGradient(x, y, x + width, y + height);
    fill.addColorStop(0, "rgba(181, 242, 126, 0.82)");
    fill.addColorStop(0.1, "rgba(31, 119, 91, 0.9)");
    fill.addColorStop(1, "rgba(23, 90, 72, 0.88)");
    ctx.fillStyle = fill;
  } else if (highlight === "winner") {
    ctx.fillStyle = "rgba(28, 95, 75, 0.56)";
  } else {
    ctx.fillStyle = "rgba(2, 11, 17, 0.82)";
  }
  ctx.fill();
  const highlightInsetY = Math.min(layout.entryHighlightInsetY, Math.max(1, height / 2 - 1));
  if (highlight === "champion-path") {
    ctx.fillStyle = "#ffd426";
    ctx.fillRect(x, y + highlightInsetY, Math.max(2, Math.round(layout.matchPaddingX * 0.75)), height - highlightInsetY * 2);
    ctx.fillStyle = "#7de7bf";
    ctx.fillRect(x + Math.max(3, Math.round(layout.matchPaddingX)), y + highlightInsetY, 2, height - highlightInsetY * 2);
  } else if (highlight === "winner") {
    ctx.fillStyle = "rgba(125, 231, 191, 0.72)";
    ctx.fillRect(x, y + highlightInsetY, Math.max(2, Math.round(layout.matchPaddingX * 0.75)), height - highlightInsetY * 2);
  }

  if (!entry) {
    ctx.fillStyle = "#79b7c8";
    ctx.font = `700 ${layout.pendingFontSize}px Segoe UI, Arial, sans-serif`;
    ctx.fillText("Pending", x + 8, y + height / 2 + layout.pendingFontSize / 3);
    return;
  }

  const thumbnailX = x + Math.max(3, layout.matchPaddingX + 1);
  const thumbnailY = y + Math.round((height - layout.thumbnailHeight) / 2);
  const thumbnailHeight = layout.thumbnailHeight;
  const thumbnailWidth = thumbnailHeight * EXPORT_BASE_LAYOUT.thumbnailAspectRatio;
  roundRect(ctx, thumbnailX, thumbnailY, thumbnailWidth, thumbnailHeight, 3);
  ctx.fillStyle = "rgba(12, 39, 53, 0.82)";
  ctx.fill();
  if (image) {
    ctx.save();
    roundRect(ctx, thumbnailX, thumbnailY, thumbnailWidth, thumbnailHeight, 3);
    ctx.clip();
    drawImageCover(ctx, image, thumbnailX, thumbnailY, thumbnailWidth, thumbnailHeight);
    ctx.restore();
  }

  const textX = thumbnailX + thumbnailWidth + layout.thumbnailGap;
  const textWidth = width - textX + x - 8;
  ctx.fillStyle = highlight === "champion-path" ? "#fff8cc" : "#f0fbff";
  ctx.font = `800 ${layout.titleFontSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(
    truncateText(ctx, displayExportSongTitle(entry.title), textWidth),
    textX,
    y + Math.max(layout.titleFontSize + 1, height * 0.43)
  );
  ctx.fillStyle = highlight === "champion-path" ? "#d1fff1" : "#92d5e6";
  ctx.font = `700 ${layout.metaFontSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(
    truncateText(ctx, `${entry.idolName} / ${topicLabel(entry)}`, textWidth),
    textX,
    y + height - Math.max(2, height * 0.16)
  );
}

function drawMatch(
  ctx: CanvasRenderingContext2D,
  match: HololiveBracketMatch,
  rect: MatchRect,
  images: Map<string, HTMLImageElement | null>,
  story: ChampionStory,
  layout: HololiveBracketExportLayout
): void {
  const championId = match.winnerEntryId && story.championMatchIds.has(match.id) ? match.winnerEntryId : null;
  const isChampionPath = story.championMatchIds.has(match.id);

  ctx.save();
  if (!isChampionPath) {
    ctx.globalAlpha = 0.88;
  }
  roundRect(ctx, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, 7);
  const cardFill = ctx.createLinearGradient(rect.left, rect.top, rect.right, rect.bottom);
  cardFill.addColorStop(0, isChampionPath ? "#082638" : "#061923");
  cardFill.addColorStop(1, "#030d13");
  ctx.fillStyle = cardFill;
  ctx.fill();

  ctx.strokeStyle = isChampionPath ? "rgba(255, 212, 38, 0.58)" : "rgba(64, 171, 210, 0.2)";
  ctx.lineWidth = isChampionPath ? 1.5 : 1;
  roundRect(ctx, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, 7);
  ctx.stroke();

  const entryX = rect.left + layout.matchPaddingX;
  const entryWidth = rect.right - rect.left - layout.matchPaddingX * 2;
  const firstEntryY = rect.top + layout.matchPaddingY;
  const secondEntryY = firstEntryY + layout.entryHeight + layout.entryGap;
  const entryAHighlight =
    championId && championId === match.entryA?.id
      ? "champion-path"
      : match.winnerEntryId === match.entryA?.id
        ? "winner"
        : "none";
  const entryBHighlight =
    championId && championId === match.entryB?.id
      ? "champion-path"
      : match.winnerEntryId === match.entryB?.id
        ? "winner"
        : "none";
  drawEntry(
    ctx,
    match.entryA,
    entryAHighlight,
    entryX,
    firstEntryY,
    entryWidth,
    match.entryA ? images.get(match.entryA.youtubeVideoId) : null,
    layout
  );
  drawEntry(
    ctx,
    match.entryB,
    entryBHighlight,
    entryX,
    secondEntryY,
    entryWidth,
    match.entryB ? images.get(match.entryB.youtubeVideoId) : null,
    layout
  );

  const label = matchLabel(match);
  ctx.textAlign = "left";
  ctx.font = `800 ${layout.matchLabelFontSize}px Segoe UI, Arial, sans-serif`;
  const labelWidth = ctx.measureText(label).width + 10;
  const labelHeight = Math.max(11, layout.matchLabelFontSize + 6);
  const labelY = rect.top - labelHeight + 4;
  roundRect(ctx, rect.left + 7, labelY, labelWidth, labelHeight, labelHeight / 2);
  ctx.fillStyle = "#071923";
  ctx.fill();
  ctx.strokeStyle = "rgba(64, 171, 210, 0.42)";
  ctx.stroke();
  ctx.fillStyle = isChampionPath ? "#ffd426" : "#86dcf4";
  ctx.fillText(label, rect.left + 12, labelY + labelHeight - 4);
  ctx.restore();
}

function drawRoundHeader(ctx: CanvasRenderingContext2D, header: RoundHeader, top: number, layout: HololiveBracketExportLayout): void {
  const accent = header.state === "complete" ? "#7de7bf" : header.state === "current" ? "#ffd426" : "#82dfff";
  const headerY = top + 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.fillRect(header.x + 4, headerY + layout.roundHeaderHeight - 3, header.width - 8, 1);
  ctx.fillStyle = accent;
  ctx.font = `850 ${layout.roundHeaderFontSize}px Segoe UI, Arial, sans-serif`;
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(header.label, header.x + header.width / 2, top + Math.max(12, layout.roundHeaderFontSize + 4));
  ctx.restore();
}

function drawConnector(ctx: CanvasRenderingContext2D, childRects: MatchRect[], parentRect: MatchRect): void {
  if (childRects.length === 0) {
    return;
  }

  const leftToRight = childRects.reduce((sum, rect) => sum + rect.right, 0) / childRects.length < parentRect.left;
  const childEdgeX = childRects.reduce((sum, rect) => sum + (leftToRight ? rect.right : rect.left), 0) / childRects.length;
  const parentEdgeX = leftToRight ? parentRect.left : parentRect.right;
  const midX = (childEdgeX + parentEdgeX) / 2;
  const yValues = [parentRect.centerY, ...childRects.map((rect) => rect.centerY)];

  ctx.strokeStyle = "rgba(78, 184, 219, 0.26)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const childRect of childRects) {
    const startX = leftToRight ? childRect.right : childRect.left;
    ctx.moveTo(startX, childRect.centerY);
    ctx.lineTo(midX, childRect.centerY);
  }
  ctx.moveTo(midX, Math.min(...yValues));
  ctx.lineTo(midX, Math.max(...yValues));
  ctx.moveTo(midX, parentRect.centerY);
  ctx.lineTo(parentEdgeX, parentRect.centerY);
  ctx.stroke();
}

function drawChampionPathConnector(ctx: CanvasRenderingContext2D, childRect: MatchRect, parentRect: MatchRect): void {
  const leftToRight = childRect.right < parentRect.left;
  const childEdgeX = leftToRight ? childRect.right : childRect.left;
  const parentEdgeX = leftToRight ? parentRect.left : parentRect.right;
  const midX = (childEdgeX + parentEdgeX) / 2;

  ctx.save();
  ctx.strokeStyle = "#ffd426";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(childEdgeX, childRect.centerY);
  ctx.lineTo(midX, childRect.centerY);
  ctx.lineTo(midX, parentRect.centerY);
  ctx.lineTo(parentEdgeX, parentRect.centerY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(125, 231, 191, 0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(childEdgeX, childRect.centerY);
  ctx.lineTo(midX, childRect.centerY);
  ctx.lineTo(midX, parentRect.centerY);
  ctx.lineTo(parentEdgeX, parentRect.centerY);
  ctx.stroke();
  ctx.restore();
}

function buildChampionStory(bracket: HololiveBracket): ChampionStory {
  const championId = bracket.champion?.id ?? null;
  return {
    championMatchIds: new Set(
      bracket.rounds
        .flatMap((round) => round.matches)
        .filter((match) => championId && match.winnerEntryId === championId)
        .map((match) => match.id)
    )
  };
}

function drawChampionHero(
  ctx: CanvasRenderingContext2D,
  champion: HololiveBracketEntry,
  image: HTMLImageElement | null | undefined,
  centerX: number,
  layout: HololiveBracketExportLayout
): void {
  const plaqueWidth = layout.championPlaqueWidth;
  const plaqueHeight = layout.championPlaqueHeight;
  const plaqueX = centerX - plaqueWidth / 2;
  const plaqueY = layout.championPlaqueTop;
  const imageWidth = layout.championImageWidth;
  const imageHeight = layout.championImageHeight;
  const imageX = centerX - imageWidth / 2;
  const imageY = layout.championImageTop;
  const title = displayExportSongTitle(champion.title);
  const credit = `${champion.idolName} / ${topicLabel(champion)}`;

  ctx.save();
  ctx.textAlign = "center";

  roundRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, 4);
  ctx.fillStyle = "rgba(3, 12, 18, 0.88)";
  ctx.fill();
  const plaqueStroke = ctx.createLinearGradient(plaqueX, plaqueY, plaqueX + plaqueWidth, plaqueY + plaqueHeight);
  plaqueStroke.addColorStop(0, "#ffd426");
  plaqueStroke.addColorStop(0.48, "#7de7bf");
  plaqueStroke.addColorStop(1, "#46d5ff");
  ctx.strokeStyle = plaqueStroke;
  ctx.lineWidth = 2;
  roundRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, 4);
  ctx.stroke();

  const badgeWidth = layout.championBadgeWidth;
  const badgeHeight = layout.championBadgeHeight;
  roundRect(ctx, centerX - badgeWidth / 2, plaqueY + 18, badgeWidth, badgeHeight, 17);
  const badgeGradient = ctx.createLinearGradient(
    centerX - badgeWidth / 2,
    plaqueY + 18,
    centerX + badgeWidth / 2,
    plaqueY + 18 + badgeHeight
  );
  badgeGradient.addColorStop(0, "#ffd426");
  badgeGradient.addColorStop(1, "#7de7bf");
  ctx.fillStyle = badgeGradient;
  ctx.fill();
  ctx.fillStyle = "#061721";
  const badgeFontSize = Math.max(9, Math.min(15, badgeHeight * 0.54));
  ctx.font = `950 ${badgeFontSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText("CHAMPION", centerX, plaqueY + 18 + badgeHeight / 2 + badgeFontSize * 0.35);

  ctx.fillStyle = "#ffd426";
  const titleSize = fitText(ctx, title, plaqueWidth - 42, 950, layout.championTitleMaxFontSize, layout.championTitleMinFontSize);
  ctx.font = `950 ${titleSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(title, centerX, plaqueY + plaqueHeight * 0.66);
  ctx.fillStyle = "#bdf6ff";
  const detailSize = fitText(
    ctx,
    credit,
    plaqueWidth - 38,
    850,
    layout.championDetailMaxFontSize,
    layout.championDetailMinFontSize
  );
  ctx.font = `850 ${detailSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(credit, centerX, plaqueY + plaqueHeight * 0.86);

  ctx.save();
  roundRect(ctx, imageX, imageY, imageWidth, imageHeight, 8);
  ctx.fillStyle = "#061721";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, imageX, imageY, imageWidth, imageHeight, 8);
  ctx.clip();
  if (image) {
    drawImageCover(ctx, image, imageX, imageY, imageWidth, imageHeight);
  } else {
    const fallback = ctx.createLinearGradient(imageX, imageY, imageX + imageWidth, imageY + imageHeight);
    fallback.addColorStop(0, "#0c3348");
    fallback.addColorStop(1, "#071721");
    ctx.fillStyle = fallback;
    ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
  }
  ctx.restore();

  const outerFrame = ctx.createLinearGradient(imageX, imageY, imageX + imageWidth, imageY + imageHeight);
  outerFrame.addColorStop(0, "#ffd426");
  outerFrame.addColorStop(0.46, "#7de7bf");
  outerFrame.addColorStop(1, "#46d5ff");
  ctx.strokeStyle = outerFrame;
  ctx.lineWidth = 4;
  roundRect(ctx, imageX, imageY, imageWidth, imageHeight, 8);
  ctx.stroke();

  ctx.restore();
}


export async function renderHololiveBracketExportPng(bracket: HololiveBracket): Promise<string> {
  if (!bracket.champion) {
    throw new Error("Only completed brackets can be exported.");
  }

  const nonFinalRounds = bracket.rounds.slice(0, -1);
  const leftRounds = nonFinalRounds.map((round) => ({
    ...round,
    matches: round.matches.slice(0, Math.ceil(round.matches.length / 2))
  }));
  const rightRounds = nonFinalRounds
    .map((round) => ({
      ...round,
      matches: round.matches.slice(Math.ceil(round.matches.length / 2))
    }))
    .reverse();
  const finalRound = bracket.rounds[bracket.rounds.length - 1] ?? null;
  const baseMatches = Math.max(1, leftRounds[0]?.matches.length ?? 1);
  const story = buildChampionStory(bracket);
  const sideRoundCount = leftRounds.length;
  const layout = calculateHololiveBracketExportLayout(sideRoundCount, baseMatches);
  const columnWidth = layout.columnWidth;
  const finalWidth = layout.finalWidth;
  const gap = layout.columnGap;
  const matchHeight = layout.matchHeight;
  const headerHeight = layout.headerTop;
  const padding = layout.padding;
  const width = layout.width;
  const height = layout.height;
  const scale = Math.min(EXPORT_PIXEL_SCALE, EXPORT_MAX_CANVAS_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create bracket export canvas.");
  }

  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";
  drawBackground(ctx, width, height);

  ctx.textAlign = "left";

  const images = await loadThumbnails(bracket);
  const rects = new Map<string, MatchRect>();
  const roundHeaders: RoundHeader[] = [];

  drawChampionHero(
    ctx,
    bracket.champion,
    images.get(bracket.champion.youtubeVideoId),
    width / 2,
    layout
  );

  const drawRound = (round: HololiveBracketRound, x: number, side: "left" | "right" | "final") => {
    const state = roundState(round, bracket);
    const columnSize = side === "final" ? finalWidth : columnWidth;
    roundHeaders.push({
      label: displayHololiveBracketRoundLabel(round.label),
      x,
      width: columnSize,
      state
    });

    const columnTop = layout.bracketTop;
    const usableHeight = layout.matchAreaHeight;
    round.matches.forEach((match, localIndex) => {
      const centerY = columnTop + ((localIndex + 0.5) * usableHeight) / Math.max(round.matches.length, 1);
      const rect = {
        left: x,
        right: x + (side === "final" ? finalWidth : columnWidth),
        top: centerY - matchHeight / 2,
        bottom: centerY + matchHeight / 2,
        centerY
      };
      rects.set(match.id, rect);
    });
  };

  let x = padding;
  for (const round of leftRounds) {
    drawRound(round, x, "left");
    x += columnWidth + gap;
  }
  const finalX = x;
  if (finalRound) {
    drawRound(finalRound, finalX, "final");
  }
  x += finalWidth + gap;
  for (const round of rightRounds) {
    drawRound(round, x, "right");
    x += columnWidth + gap;
  }

  for (let roundIndex = 1; roundIndex < bracket.rounds.length; roundIndex += 1) {
    const previousRound = bracket.rounds[roundIndex - 1];
    const round = bracket.rounds[roundIndex];
    for (const parent of round.matches) {
      const parentRect = rects.get(parent.id);
      const children = [previousRound.matches[parent.matchIndex * 2], previousRound.matches[parent.matchIndex * 2 + 1]]
        .map((match) => (match ? rects.get(match.id) : null))
        .filter((rect): rect is MatchRect => Boolean(rect));
      if (parentRect) {
        drawConnector(ctx, children, parentRect);
      }
    }
  }

  for (let roundIndex = 1; roundIndex < bracket.rounds.length; roundIndex += 1) {
    const previousRound = bracket.rounds[roundIndex - 1];
    const round = bracket.rounds[roundIndex];
    for (const parent of round.matches) {
      if (!story.championMatchIds.has(parent.id)) {
        continue;
      }
      const parentRect = rects.get(parent.id);
      const championChild = previousRound.matches
        .map((match) => (story.championMatchIds.has(match.id) ? rects.get(match.id) : null))
        .find((rect): rect is MatchRect => Boolean(rect));
      if (parentRect && championChild) {
        drawChampionPathConnector(ctx, championChild, parentRect);
      }
    }
  }

  for (const round of [...leftRounds, ...(finalRound ? [finalRound] : []), ...rightRounds]) {
    for (const match of round.matches) {
      const rect = rects.get(match.id);
      if (rect) {
        drawMatch(ctx, match, rect, images, story, layout);
      }
    }
  }

  for (const header of roundHeaders) {
    drawRoundHeader(ctx, header, headerHeight, layout);
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("Could not export bracket image. Some thumbnail images could not be safely rendered.");
  }
}
