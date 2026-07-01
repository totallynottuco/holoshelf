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
const EXPORT_LAYOUT = {
  columnWidth: 190,
  finalWidth: 205,
  columnGap: 16,
  padding: 16,
  matchPaddingX: 4,
  matchPaddingY: 4,
  entryHeight: 27,
  entryGap: 4,
  entryHighlightInsetY: 4,
  thumbnailHeight: 20,
  thumbnailAspectRatio: 16 / 9,
  thumbnailGap: 7,
  roundHeaderHeight: 22,
  headerTop: 14
} as const;

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
  image: HTMLImageElement | null | undefined
): void {
  const height = EXPORT_LAYOUT.entryHeight;
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
  const highlightInsetY = EXPORT_LAYOUT.entryHighlightInsetY;
  if (highlight === "champion-path") {
    ctx.fillStyle = "#ffd426";
    ctx.fillRect(x, y + highlightInsetY, 3, height - highlightInsetY * 2);
    ctx.fillStyle = "#7de7bf";
    ctx.fillRect(x + 4, y + highlightInsetY, 2, height - highlightInsetY * 2);
  } else if (highlight === "winner") {
    ctx.fillStyle = "rgba(125, 231, 191, 0.72)";
    ctx.fillRect(x, y + highlightInsetY, 3, height - highlightInsetY * 2);
  }

  if (!entry) {
    ctx.fillStyle = "#79b7c8";
    ctx.font = "700 10px Segoe UI, Arial, sans-serif";
    ctx.fillText("Pending", x + 8, y + 18);
    return;
  }

  const thumbnailX = x + 5;
  const thumbnailY = y + Math.round((height - EXPORT_LAYOUT.thumbnailHeight) / 2);
  const thumbnailHeight = EXPORT_LAYOUT.thumbnailHeight;
  const thumbnailWidth = thumbnailHeight * EXPORT_LAYOUT.thumbnailAspectRatio;
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

  const textX = thumbnailX + thumbnailWidth + EXPORT_LAYOUT.thumbnailGap;
  const textWidth = width - textX + x - 8;
  ctx.fillStyle = highlight === "champion-path" ? "#fff8cc" : "#f0fbff";
  ctx.font = "800 9.6px Segoe UI, Arial, sans-serif";
  ctx.fillText(truncateText(ctx, displayExportSongTitle(entry.title), textWidth), textX, y + 11);
  ctx.fillStyle = highlight === "champion-path" ? "#d1fff1" : "#92d5e6";
  ctx.font = "700 7.8px Segoe UI, Arial, sans-serif";
  ctx.fillText(truncateText(ctx, `${entry.idolName} / ${topicLabel(entry)}`, textWidth), textX, y + 22);
}

function drawMatch(
  ctx: CanvasRenderingContext2D,
  match: HololiveBracketMatch,
  rect: MatchRect,
  images: Map<string, HTMLImageElement | null>,
  story: ChampionStory
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

  const entryX = rect.left + EXPORT_LAYOUT.matchPaddingX;
  const entryWidth = rect.right - rect.left - EXPORT_LAYOUT.matchPaddingX * 2;
  const firstEntryY = rect.top + EXPORT_LAYOUT.matchPaddingY;
  const secondEntryY = firstEntryY + EXPORT_LAYOUT.entryHeight + EXPORT_LAYOUT.entryGap;
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
    match.entryA ? images.get(match.entryA.youtubeVideoId) : null
  );
  drawEntry(
    ctx,
    match.entryB,
    entryBHighlight,
    entryX,
    secondEntryY,
    entryWidth,
    match.entryB ? images.get(match.entryB.youtubeVideoId) : null
  );

  const label = matchLabel(match);
  ctx.textAlign = "left";
  ctx.font = "800 9px Segoe UI, Arial, sans-serif";
  const labelWidth = ctx.measureText(label).width + 12;
  const labelY = rect.top - 12;
  roundRect(ctx, rect.left + 7, labelY, labelWidth, 16, 8);
  ctx.fillStyle = "#071923";
  ctx.fill();
  ctx.strokeStyle = "rgba(64, 171, 210, 0.42)";
  ctx.stroke();
  ctx.fillStyle = isChampionPath ? "#ffd426" : "#86dcf4";
  ctx.fillText(label, rect.left + 13, rect.top - 1);
  ctx.restore();
}

function drawRoundHeader(ctx: CanvasRenderingContext2D, header: RoundHeader, top: number): void {
  const accent = header.state === "complete" ? "#7de7bf" : header.state === "current" ? "#ffd426" : "#82dfff";
  const headerY = top + 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.fillRect(header.x + 4, headerY + 19, header.width - 8, 1);
  ctx.fillStyle = accent;
  ctx.font = "850 11px Segoe UI, Arial, sans-serif";
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(header.label, header.x + header.width / 2, top + 15);
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
  top: number,
  width: number
): void {
  const plaqueWidth = Math.min(570, width - 70);
  const plaqueHeight = 114;
  const plaqueX = centerX - plaqueWidth / 2;
  const plaqueY = top;
  const imageWidth = Math.min(335, width - 110);
  const imageHeight = Math.round((imageWidth * 9) / 16);
  const imageX = centerX - imageWidth / 2;
  const imageY = top + 290;
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

  const badgeWidth = 142;
  const badgeHeight = 28;
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
  ctx.font = "950 15px Segoe UI, Arial, sans-serif";
  ctx.fillText("CHAMPION", centerX, plaqueY + 37);

  ctx.fillStyle = "#ffd426";
  const titleSize = fitText(ctx, title, plaqueWidth - 42, 950, 32, 20);
  ctx.font = `950 ${titleSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(title, centerX, plaqueY + 76);
  ctx.fillStyle = "#bdf6ff";
  ctx.font = "850 15px Segoe UI, Arial, sans-serif";
  const detailSize = fitText(ctx, credit, plaqueWidth - 38, 850, 15, 12);
  ctx.font = `850 ${detailSize}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(credit, centerX, plaqueY + 98);

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
  const columnWidth = EXPORT_LAYOUT.columnWidth;
  const finalWidth = EXPORT_LAYOUT.finalWidth;
  const gap = EXPORT_LAYOUT.columnGap;
  const matchHeight = EXPORT_LAYOUT.entryHeight * 2 + EXPORT_LAYOUT.entryGap + EXPORT_LAYOUT.matchPaddingY * 2;
  const rowHeight = baseMatches <= 4 ? 90 : baseMatches <= 8 ? 68 : 56;
  const headerHeight = EXPORT_LAYOUT.headerTop;
  const roundHeaderHeight = EXPORT_LAYOUT.roundHeaderHeight;
  const padding = EXPORT_LAYOUT.padding;
  const sideRoundCount = leftRounds.length;
  const width = padding * 2 + sideRoundCount * columnWidth + sideRoundCount * gap + finalWidth + sideRoundCount * gap + sideRoundCount * columnWidth;
  const height = Math.max(620, headerHeight + roundHeaderHeight + baseMatches * rowHeight + padding);
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
    72,
    Math.min(510, Math.max(450, finalWidth + gap * 6))
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

    const columnTop = headerHeight + roundHeaderHeight + 6;
    const usableHeight = baseMatches * rowHeight;
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
        drawMatch(ctx, match, rect, images, story);
      }
    }
  }

  for (const header of roundHeaders) {
    drawRoundHeader(ctx, header, headerHeight);
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("Could not export bracket image. Some thumbnail images could not be safely rendered.");
  }
}
