import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import { useLocation } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownAZ,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Eraser,
  GripVertical,
  ListMusic,
  Plus,
  Play,
  RefreshCcw,
  Ruler,
  Trash2,
  X
} from "lucide-react";
import type {
  HololiveIdol,
  HololiveIdolProfile,
  HololiveMusicMarker,
  HololiveMusicPlayerData,
  HololiveProfileMediaGroupId,
  HololiveProfileMediaGroup,
  HololiveTier,
  HololiveTierBoardSummary,
  HololiveTierListData
} from "../../shared/contracts";
import { api } from "../api";
import { MusicMarkerIcon, musicMarkerLabel } from "../components/HololiveMusicMarker";
import { HololiveMusicMarkerMenu } from "../components/HololiveMusicMarkerMenu";
import {
  formatHololiveDuration as formatDuration,
  formatHololiveSongDate as formatSongDate,
  formatHololiveViewCount as formatViewCount
} from "../components/HololiveMusicText";
import { HololivePlaylistMenu } from "../components/HololivePlaylistMenu";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";
import { useHololiveActionToast } from "../components/HololiveActionToast";
import { useHololivePlayer } from "../player/HololivePlayerContext";

const POOL_CONTAINER_ID = "pool";
const TIER_CONTAINER_PREFIX = "tier:";
const TIER_ROW_DRAG_PREFIX = "tier-row:";
const BOARD_TAB_DRAG_PREFIX = "board-tab:";
const TIER_LABEL_WIDTH_SETTING_KEY = "hololive.tierLabelWidth";
const DEFAULT_TIER_LABEL_WIDTH = 77;
const MIN_TIER_LABEL_WIDTH = 64;
const MAX_TIER_LABEL_WIDTH = 168;
const LOCKED_HOLOLIVE_ICON_SIZE = 64;
const IDOL_DRAG_START_DISTANCE = 6;
const IDOL_SORT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const IDOL_SORT_DURATION_MS = 220;
const EMPTY_IDOLS: HololiveIdol[] = [];
const EXACT_COUNT_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const SUBSCRIBER_COUNT_FORMATTER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2
});
function formatExactCount(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }

  return EXACT_COUNT_FORMATTER.format(Math.round(value));
}

function formatSubscriberCount(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }

  if (Math.abs(value) < 1_000_000) {
    return formatExactCount(value);
  }

  return SUBSCRIBER_COUNT_FORMATTER.format(value);
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type ActiveDrag = {
  type: "tier-row";
  tierId: string;
};

type Point = {
  x: number;
  y: number;
};

type IdolPointerDrag = {
  idolId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  active: boolean;
};

type IdolTileRect = {
  id: string;
  rect: DOMRect;
};

interface IdolMoveTarget {
  idolId: string;
  destinationTierId: string | null;
  index: number;
  signature: string;
}

function clampTierLabelWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), MIN_TIER_LABEL_WIDTH), MAX_TIER_LABEL_WIDTH);
}

function tierContainerId(tierId: string): string {
  return `${TIER_CONTAINER_PREFIX}${tierId}`;
}

function tierRowDragId(tierId: string): string {
  return `${TIER_ROW_DRAG_PREFIX}${tierId}`;
}

function boardTabDragId(boardId: string): string {
  return `${BOARD_TAB_DRAG_PREFIX}${boardId}`;
}

function parseTierRowDragId(id: UniqueIdentifier): string | null {
  const value = String(id);
  return value.startsWith(TIER_ROW_DRAG_PREFIX) ? value.slice(TIER_ROW_DRAG_PREFIX.length) : null;
}

function parseBoardTabDragId(id: UniqueIdentifier): string | null {
  const value = String(id);
  return value.startsWith(BOARD_TAB_DRAG_PREFIX) ? value.slice(BOARD_TAB_DRAG_PREFIX.length) : null;
}

function parseContainerId(containerId: string): string | null {
  return containerId === POOL_CONTAINER_ID ? null : containerId.replace(/^tier:/, "");
}

function sortedPlacementIdsForTier(data: HololiveTierListData, tierId: string | null): string[] {
  return sortedPlacementIdsByTier(data).get(placementGroupKey(tierId)) ?? [];
}

function placementGroupKey(tierId: string | null): string {
  return tierId ?? POOL_CONTAINER_ID;
}

function sortedPlacementIdsByTier(data: HololiveTierListData): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const placements = [...data.activeBoard.placements].sort((left, right) => left.position - right.position);

  for (const placement of placements) {
    const key = placementGroupKey(placement.tierId);
    const group = groups.get(key);

    if (group) {
      group.push(placement.idolId);
    } else {
      groups.set(key, [placement.idolId]);
    }
  }

  return groups;
}

function moveIdolToIndex(
  data: HololiveTierListData,
  idolId: string,
  destinationTierId: string | null,
  index: number
): HololiveTierListData {
  const sourcePlacement = data.activeBoard.placements.find((placement) => placement.idolId === idolId);
  if (!sourcePlacement) {
    return data;
  }

  const sourceTierId = sourcePlacement.tierId;
  const sameGroup = sourceTierId === destinationTierId;
  const placements = data.activeBoard.placements;
  const sourceIds = sortedPlacementIdsForTier(data, sourceTierId).filter((candidateId) => candidateId !== idolId);
  const destinationIds = sameGroup
    ? [...sourceIds]
    : sortedPlacementIdsForTier(data, destinationTierId).filter((candidateId) => candidateId !== idolId);
  const insertionIndex = Math.min(Math.max(Math.round(index), 0), destinationIds.length);

  destinationIds.splice(insertionIndex, 0, idolId);
  const destinationPositions = new Map(destinationIds.map((destinationId, position) => [destinationId, position]));
  const sourcePositions = sameGroup
    ? destinationPositions
    : new Map(sourceIds.map((sourceId, position) => [sourceId, position]));

  const nextPlacements = placements.map((placement) => {
    if (placement.idolId === idolId) {
      return {
        ...placement,
        tierId: destinationTierId,
        position: insertionIndex
      };
    }

    if (placement.tierId === destinationTierId) {
      const nextPosition = destinationPositions.get(placement.idolId) ?? -1;
      return nextPosition >= 0 ? { ...placement, position: nextPosition } : placement;
    }

    if (!sameGroup && placement.tierId === sourceTierId) {
      const nextPosition = sourcePositions.get(placement.idolId) ?? -1;
      return nextPosition >= 0 ? { ...placement, position: nextPosition } : placement;
    }

    return placement;
  });

  const changed = nextPlacements.some(
    (placement, placementIndex) =>
      placement.tierId !== placements[placementIndex].tierId ||
      placement.position !== placements[placementIndex].position
  );

  if (!changed) {
    return data;
  }

  return {
    ...data,
    activeBoard: {
      ...data.activeBoard,
      placements: nextPlacements
    }
  };
}

function reorderTiersInData(data: HololiveTierListData, tierIds: string[]): HololiveTierListData {
  const positions = new Map(tierIds.map((tierId, index) => [tierId, index]));
  return {
    ...data,
    activeBoard: {
      ...data.activeBoard,
      tiers: data.activeBoard.tiers
        .map((tier) => ({
          ...tier,
          position: positions.get(tier.id) ?? tier.position
        }))
        .sort((left, right) => left.position - right.position)
    }
  };
}

function reorderBoardsInData(data: HololiveTierListData, boardIds: string[]): HololiveTierListData {
  const boardById = new Map(data.boards.map((board) => [board.id, board]));
  const orderedBoards = boardIds.map((boardId) => boardById.get(boardId)).filter((board): board is HololiveTierBoardSummary => Boolean(board));
  const missingBoards = data.boards.filter((board) => !boardIds.includes(board.id));

  return {
    ...data,
    boards: [...orderedBoards, ...missingBoards]
  };
}

function idolMoveSignature(idolId: string, destinationTierId: string | null, index: number): string {
  return `${idolId}:${destinationTierId ?? POOL_CONTAINER_ID}:${index}`;
}

function placementLayoutSignature(data: HololiveTierListData): string {
  return data.activeBoard.placements
    .map((placement) => `${placement.idolId}:${placement.tierId ?? POOL_CONTAINER_ID}:${placement.position}`)
    .sort()
    .join("|");
}

function findIdolContainerAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const directTarget = document.elementFromPoint(clientX, clientY);
  const directContainer = directTarget?.closest<HTMLElement>("[data-idol-container-id]");
  if (directContainer) {
    return directContainer;
  }

  const containers = Array.from(document.querySelectorAll<HTMLElement>("[data-idol-container-id]"));
  let nearest: { element: HTMLElement; distance: number } | null = null;

  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    const withinX = clientX >= rect.left - 6 && clientX <= rect.right + 6;
    const withinY = clientY >= rect.top - 6 && clientY <= rect.bottom + 6;

    if (withinX && withinY) {
      return container;
    }

    if (withinX) {
      const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (distance <= 18 && (!nearest || distance < nearest.distance)) {
        nearest = { element: container, distance };
      }
    }
  }

  return nearest?.element ?? null;
}

function getOrderedIdolTiles(container: HTMLElement, activeIdolId: string): IdolTileRect[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".hololive-idol-grid .hololive-idol-tile[data-idol-id]"))
    .filter((element) => element.dataset.idolId && element.dataset.idolId !== activeIdolId)
    .map((element) => ({
      id: element.dataset.idolId ?? "",
      rect: element.getBoundingClientRect()
    }))
    .filter((tile) => tile.id && tile.rect.width > 0 && tile.rect.height > 0)
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
}

function getIdolInsertionIndexFromPoint(
  container: HTMLElement,
  idolId: string,
  clientX: number,
  clientY: number
): number {
  const tiles = getOrderedIdolTiles(container, idolId);
  if (tiles.length === 0) {
    return 0;
  }

  const rows: Array<{ top: number; bottom: number; centerY: number; tiles: IdolTileRect[] }> = [];

  for (const tile of tiles) {
    const centerY = tile.rect.top + tile.rect.height / 2;
    const row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= tile.rect.height * 0.45);

    if (row) {
      row.top = Math.min(row.top, tile.rect.top);
      row.bottom = Math.max(row.bottom, tile.rect.bottom);
      row.centerY = (row.centerY * row.tiles.length + centerY) / (row.tiles.length + 1);
      row.tiles.push(tile);
    } else {
      rows.push({
        top: tile.rect.top,
        bottom: tile.rect.bottom,
        centerY,
        tiles: [tile]
      });
    }
  }

  rows.sort((left, right) => left.top - right.top);

  let targetRow = rows[rows.length - 1];
  for (const row of rows) {
    if (clientY <= row.bottom + 4) {
      targetRow = row;
      break;
    }
  }

  targetRow.tiles.sort((left, right) => left.rect.left - right.rect.left);
  const indexById = new Map(tiles.map((tile, index) => [tile.id, index]));

  for (const tile of targetRow.tiles) {
    if (clientX < tile.rect.left + tile.rect.width / 2) {
      return indexById.get(tile.id) ?? 0;
    }
  }

  const lastTile = targetRow.tiles[targetRow.tiles.length - 1];
  return (indexById.get(lastTile.id) ?? tiles.length - 1) + 1;
}

function getIdolMoveTargetFromPoint(
  idolId: string,
  clientX: number,
  clientY: number
): IdolMoveTarget | null {
  const container = findIdolContainerAtPoint(clientX, clientY);
  const containerId = container?.dataset.idolContainerId;
  if (!container || !containerId) {
    return null;
  }

  const destinationTierId = parseContainerId(containerId);
  const index = getIdolInsertionIndexFromPoint(container, idolId, clientX, clientY);

  return {
    idolId,
    destinationTierId,
    index,
    signature: idolMoveSignature(idolId, destinationTierId, index)
  };
}

function captureIdolRects(): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  const tiles = document.querySelectorAll<HTMLElement>(".hololive-idol-grid .hololive-idol-tile[data-idol-id]");

  for (const tile of tiles) {
    const idolId = tile.dataset.idolId;
    if (idolId) {
      rects.set(idolId, tile.getBoundingClientRect());
    }
  }

  return rects;
}

function findRenderedIdolTile(idolId: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(".hololive-idol-grid .hololive-idol-tile[data-idol-id]")).find(
      (tile) => tile.dataset.idolId === idolId
    ) ?? null
  );
}

function nextBoardName(data: HololiveTierListData): string {
  const usedNames = new Set(data.boards.map((board) => board.name.trim().toLowerCase()));
  let index = 1;

  while (usedNames.has(`tier list ${index}`)) {
    index += 1;
  }

  return `tier list ${index}`;
}

export function HololivePage() {
  const location = useLocation();
  const [data, setData] = useState<HololiveTierListData | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [tierLabelWidth, setTierLabelWidth] = useState(DEFAULT_TIER_LABEL_WIDTH);
  const [busy, setBusy] = useState(false);
  const [iconRefresh, setIconRefresh] = useState<"idle" | "running" | "done">("idle");
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [boardRenameDraft, setBoardRenameDraft] = useState("");
  const [boardRenameWidth, setBoardRenameWidth] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<HololiveTierListData | null>(null);
  const [activeIdolDrag, setActiveIdolDrag] = useState<{ idolId: string } | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileFocus, setProfileFocus] = useState<{
    profileId: string;
    groupId: HololiveProfileMediaGroupId | null;
    songId: string | null;
    requestId: string;
  } | null>(null);
  const [profileCache, setProfileCache] = useState<Record<string, HololiveIdolProfile>>({});
  const [profileLoadingId, setProfileLoadingId] = useState<string | null>(null);
  const {
    currentVideoId: activeMusicVideoId,
    data: playerData,
    playVideoNow,
    applyPlayerData
  } = useHololivePlayer();
  const { showToast, showUndoToast } = useHololiveActionToast();
  const userPlaylists = useMemo(() => (playerData?.playlists ?? []).filter((playlist) => !playlist.systemId), [playerData?.playlists]);
  const autoCacheAttempted = useRef(false);
  const latestDataRef = useRef<HololiveTierListData | null>(null);
  const previewDataRef = useRef<HololiveTierListData | null>(null);
  const idolDragSnapshotRef = useRef<HololiveTierListData | null>(null);
  const idolDragRef = useRef<IdolPointerDrag | null>(null);
  const lastIdolMoveTargetRef = useRef<IdolMoveTarget | null>(null);
  const lastIdolPreviewSignatureRef = useRef<string | null>(null);
  const pendingIdolPointRef = useRef<Point | null>(null);
  const idolPointerFrameRef = useRef<number | null>(null);
  const idolPointerCleanupRef = useRef<(() => void) | null>(null);
  const idolOverlayRef = useRef<HTMLDivElement | null>(null);
  const idolFlipTimersRef = useRef<number[]>([]);
  const idolPlacementMutationSeqRef = useRef(0);
  const tierDataLoadSeqRef = useRef(0);
  const iconRefreshTimerRef = useRef<number | null>(null);
  const tierLabelWidthRef = useRef(DEFAULT_TIER_LABEL_WIDTH);
  const boardRenameInputRef = useRef<HTMLInputElement | null>(null);
  const handledProfileRouteRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4
      }
    })
  );
  const boardSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  function storeTierData(next: HololiveTierListData) {
    previewDataRef.current = null;
    setPreviewData(null);
    setData(next);
    latestDataRef.current = next;
    setActiveBoardId(next.activeBoard.id);
  }

  function commitOptimisticTierData(next: HololiveTierListData) {
    previewDataRef.current = null;
    setPreviewData(null);
    setData(next);
    latestDataRef.current = next;
    setActiveBoardId(next.activeBoard.id);
  }

  function clearIdolAnimationTimers() {
    for (const timer of idolFlipTimersRef.current) {
      window.clearTimeout(timer);
    }

    idolFlipTimersRef.current = [];
  }

  function animateIdolLayoutFrom(previousRects: Map<string, DOMRect>, activeIdolId: string) {
    clearIdolAnimationTimers();

    for (const [idolId, previousRect] of previousRects) {
      if (idolId === activeIdolId) {
        continue;
      }

      const tile = findRenderedIdolTile(idolId);
      if (!tile) {
        continue;
      }

      const nextRect = tile.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        continue;
      }

      tile.style.transition = "none";
      tile.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      tile.style.willChange = "transform";
      tile.getBoundingClientRect();
      tile.style.transition = `transform ${IDOL_SORT_DURATION_MS}ms ${IDOL_SORT_EASING}`;
      tile.style.transform = "";

      const cleanupTimer = window.setTimeout(() => {
        tile.style.transition = "";
        tile.style.transform = "";
        tile.style.willChange = "";
      }, IDOL_SORT_DURATION_MS + 80);
      idolFlipTimersRef.current.push(cleanupTimer);
    }
  }

  function setIdolOverlayPosition(drag: IdolPointerDrag) {
    const overlay = idolOverlayRef.current;
    if (!overlay) {
      return;
    }

    overlay.style.transform = `translate3d(${drag.clientX - drag.offsetX}px, ${drag.clientY - drag.offsetY}px, 0)`;
  }

  function previewIdolMoveAtPoint(point: Point, animate = true): IdolMoveTarget | null {
    const drag = idolDragRef.current;
    const base = previewDataRef.current ?? latestDataRef.current;
    if (!drag || !base) {
      return null;
    }

    drag.clientX = point.x;
    drag.clientY = point.y;
    setIdolOverlayPosition(drag);

    const target = getIdolMoveTargetFromPoint(drag.idolId, point.x, point.y);
    if (!target) {
      return null;
    }

    lastIdolMoveTargetRef.current = target;
    if (lastIdolPreviewSignatureRef.current === target.signature) {
      return target;
    }

    const next = moveIdolToIndex(base, target.idolId, target.destinationTierId, target.index);
    lastIdolPreviewSignatureRef.current = target.signature;
    if (next === base) {
      return target;
    }

    const previousRects = animate ? captureIdolRects() : null;
    previewDataRef.current = next;
    setPreviewData(next);

    if (previousRects) {
      window.requestAnimationFrame(() => animateIdolLayoutFrom(previousRects, drag.idolId));
    }

    return target;
  }

  function cancelPendingIdolPointerFrame() {
    if (idolPointerFrameRef.current !== null) {
      window.cancelAnimationFrame(idolPointerFrameRef.current);
      idolPointerFrameRef.current = null;
    }

    pendingIdolPointRef.current = null;
  }

  function scheduleIdolPointerPreview(point: Point) {
    pendingIdolPointRef.current = point;

    if (idolPointerFrameRef.current !== null) {
      return;
    }

    idolPointerFrameRef.current = window.requestAnimationFrame(() => {
      idolPointerFrameRef.current = null;
      const nextPoint = pendingIdolPointRef.current;
      pendingIdolPointRef.current = null;

      if (nextPoint) {
        previewIdolMoveAtPoint(nextPoint);
      }
    });
  }

  function cleanupIdolPointerListeners() {
    idolPointerCleanupRef.current?.();
    idolPointerCleanupRef.current = null;
  }

  function resetIdolDragState() {
    cancelPendingIdolPointerFrame();
    cleanupIdolPointerListeners();
    document.body.classList.remove("hololive-idol-dragging");
    idolDragRef.current = null;
    idolDragSnapshotRef.current = null;
    lastIdolMoveTargetRef.current = null;
    lastIdolPreviewSignatureRef.current = null;
    setActiveIdolDrag(null);
  }

  function handleWindowIdolPointerMove(event: PointerEvent) {
    const drag = idolDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < IDOL_DRAG_START_DISTANCE) {
        return;
      }

      const current = latestDataRef.current;
      if (!current || !current.activeBoard.placements.some((placement) => placement.idolId === drag.idolId)) {
        resetIdolDragState();
        return;
      }

      drag.active = true;
      previewDataRef.current = current;
      setPreviewData(current);
      idolDragSnapshotRef.current = current;
      lastIdolMoveTargetRef.current = null;
      lastIdolPreviewSignatureRef.current = null;
      document.body.classList.add("hololive-idol-dragging");
      setActiveIdolDrag({ idolId: drag.idolId });
      window.requestAnimationFrame(() => setIdolOverlayPosition(drag));
    }

    event.preventDefault();
    scheduleIdolPointerPreview({ x: event.clientX, y: event.clientY });
  }

  function handleWindowIdolPointerCancel(event: PointerEvent) {
    const drag = idolDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    if (drag.active) {
      previewDataRef.current = null;
      setPreviewData(null);
    }

    resetIdolDragState();
  }

  function handleWindowIdolBlur() {
    const drag = idolDragRef.current;
    if (!drag) {
      return;
    }

    if (drag.active) {
      previewDataRef.current = null;
      setPreviewData(null);
    }

    resetIdolDragState();
  }

  async function persistIdolPlacement(next: HololiveTierListData, idolId: string) {
    const placement = next.activeBoard.placements.find((candidate) => candidate.idolId === idolId);
    if (!placement) {
      return;
    }

    const boardId = next.activeBoard.id;
    const destinationIndex = sortedPlacementIdsForTier(next, placement.tierId).indexOf(idolId);
    const sequence = ++idolPlacementMutationSeqRef.current;

    try {
      const serverNext = await api.invoke("hololive:placement:move", {
        boardId,
        idolId,
        tierId: placement.tierId,
        index: Math.max(destinationIndex, 0)
      });

      if (sequence !== idolPlacementMutationSeqRef.current) {
        return;
      }

      if (latestDataRef.current?.activeBoard.id !== boardId) {
        return;
      }

      if (placementLayoutSignature(latestDataRef.current ?? next) !== placementLayoutSignature(serverNext)) {
        storeTierData(serverNext);
      } else {
        latestDataRef.current = serverNext;
      }
    } catch (error) {
      console.error(error);
      if (sequence === idolPlacementMutationSeqRef.current && latestDataRef.current?.activeBoard.id === boardId) {
        void loadTierData(boardId);
      }
    }
  }

  function finishIdolPointerDrop(event: PointerEvent) {
    const drag = idolDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const idolId = drag.idolId;
    if (!drag.active) {
      event.preventDefault();
      resetIdolDragState();
      void openIdolProfile(idolId);
      return;
    }

    event.preventDefault();
    cancelPendingIdolPointerFrame();
    previewIdolMoveAtPoint({ x: event.clientX, y: event.clientY }, false);

    const snapshot = idolDragSnapshotRef.current;
    const next = previewDataRef.current ?? latestDataRef.current;
    const moved = Boolean(snapshot && next && placementLayoutSignature(snapshot) !== placementLayoutSignature(next));
    if (moved && next) {
      commitOptimisticTierData(next);
    } else {
      previewDataRef.current = null;
      setPreviewData(null);
    }

    resetIdolDragState();

    if (moved && next) {
      void persistIdolPlacement(next, idolId);
    }
  }

  function beginIdolPointerInteraction(event: ReactPointerEvent<HTMLButtonElement>, idol: HololiveIdol) {
    if (busy || event.button !== 0) {
      return;
    }

    const current = latestDataRef.current;
    if (!current || !current.activeBoard.placements.some((placement) => placement.idolId === idol.id)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const drag: IdolPointerDrag = {
      idolId: idol.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      clientX: event.clientX,
      clientY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };

    cleanupIdolPointerListeners();
    cancelPendingIdolPointerFrame();
    idolDragRef.current = drag;

    window.addEventListener("pointermove", handleWindowIdolPointerMove, { passive: false });
    window.addEventListener("pointerup", finishIdolPointerDrop, { passive: false });
    window.addEventListener("pointercancel", handleWindowIdolPointerCancel, { passive: false });
    window.addEventListener("blur", handleWindowIdolBlur);
    idolPointerCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleWindowIdolPointerMove);
      window.removeEventListener("pointerup", finishIdolPointerDrop);
      window.removeEventListener("pointercancel", handleWindowIdolPointerCancel);
      window.removeEventListener("blur", handleWindowIdolBlur);
    };
  }

  async function loadTierData(boardId = activeBoardId) {
    const sequence = ++tierDataLoadSeqRef.current;
    const next = await api.invoke("hololive:tier-data", { boardId });
    if (sequence !== tierDataLoadSeqRef.current) {
      return;
    }

    storeTierData(next);
  }

  useEffect(() => {
    void loadTierData(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTierLabelWidthSetting() {
      const settings = await api.invoke("settings:get", null);
      const parsed = Number(settings[TIER_LABEL_WIDTH_SETTING_KEY]);

      if (!cancelled && Number.isFinite(parsed)) {
        const nextWidth = clampTierLabelWidth(parsed);
        tierLabelWidthRef.current = nextWidth;
        setTierLabelWidth(nextWidth);
      }
    }

    void loadTierLabelWidthSetting();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    tierLabelWidthRef.current = tierLabelWidth;
  }, [tierLabelWidth]);

  useEffect(() => {
    if (!renamingBoardId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = boardRenameInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      const cursorPosition = input.value.length;
      input.setSelectionRange(cursorPosition, cursorPosition);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [renamingBoardId]);

  useEffect(() => {
    if (!renamingBoardId) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".hololive-board-tab.renaming")) {
        return;
      }

      cancelBoardRename();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [renamingBoardId]);

  useEffect(
    () => () => {
      document.body.classList.remove("hololive-dnd-active");
      document.body.classList.remove("hololive-idol-dragging");
      resetIdolDragState();
      clearIdolAnimationTimers();
      if (iconRefreshTimerRef.current !== null) {
        window.clearTimeout(iconRefreshTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (
      !data ||
      autoCacheAttempted.current ||
      data.idols.every((idol) => idol.cachedIconUrl && (!idol.profileImageUrl || idol.cachedProfileImageUrl))
    ) {
      return;
    }

    autoCacheAttempted.current = true;
    void refreshIcons(true);
  }, [data]);

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }

    function handleProfileEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveProfileId(null);
        setProfileFocus(null);
      }
    }

    window.addEventListener("keydown", handleProfileEscape);
    return () => window.removeEventListener("keydown", handleProfileEscape);
  }, [activeProfileId]);

  useEffect(() => {
    function handleMusicMarkerUpdated(event: Event) {
      const detail = (event as CustomEvent<{
        youtubeVideoId?: string;
        markerKey?: string | null;
        marker?: HololiveMusicMarker | null;
      }>).detail;
      if (!detail?.youtubeVideoId) {
        return;
      }

      updateCachedProfileSongMarker({
        youtubeVideoId: detail.youtubeVideoId,
        markerKey: detail.markerKey ?? null,
        marker: detail.marker ?? null
      });
    }

    window.addEventListener("hololive-music-marker-updated", handleMusicMarkerUpdated);
    return () => window.removeEventListener("hololive-music-marker-updated", handleMusicMarkerUpdated);
  }, []);

  useEffect(() => {
    function handleMusicExcluded(event: Event) {
      const detail = (event as CustomEvent<{ youtubeVideoId?: string }>).detail;
      if (detail?.youtubeVideoId) {
        removeCachedProfileSong(detail.youtubeVideoId);
      }
    }

    window.addEventListener("hololive-music-excluded", handleMusicExcluded);
    return () => window.removeEventListener("hololive-music-excluded", handleMusicExcluded);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const profileId = params.get("profile")?.trim();
    if (!profileId) {
      return;
    }

    const groupParam = params.get("group")?.trim();
    const groupId: HololiveProfileMediaGroupId | null =
      groupParam === "original-songs" || groupParam === "covers" || groupParam === "featured-in" || groupParam === "playlists"
        ? groupParam
        : null;
    const songId = params.get("song")?.trim() || null;
    const requestId = params.get("focus")?.trim() || "route";
    const signature = `${profileId}:${groupId ?? ""}:${songId ?? ""}:${requestId}`;
    if (handledProfileRouteRef.current === signature) {
      return;
    }

    handledProfileRouteRef.current = signature;
    setProfileFocus({ profileId, groupId, songId, requestId });
    void openIdolProfile(profileId, { preserveFocus: true });
  }, [location.search]);

  const visibleData = previewData ?? data;
  const idolById = useMemo(() => new Map(visibleData?.idols.map((idol) => [idol.id, idol]) ?? []), [visibleData?.idols]);
  const sortedTiers = useMemo(
    () => [...(visibleData?.activeBoard.tiers ?? [])].sort((left, right) => left.position - right.position),
    [visibleData?.activeBoard.tiers]
  );
  const placementIdsByTier = useMemo(
    () => (visibleData ? sortedPlacementIdsByTier(visibleData) : new Map<string, string[]>()),
    [visibleData?.activeBoard.placements]
  );
  const idolsByTier = useMemo(() => {
    const groups = new Map<string, HololiveIdol[]>();

    for (const [tierId, idolIds] of placementIdsByTier) {
      groups.set(
        tierId,
        idolIds.map((idolId) => idolById.get(idolId)).filter((idol): idol is HololiveIdol => Boolean(idol))
      );
    }

    return groups;
  }, [idolById, placementIdsByTier]);
  const activeIdol = activeIdolDrag ? idolById.get(activeIdolDrag.idolId) ?? null : null;
  const activeTier =
    activeDrag?.type === "tier-row" ? sortedTiers.find((tier) => tier.id === activeDrag.tierId) ?? null : null;
  const activeIdolId = activeIdolDrag?.idolId ?? null;
  const activeTierIdolCount = activeTier ? idolsByTier.get(activeTier.id)?.length ?? 0 : 0;
  const activeProfile = activeProfileId ? profileCache[activeProfileId] ?? null : null;
  const activeProfileFallbackIdol = activeProfileId ? idolById.get(activeProfileId) ?? null : null;
  const profileLoading = Boolean(activeProfileId && profileLoadingId === activeProfileId);

  async function applyDataMutation(work: () => Promise<HololiveTierListData>) {
    setBusy(true);
    try {
      const next = await work();
      storeTierData(next);
    } finally {
      setBusy(false);
    }
  }

  async function applyUndoableDataMutation(
    work: () => Promise<{ data: HololiveTierListData; undoToken?: string | null; undoLabel?: string | null }>,
    message: string
  ) {
    setBusy(true);
    try {
      const response = await work();
      storeTierData(response.data);
      if (response.undoToken) {
        showUndoToast({
          message,
          undoToken: response.undoToken,
          undoLabel: response.undoLabel,
          onApplied: async () => {
            await loadTierData(activeBoardId);
          }
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function syncDataMutation(work: () => Promise<HololiveTierListData>) {
    const next = await work();
    storeTierData(next);
  }

  async function refreshIcons(background = false) {
    if (!background) {
      setIconRefresh("running");
    }

    try {
      const result = await api.invoke("hololive:icons:refresh", null);
      if (result.cached > 0) {
        setProfileCache({});
        await loadTierData(activeBoardId);
      }

      setIconRefresh("done");
      if (iconRefreshTimerRef.current !== null) {
        window.clearTimeout(iconRefreshTimerRef.current);
      }
      iconRefreshTimerRef.current = window.setTimeout(() => {
        setIconRefresh("idle");
        iconRefreshTimerRef.current = null;
      }, 1600);
    } catch {
      setIconRefresh("idle");
    }
  }

  async function openIdolProfile(idolId: string, options: { preserveFocus?: boolean } = {}) {
    if (activeIdolDrag || idolDragRef.current) {
      return;
    }

    if (!options.preserveFocus) {
      setProfileFocus(null);
    }

    setActiveProfileId(idolId);

    if (profileCache[idolId]) {
      return;
    }

    setProfileLoadingId(idolId);
    try {
      const profile = await api.invoke("hololive:idol:profile", { idolId });
      setProfileCache((current) => ({
        ...current,
        [idolId]: profile
      }));
    } catch (error) {
      console.error(error);
      showToast({
        message: "Could not load this profile",
        detail: error instanceof Error ? error.message : "Try opening it again.",
        tone: "error"
      });
    } finally {
      setProfileLoadingId((current) => (current === idolId ? null : current));
    }
  }

  function updateCachedProfileSongMarker(input: { youtubeVideoId: string; markerKey?: string | null; marker: HololiveMusicMarker | null }) {
    setProfileCache((current) => {
      const nextEntries = Object.entries(current).map(([idolId, profile]) => [
        idolId,
        {
          ...profile,
          mediaGroups: profile.mediaGroups.map((group) => ({
            ...group,
            items: group.items.map((item) =>
              item.id === input.youtubeVideoId || (input.markerKey && item.markerKey === input.markerKey)
                ? { ...item, marker: input.marker }
                : item
            )
          }))
        }
      ]);

      return Object.fromEntries(nextEntries);
    });
  }

  function removeCachedProfileSong(youtubeVideoId: string) {
    setProfileCache((current) => {
      const nextEntries = Object.entries(current).map(([idolId, profile]) => [
        idolId,
        {
          ...profile,
          mediaGroups: profile.mediaGroups.map((group) => ({
            ...group,
            items: group.items.filter((item) => item.id !== youtubeVideoId)
          }))
        }
      ]);

      return Object.fromEntries(nextEntries);
    });
  }

  async function updateMusicMarker(item: HololiveProfileSongItem, marker: HololiveMusicMarker | null) {
    const response = await api.invoke("hololive:music-marker:set", { youtubeVideoId: item.id, marker });
    updateCachedProfileSongMarker({
      youtubeVideoId: response.youtubeVideoId,
      markerKey: response.markerKey || item.markerKey,
      marker: response.marker
    });
  }

  async function excludeMusicSong(item: HololiveProfileSongItem) {
    const response = await api.invoke("hololive:music:exclude", {
      youtubeVideoId: item.id,
      title: item.title,
      sourceUrl: item.url ?? null
    });
    removeCachedProfileSong(response.data.youtubeVideoId);
    window.dispatchEvent(
      new CustomEvent("hololive-music-excluded", {
        detail: response.data
      })
    );
    if (response.undoToken) {
      showUndoToast({
        message: "Song excluded",
        undoToken: response.undoToken,
        undoLabel: response.undoLabel,
        onApplied: async () => {
          setProfileCache({});
          await loadTierData(activeBoardId);
        }
      });
    }
  }

  async function playProfileSong(item: HololiveProfileSongItem, mediaGroupId: HololiveProfileMediaGroupId) {
    if (!activeProfileId) {
      await playVideoNow(item.id);
      return;
    }

    await playVideoNow(item.id, {
      idolId: activeProfileId,
      mediaGroupId
    });
  }

  async function addProfileSongToPlaylist(item: HololiveProfileSongItem, playlistId: string) {
    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    const alreadyInPlaylist = Boolean(playlist?.items?.some((playlistItem) => playlistItem.youtubeVideoId === item.id));
    await applyPlayerData(
      () =>
        api.invoke("hololive:player:playlist-item:add", {
          playlistId,
          youtubeVideoId: item.id
        }),
      playlist
        ? alreadyInPlaylist
          ? `Removed from ${playlist.name}`
          : `Added to ${playlist.name}`
        : "Playlist updated"
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const dragType = event.active.data.current?.type;

    if (dragType === "tier-row") {
      const tierId = parseTierRowDragId(event.active.id);
      if (tierId) {
        document.body.classList.add("hololive-dnd-active");
        setActiveDrag({ type: "tier-row", tierId });
      }
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const dragType = event.active.data.current?.type;

    if (dragType === "tier-row") {
      const tierId = parseTierRowDragId(event.active.id);
      const overTierId = event.over ? parseTierRowDragId(event.over.id) : null;
      document.body.classList.remove("hololive-dnd-active");
      setActiveDrag(null);

      if (!data || !tierId || !overTierId || tierId === overTierId) {
        return;
      }

      const oldIndex = sortedTiers.findIndex((tier) => tier.id === tierId);
      const newIndex = sortedTiers.findIndex((tier) => tier.id === overTierId);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      const nextTiers = arrayMove(sortedTiers, oldIndex, newIndex);
      const nextData = reorderTiersInData(data, nextTiers.map((tier) => tier.id));
      storeTierData(nextData);

      await syncDataMutation(() =>
        api.invoke("hololive:tier:reorder", {
          boardId: nextData.activeBoard.id,
          tierIds: nextTiers.map((tier) => tier.id)
        })
      );
      return;
    }

    document.body.classList.remove("hololive-dnd-active");
    setActiveDrag(null);
  }

  function handleDragCancel() {
    document.body.classList.remove("hololive-dnd-active");
    setActiveDrag(null);
  }

  async function handleBoardTabDragEnd(event: DragEndEvent) {
    if (!data) {
      return;
    }

    const boardId = parseBoardTabDragId(event.active.id);
    const overBoardId = event.over ? parseBoardTabDragId(event.over.id) : null;

    if (!boardId || !overBoardId || boardId === overBoardId) {
      return;
    }

    const oldIndex = data.boards.findIndex((board) => board.id === boardId);
    const newIndex = data.boards.findIndex((board) => board.id === overBoardId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const nextBoards = arrayMove(data.boards, oldIndex, newIndex);
    const nextBoardIds = nextBoards.map((board) => board.id);
    const nextData = reorderBoardsInData(data, nextBoardIds);
    storeTierData(nextData);

    await syncDataMutation(() =>
      api.invoke("hololive:board:reorder", {
        boardIds: nextBoardIds,
        activeBoardId: nextData.activeBoard.id
      })
    );
  }

  function setSharedTierLabelWidth(width: number) {
    const nextWidth = clampTierLabelWidth(width);
    tierLabelWidthRef.current = nextWidth;
    setTierLabelWidth(nextWidth);
  }

  function beginTierLabelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (busy) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = tierLabelWidthRef.current;

    function handlePointerMove(moveEvent: PointerEvent) {
      setSharedTierLabelWidth(startWidth + moveEvent.clientX - startX);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      void api.invoke("settings:set", {
        key: TIER_LABEL_WIDTH_SETTING_KEY,
        value: String(tierLabelWidthRef.current)
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  async function createBoard() {
    if (!data) {
      return;
    }

    await applyDataMutation(() =>
      api.invoke("hololive:board:create", {
        name: nextBoardName(data),
        afterBoardId: data.activeBoard.id
      })
    );
  }

  function beginBoardRename(board: HololiveTierBoardSummary, tabWidth: number | null) {
    if (busy) {
      return;
    }

    setRenamingBoardId(board.id);
    setBoardRenameDraft(board.name);
    setBoardRenameWidth(tabWidth);
  }

  function cancelBoardRename() {
    setRenamingBoardId(null);
    setBoardRenameDraft("");
    setBoardRenameWidth(null);
  }

  async function commitBoardRename(boardId: string, rawName: string) {
    if (!data) {
      cancelBoardRename();
      return;
    }

    const board = data.boards.find((candidate) => candidate.id === boardId);
    const nextName = rawName.trim();
    cancelBoardRename();

    if (!board || nextName.length === 0 || nextName === board.name) {
      return;
    }

    await applyDataMutation(() => api.invoke("hololive:board:update", { boardId, name: nextName }));
  }

  async function performDeleteBoard(boardId: string) {
    await applyUndoableDataMutation(
      () => api.invoke("hololive:board:delete", { boardId }),
      "Board deleted"
    );
  }

  async function deleteBoard() {
    if (!data || data.boards.length <= 1) {
      return;
    }

    const board = data.activeBoard;
    showToast({
      message: `Delete "${board.name}"?`,
      detail: "This removes the board. You can undo immediately after deletion.",
      tone: "error",
      actionLabel: "Delete",
      onAction: () => performDeleteBoard(board.id)
    });
  }

  async function clearBoard() {
    if (!data) {
      return;
    }

    await applyUndoableDataMutation(
      () => api.invoke("hololive:board:clear", { boardId: data.activeBoard.id }),
      "Board cleared"
    );
  }

  async function createTierAdjacent(tier: HololiveTier, direction: "above" | "below") {
    if (!data) {
      return;
    }

    await applyDataMutation(() =>
      api.invoke("hololive:tier:create", {
        boardId: data.activeBoard.id,
        position: tier.position + (direction === "below" ? 1 : 0)
      })
    );
  }

  async function updateTier(tier: HololiveTier, patch: Partial<Pick<HololiveTier, "label" | "color">>) {
    if (!data) {
      return;
    }

    await applyDataMutation(() =>
      api.invoke("hololive:tier:update", {
        boardId: data.activeBoard.id,
        tierId: tier.id,
        ...patch
      })
    );
  }

  async function performDeleteTier(tierId: string) {
    if (!data) {
      return;
    }

    await applyDataMutation(() =>
      api.invoke("hololive:tier:delete", {
        boardId: data.activeBoard.id,
        tierId
      })
    );
  }

  async function deleteTier(tier: HololiveTier) {
    if (!data) {
      return;
    }

    showToast({
      message: `Delete tier "${tier.label}"?`,
      detail: "Its idols will move to Unranked.",
      tone: "error",
      actionLabel: "Delete",
      onAction: () => performDeleteTier(tier.id)
    });
  }

  async function sortUnranked() {
    if (!data) {
      return;
    }

    await applyDataMutation(() =>
      api.invoke("hololive:unranked:sort", {
        boardId: data.activeBoard.id
      })
    );
  }

  if (!visibleData) {
    return (
      <div className="hololive-page">
        <div className="boot-screen hololive-loading">Loading Hololive</div>
      </div>
    );
  }

  const unrankedIdols = idolsByTier.get(POOL_CONTAINER_ID) ?? EMPTY_IDOLS;
  const currentIdolDrag = activeIdolDrag ? idolDragRef.current : null;

  return (
    <section
      className="hololive-page hololive-tier-layout"
      aria-label="Hololive tier list"
      style={
        {
          "--hololive-icon-size": `${LOCKED_HOLOLIVE_ICON_SIZE}px`,
          "--hololive-tier-label-width": `${tierLabelWidth}px`
        } as CSSProperties
      }
    >
      <HololiveViewSwitch />
      <section className="hololive-board-tabs" aria-label="Tier list boards">
          <DndContext
            sensors={boardSensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleBoardTabDragEnd(event)}
          >
            <SortableContext
              items={visibleData.boards.map((board) => boardTabDragId(board.id))}
              strategy={horizontalListSortingStrategy}
            >
              <div className="hololive-board-tab-list" role="tablist" aria-label="Saved tier boards">
                {visibleData.boards.map((board) => (
                  <BoardTab
                    key={board.id}
                    board={board}
                    active={board.id === visibleData.activeBoard.id}
                    deletable={visibleData.boards.length > 1}
                    disabled={busy}
                    renaming={renamingBoardId === board.id}
                    renameDraft={boardRenameDraft}
                    renameWidth={boardRenameWidth}
                    renameInputRef={boardRenameInputRef}
                    onRenameDraftChange={setBoardRenameDraft}
                    onBeginRename={beginBoardRename}
                    onCancelRename={cancelBoardRename}
                    onCommitRename={commitBoardRename}
                    onDelete={deleteBoard}
                    onSelect={(boardId) => void loadTierData(boardId)}
                  />
                ))}
                <button
                  className="icon-button hololive-board-add-button"
                  type="button"
                  onClick={createBoard}
                  disabled={busy}
                  title="Add board"
                >
                  <Plus size={13} />
                </button>
              </div>
            </SortableContext>
          </DndContext>
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={(event) => void handleDragEnd(event)}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={sortedTiers.map((tier) => tierRowDragId(tier.id))}
          strategy={verticalListSortingStrategy}
        >
          <section
            className="hololive-tier-board"
            aria-label="Hololive idol tier list"
          >
            {sortedTiers.map((tier) => (
              <TierRow
                key={tier.id}
                tier={tier}
                idols={idolsByTier.get(tier.id) ?? EMPTY_IDOLS}
                tileSize={LOCKED_HOLOLIVE_ICON_SIZE}
                disabled={busy}
                activeIdolId={activeIdolId}
                onIdolPointerDown={beginIdolPointerInteraction}
                onOpenProfile={openIdolProfile}
                onUpdate={updateTier}
                onDelete={deleteTier}
                onCreateAdjacent={createTierAdjacent}
                onResizeStart={beginTierLabelResize}
              />
            ))}
          </section>
        </SortableContext>

        <DragOverlay>
          {activeTier ? <TierDragPreview tier={activeTier} idolCount={activeTierIdolCount} /> : null}
        </DragOverlay>
      </DndContext>

      <IdolPool
        idols={unrankedIdols}
        tileSize={LOCKED_HOLOLIVE_ICON_SIZE}
        disabled={busy}
        iconRefresh={iconRefresh}
        activeIdolId={activeIdolId}
        onIdolPointerDown={beginIdolPointerInteraction}
        onOpenProfile={openIdolProfile}
        onSort={sortUnranked}
        onClear={clearBoard}
        onRefreshIcons={() => refreshIcons(false)}
      />

      {activeIdol && currentIdolDrag ? (
        <div
          ref={idolOverlayRef}
          className="hololive-idol-drag-overlay"
          style={{
            width: LOCKED_HOLOLIVE_ICON_SIZE,
            height: LOCKED_HOLOLIVE_ICON_SIZE,
            transform: `translate3d(${currentIdolDrag.clientX - currentIdolDrag.offsetX}px, ${
              currentIdolDrag.clientY - currentIdolDrag.offsetY
            }px, 0)`
          }}
        >
          <IdolTile idol={activeIdol} tileSize={LOCKED_HOLOLIVE_ICON_SIZE} overlay />
        </div>
      ) : null}

      {activeProfileId ? (
        <HololiveProfileShelf
          profile={activeProfile}
          fallbackIdol={activeProfileFallbackIdol}
          loading={profileLoading}
          activeMusicVideoId={activeMusicVideoId}
          focusedGroupId={profileFocus?.profileId === activeProfileId ? profileFocus.groupId : null}
          focusedSongId={profileFocus?.profileId === activeProfileId ? profileFocus.songId : null}
          focusRequestId={profileFocus?.profileId === activeProfileId ? profileFocus.requestId : null}
          onClose={() => {
            setActiveProfileId(null);
            setProfileFocus(null);
          }}
          onMusicMarkerChange={updateMusicMarker}
          onMusicExclude={excludeMusicSong}
          playlists={userPlaylists}
          onMusicPlay={playProfileSong}
          onMusicPlaylistAdd={addProfileSongToPlaylist}
        />
      ) : null}
    </section>
  );
}

interface BoardTabProps {
  board: HololiveTierBoardSummary;
  active: boolean;
  deletable: boolean;
  disabled: boolean;
  renaming: boolean;
  renameDraft: string;
  renameWidth: number | null;
  renameInputRef: RefObject<HTMLInputElement | null>;
  onRenameDraftChange: (value: string) => void;
  onBeginRename: (board: HololiveTierBoardSummary, tabWidth: number | null) => void;
  onCancelRename: () => void;
  onCommitRename: (boardId: string, value: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onSelect: (boardId: string) => void;
}

function BoardTab({
  board,
  active,
  deletable,
  disabled,
  renaming,
  renameDraft,
  renameWidth,
  renameInputRef,
  onRenameDraftChange,
  onBeginRename,
  onCancelRename,
  onCommitRename,
  onDelete,
  onSelect
}: BoardTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: boardTabDragId(board.id),
    data: {
      type: "board-tab",
      boardId: board.id
    },
    disabled
  });
  const { role: _sortableRole, ...sortableAttributes } = attributes;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: renaming && renameWidth ? `${renameWidth}px` : undefined
  } satisfies CSSProperties;

  return (
    <div
      ref={setNodeRef}
      className={`hololive-board-tab ${active ? "active" : ""} ${deletable ? "deletable" : ""} ${
        renaming ? "renaming" : ""
      } ${isDragging ? "dragging" : ""}`}
      style={style}
      role="tab"
      aria-selected={active}
      title={board.name}
      {...sortableAttributes}
      {...listeners}
    >
      {renaming ? (
        <input
          className="hololive-board-rename-input"
          ref={renameInputRef}
          value={renameDraft}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onCommitRename(board.id, event.currentTarget.value);
            }

            if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
          aria-label={`Rename ${board.name}`}
        />
      ) : (
        <button
          className="hololive-board-tab-name"
          type="button"
          onClick={() => {
            if (!active) {
              onSelect(board.id);
            }
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            const tab = event.currentTarget.closest(".hololive-board-tab");
            onBeginRename(board, tab?.getBoundingClientRect().width ?? null);
          }}
          disabled={disabled}
          title={`${board.name} - double-click to rename`}
        >
          {board.name}
        </button>
      )}
      {active && deletable && !renaming ? (
        <button
          className="hololive-board-tab-delete"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void onDelete();
          }}
          disabled={disabled}
          title="Delete current board"
          aria-label={`Delete ${board.name}`}
        >
          <Trash2 size={12} />
        </button>
      ) : null}
    </div>
  );
}

interface TierRowProps {
  tier: HololiveTier;
  idols: HololiveIdol[];
  tileSize: number;
  disabled: boolean;
  activeIdolId: string | null;
  onIdolPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, idol: HololiveIdol) => void;
  onOpenProfile: (idolId: string) => void;
  onUpdate: (tier: HololiveTier, patch: Partial<Pick<HololiveTier, "label" | "color">>) => Promise<void>;
  onDelete: (tier: HololiveTier) => Promise<void>;
  onCreateAdjacent: (tier: HololiveTier, direction: "above" | "below") => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function TierRow({
  tier,
  idols,
  tileSize,
  disabled,
  activeIdolId,
  onIdolPointerDown,
  onOpenProfile,
  onUpdate,
  onDelete,
  onCreateAdjacent,
  onResizeStart
}: TierRowProps) {
  const containerId = tierContainerId(tier.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tierRowDragId(tier.id),
    data: {
      type: "tier-row",
      tierId: tier.id
    },
    disabled
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  } satisfies CSSProperties;

  return (
    <div
      ref={setNodeRef}
      className={`hololive-tier-row ${isDragging ? "dragging" : ""}`}
      style={style}
      data-tier-id={tier.id}
    >
      <div
        className="hololive-tier-label"
        style={{ "--tier-color": tier.color } as CSSProperties}
      >
        <label className="hololive-color-notch" title={`${tier.label} color`} onClick={(event) => event.stopPropagation()}>
          <input
            className="hololive-color-input"
            type="color"
            value={tier.color}
            onChange={(event) => void onUpdate(tier, { color: event.target.value })}
            aria-label={`${tier.label} color`}
            disabled={disabled}
          />
        </label>
        <button
          className="hololive-tier-grip"
          type="button"
          disabled={disabled}
          title="Drag tier row"
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
        <input
          type="text"
          defaultValue={tier.label}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (event.target.value.trim() !== tier.label) {
              void onUpdate(tier, { label: event.target.value.trim() });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          aria-label={`${tier.label} label`}
          disabled={disabled}
        />
      </div>

      <button
        className="hololive-tier-label-resizer"
        type="button"
        aria-label="Resize tier label column"
        title="Resize tier label column"
        disabled={disabled}
        onPointerDown={onResizeStart}
      />

      <IdolDropzone
        containerId={containerId}
        tierId={tier.id}
        idols={idols}
        tileSize={tileSize}
        disabled={disabled}
        activeIdolId={activeIdolId}
        onIdolPointerDown={onIdolPointerDown}
        onOpenProfile={onOpenProfile}
      />

      <div className="hololive-tier-delete-notch" aria-label={`${tier.label} row options`}>
        <button
          className="icon-button hololive-tier-add-button"
          type="button"
          onClick={() => void onCreateAdjacent(tier, "above")}
          disabled={disabled}
          title="Add row above"
          aria-label={`Add row above ${tier.label}`}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="icon-button danger hololive-tier-delete-button"
          type="button"
          onClick={() => void onDelete(tier)}
          disabled={disabled}
          title="Delete row"
        >
          <Trash2 size={15} />
        </button>
        <button
          className="icon-button hololive-tier-add-button"
          type="button"
          onClick={() => void onCreateAdjacent(tier, "below")}
          disabled={disabled}
          title="Add row below"
          aria-label={`Add row below ${tier.label}`}
        >
          <ArrowDown size={14} />
        </button>
      </div>
    </div>
  );
}

interface IdolDropzoneProps {
  containerId: string;
  tierId: string | null;
  idols: HololiveIdol[];
  tileSize: number;
  disabled: boolean;
  activeIdolId: string | null;
  onIdolPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, idol: HololiveIdol) => void;
  onOpenProfile: (idolId: string) => void;
}

function IdolDropzone({
  containerId,
  tierId,
  idols,
  tileSize,
  disabled,
  activeIdolId,
  onIdolPointerDown,
  onOpenProfile
}: IdolDropzoneProps) {
  return (
    <div
      className={`hololive-tier-dropzone ${containerId === POOL_CONTAINER_ID ? "hololive-pool-dropzone" : ""}`}
      data-idol-container-id={containerId}
      data-tier-id={tierId ?? ""}
    >
      <div className="hololive-idol-grid">
        {idols.map((idol) => (
          <IdolTile
            key={idol.id}
            idol={idol}
            tileSize={tileSize}
            dragging={idol.id === activeIdolId}
            disabled={disabled}
            onPointerDown={(event) => onIdolPointerDown(event, idol)}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </div>
    </div>
  );
}

interface IdolPoolProps {
  idols: HololiveIdol[];
  tileSize: number;
  disabled: boolean;
  iconRefresh: "idle" | "running" | "done";
  activeIdolId: string | null;
  onIdolPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, idol: HololiveIdol) => void;
  onOpenProfile: (idolId: string) => void;
  onSort: () => Promise<void>;
  onClear: () => Promise<void>;
  onRefreshIcons: () => void;
}

function IdolPool({
  idols,
  tileSize,
  disabled,
  iconRefresh,
  activeIdolId,
  onIdolPointerDown,
  onOpenProfile,
  onSort,
  onClear,
  onRefreshIcons
}: IdolPoolProps) {
  return (
    <section className="hololive-pool" aria-label="Unranked idols">
      <div className="hololive-pool-heading">
        <div className="hololive-pool-title">
          <strong>Unranked</strong>
          <span>{idols.length}</span>
        </div>
        <div className="hololive-pool-actions">
          <button className="button holo-button hololive-pool-button" type="button" onClick={onSort} disabled={disabled}>
            <ArrowDownAZ size={15} />
            <span>Sort</span>
          </button>
          <button className="button holo-button hololive-pool-button" type="button" onClick={onClear} disabled={disabled}>
            <Eraser size={15} />
            <span>Clear</span>
          </button>
          <button
            className="button holo-button hololive-pool-button"
            type="button"
            onClick={onRefreshIcons}
            disabled={iconRefresh === "running"}
          >
            <RefreshCcw size={15} />
            <span>{iconRefresh === "running" ? "Caching" : "Icons"}</span>
          </button>
        </div>
      </div>
      <IdolDropzone
        containerId={POOL_CONTAINER_ID}
        tierId={null}
        idols={idols}
        tileSize={tileSize}
        disabled={disabled}
        activeIdolId={activeIdolId}
        onIdolPointerDown={onIdolPointerDown}
        onOpenProfile={onOpenProfile}
      />
    </section>
  );
}

interface TierDragPreviewProps {
  tier: HololiveTier;
  idolCount: number;
}

function TierDragPreview({ tier, idolCount }: TierDragPreviewProps) {
  return (
    <div className="hololive-tier-preview" style={{ "--tier-color": tier.color } as CSSProperties}>
      <span>{tier.label}</span>
      <strong>{idolCount} idols</strong>
    </div>
  );
}

type HololiveProfileSongItem = HololiveProfileMediaGroup["items"][number];

interface HololiveSongListProps {
  items: HololiveProfileSongItem[];
  activeVideoId?: string | null;
  mediaGroupId: HololiveProfileMediaGroupId;
  focusedSongId?: string | null;
  playlists: HololiveMusicPlayerData["playlists"];
  onMarkerChange: (item: HololiveProfileSongItem, marker: HololiveMusicMarker | null) => Promise<void>;
  onExclude: (item: HololiveProfileSongItem) => Promise<void>;
  onPlay: (item: HololiveProfileSongItem, mediaGroupId: HololiveProfileMediaGroupId) => Promise<void>;
  onPlaylistAdd: (item: HololiveProfileSongItem, playlistId: string) => Promise<void>;
}

function HololiveSongList({
  items,
  activeVideoId,
  mediaGroupId,
  focusedSongId,
  playlists,
  onMarkerChange,
  onExclude,
  onPlay,
  onPlaylistAdd
}: HololiveSongListProps) {
  const [openMarkerId, setOpenMarkerId] = useState<string | null>(null);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [pendingMarkerId, setPendingMarkerId] = useState<string | null>(null);
  const [pendingPlayerActionId, setPendingPlayerActionId] = useState<string | null>(null);
  const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(null);
  const [confirmExcludeId, setConfirmExcludeId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMarkerId && !openPlaylistId) {
      return;
    }

    function closeOpenMenus() {
      setOpenMarkerId(null);
      setOpenPlaylistId(null);
      setConfirmExcludeId(null);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".hololive-song-player-actions, .hololive-song-marker-cell")) {
        return;
      }
      closeOpenMenus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOpenMenus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [openMarkerId, openPlaylistId]);

  async function setMarker(item: HololiveProfileSongItem, marker: HololiveMusicMarker | null) {
    setPendingMarkerId(item.id);
    try {
      await onMarkerChange(item, marker);
      setOpenMarkerId(null);
    } finally {
      setPendingMarkerId((current) => (current === item.id ? null : current));
    }
  }

  async function excludeSong(item: HololiveProfileSongItem) {
    setPendingMarkerId(item.id);
    try {
      await onExclude(item);
      setOpenMarkerId(null);
      setConfirmExcludeId(null);
    } finally {
      setPendingMarkerId((current) => (current === item.id ? null : current));
    }
  }

  async function playSong(item: HololiveProfileSongItem) {
    setPendingPlayerActionId(item.id);
    try {
      await onPlay(item, mediaGroupId);
    } finally {
      setPendingPlayerActionId((current) => (current === item.id ? null : current));
    }
  }

  async function addSongToPlaylist(item: HololiveProfileSongItem, playlistId: string) {
    setPendingPlaylistId(item.id);
    try {
      await onPlaylistAdd(item, playlistId);
      setOpenPlaylistId(null);
    } finally {
      setPendingPlaylistId((current) => (current === item.id ? null : current));
    }
  }

  return (
    <ul className="hololive-song-list">
      {items.map((item) => {
        const publishedDate = formatSongDate(item.publishedAt);
        const duration = formatDuration(item.durationSeconds);
        const views = formatViewCount(item.viewCount);
        const meta = [publishedDate, duration, views].filter(Boolean);
        const markerLabel = musicMarkerLabel(item.marker);
        const isMarkerOpen = openMarkerId === item.id;
        const isMarkerPending = pendingMarkerId === item.id;
        const isPlaylistOpen = openPlaylistId === item.id;
        const isPlaylistPending = pendingPlaylistId === item.id;
        const isActive = item.id === activeVideoId;
        const isFocused = item.id === focusedSongId;

        return (
          <li
            key={item.id}
            className={`hololive-song-row ${isActive ? "playing" : ""} ${isFocused ? "focused" : ""}`}
            data-song-id={item.id}
          >
            <span className="hololive-song-title-cell">
              {item.url ? (
                <a className="hololive-song-title hololive-song-title-link" href={item.url} target="_blank" rel="noreferrer" title={item.title}>
                  {item.title}
                </a>
              ) : (
                <span className="hololive-song-title" title={item.title}>{item.title}</span>
              )}
            </span>
            {meta.length > 0 ? <span className="hololive-song-meta">{meta.join(" / ")}</span> : null}
            <span
              className="hololive-song-player-actions"
              aria-label={`Player actions for ${item.title}`}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setOpenPlaylistId((current) => (current === item.id ? null : current));
                }
              }}
            >
              <button
                type="button"
                disabled={pendingPlayerActionId !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  void playSong(item);
                }}
                title="Play now"
                aria-label={`Play ${item.title} now`}
              >
                <Play size={12} />
              </button>
              <button
                type="button"
                disabled={isPlaylistPending || playlists.length === 0}
                aria-expanded={isPlaylistOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMarkerId(null);
                  setOpenPlaylistId((current) => (current === item.id ? null : item.id));
                }}
                title={playlists.length === 0 ? "Create a playlist first" : "Add to playlist"}
                aria-label={`Add ${item.title} to playlist`}
              >
                <ListMusic size={12} />
              </button>
              {isPlaylistOpen ? (
                <HololivePlaylistMenu
                  ariaLabel={`Choose playlist for ${item.title}`}
                  className="hololive-song-playlist-popover"
                  disabled={isPlaylistPending}
                  emptyText="No playlists yet"
                  playlists={playlists}
                  youtubeVideoId={item.id}
                  onSelect={(playlistId) => void addSongToPlaylist(item, playlistId)}
                />
              ) : null}
            </span>
            <span
              className="hololive-song-marker-cell"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setOpenMarkerId((current) => (current === item.id ? null : current));
                  setConfirmExcludeId((current) => (current === item.id ? null : current));
                }
              }}
            >
              <button
                className={`hololive-song-marker-button ${item.marker ?? "unmarked"}`}
                type="button"
                disabled={isMarkerPending}
                aria-label={`${markerLabel} marker for ${item.title}`}
                aria-expanded={isMarkerOpen}
                title={`${markerLabel} marker`}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenPlaylistId(null);
                  setOpenMarkerId((current) => (current === item.id ? null : item.id));
                }}
              >
                <MusicMarkerIcon marker={item.marker} />
              </button>
              {isMarkerOpen ? (
                <HololiveMusicMarkerMenu
                  ariaLabel={`Set marker for ${item.title}`}
                  className="hololive-song-marker-popover"
                  confirmAriaLabel={`Confirm exclusion for ${item.title}`}
                  confirmingExclude={confirmExcludeId === item.id}
                  disabled={isMarkerPending}
                  marker={item.marker}
                  onConfirmingExcludeChange={(confirming) => setConfirmExcludeId(confirming ? item.id : null)}
                  onExclude={() => void excludeSong(item)}
                  onSetMarker={(marker) => void setMarker(item, marker)}
                />
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface HololiveProfileShelfProps {
  profile: HololiveIdolProfile | null;
  fallbackIdol: HololiveIdol | null;
  loading: boolean;
  activeMusicVideoId?: string | null;
  focusedGroupId?: HololiveProfileMediaGroupId | null;
  focusedSongId?: string | null;
  focusRequestId?: string | null;
  playlists: HololiveMusicPlayerData["playlists"];
  onClose: () => void;
  onMusicMarkerChange: (item: HololiveProfileSongItem, marker: HololiveMusicMarker | null) => Promise<void>;
  onMusicExclude: (item: HololiveProfileSongItem) => Promise<void>;
  onMusicPlay: (item: HololiveProfileSongItem, mediaGroupId: HololiveProfileMediaGroupId) => Promise<void>;
  onMusicPlaylistAdd: (item: HololiveProfileSongItem, playlistId: string) => Promise<void>;
}

function HololiveProfileShelf({
  profile,
  fallbackIdol,
  loading,
  activeMusicVideoId,
  focusedGroupId,
  focusedSongId,
  focusRequestId,
  playlists,
  onClose,
  onMusicMarkerChange,
  onMusicExclude,
  onMusicPlay,
  onMusicPlaylistAdd
}: HololiveProfileShelfProps) {
  const idol =
    profile?.idol && fallbackIdol
      ? {
          ...profile.idol,
          cachedIconUrl: fallbackIdol.cachedIconUrl ?? profile.idol.cachedIconUrl,
          cachedProfileImageUrl: fallbackIdol.cachedProfileImageUrl ?? profile.idol.cachedProfileImageUrl
        }
      : profile?.idol ?? fallbackIdol;
  const profileImageUrl = idol?.cachedProfileImageUrl ?? idol?.profileImageUrl ?? idol?.cachedIconUrl ?? idol?.iconUrl ?? "";
  const detailRows = idol
      ? [
        { label: "Birthday", value: idol.birthday, icon: <CalendarDays size={14} /> },
        { label: "Debut", value: idol.debutDate, icon: <CalendarDays size={14} /> },
        { label: "Height", value: idol.height, icon: <Ruler size={14} /> }
      ].filter((row) => row.value)
    : [];
  const links =
    profile?.links ??
    (idol
      ? [
          ...(idol.xUrl
            ? [
                {
                  id: "x",
                  label: idol.xHandle ?? "X",
                  url: idol.xUrl,
                  kind: "x" as const
                }
              ]
            : [])
        ]
      : []);
  const mediaGroups = profile?.mediaGroups ?? [];
  const mainChannel = profile?.mainChannel ?? null;
  const channelStats = [
    { label: "Subscribers", value: formatSubscriberCount(mainChannel?.subscriberCount) },
    { label: "Videos", value: formatExactCount(mainChannel?.videoCount) },
    { label: "Clips", value: formatExactCount(mainChannel?.clipCount) }
  ].filter((stat) => stat.value);
  const displayLinks = [
    ...(mainChannel
      ? [
          {
            id: "youtube",
            label: mainChannel.name,
            url: mainChannel.url,
            kind: "youtube" as const
          }
        ]
      : idol?.youtubeChannelUrl
        ? [
            {
              id: "youtube",
              label: idol.displayName,
              url: idol.youtubeChannelUrl,
              kind: "youtube" as const
            }
          ]
        : []),
    ...links.filter((link) => link.kind !== "youtube")
  ];
  const [openGroupIds, setOpenGroupIds] = useState<Set<HololiveProfileMediaGroupId>>(() => new Set());
  const profileContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusedGroupId) {
      return;
    }

    setOpenGroupIds((current) => new Set([...current, focusedGroupId]));
  }, [focusedGroupId, focusedSongId, focusRequestId]);

  useEffect(() => {
    if (!focusedSongId || !profile) {
      return;
    }

    if (focusedGroupId && !openGroupIds.has(focusedGroupId)) {
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
      const escapedSongId = escapeAttributeSelectorValue(focusedSongId);
        const scrollContainer = profileContentRef.current;
        const songRow = scrollContainer?.querySelector<HTMLElement>(`.hololive-song-row[data-song-id="${escapedSongId}"]`);
        if (!scrollContainer || !songRow) {
          return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const rowRect = songRow.getBoundingClientRect();
        const centeredTop =
          scrollContainer.scrollTop + rowRect.top - containerRect.top - scrollContainer.clientHeight / 2 + rowRect.height / 2;
        scrollContainer.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: "smooth"
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [focusedGroupId, focusedSongId, focusRequestId, openGroupIds, profile]);

  return (
    <div
      className="hololive-profile-layer"
      aria-label="Hololive profile shelf"
      onMouseDown={onClose}
    >
      <aside
        className="hololive-profile-shelf"
        aria-live="polite"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="hololive-profile-topbar">
          <span>Profile</span>
          <button className="hololive-profile-close" type="button" onClick={onClose} aria-label="Close profile">
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>

        {idol ? (
          <div className="hololive-profile-content" ref={profileContentRef}>
            <div className="hololive-profile-hero">
              <a
                className="hololive-profile-image-frame"
                href={idol.officialUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open ${idol.displayName} official profile`}
                aria-label={`Open ${idol.displayName} official profile`}
              >
                <img src={profileImageUrl} alt="" draggable={false} loading="lazy" decoding="async" />
              </a>
              <div className="hololive-profile-heading">
                <h2>{idol.displayName}</h2>
                <div className="hololive-profile-meta" aria-label="Talent details">
                  <span>{idol.branch}</span>
                  <span>{idol.generation}</span>
                  <span className={`status ${idol.status}`}>{idol.status}</span>
                </div>
              </div>
            </div>

            {loading ? <div className="hololive-profile-message">Loading profile</div> : null}
            {idol.profileQuote ? <p className="hololive-profile-quote">{idol.profileQuote}</p> : null}

            {displayLinks.length > 0 ? (
              <nav className="hololive-profile-links" aria-label="Official links">
                {displayLinks.map((link) => (
                  <a
                    key={link.id}
                    className={`hololive-profile-link ${link.kind}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    title={link.url}
                  >
                    <span>{link.label}</span>
                  </a>
                ))}
              </nav>
            ) : null}

            {detailRows.length > 0 ? (
              <dl className="hololive-profile-facts">
                {detailRows.map((row) => (
                  <div key={row.label}>
                    <dt>
                      {row.icon}
                      <span>{row.label}</span>
                    </dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {channelStats.length > 0 ? (
              <dl className="hololive-profile-stats" aria-label="Channel stats">
                {channelStats.map((stat) => (
                  <div key={stat.label}>
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {mediaGroups.length > 0 ? (
              <div className="hololive-profile-accordions">
                {mediaGroups.map((group) => {
                  const groupOpen = openGroupIds.has(group.id);

                  return (
                    <details
                      key={group.id}
                      className="hololive-profile-accordion"
                      open={groupOpen}
                      onToggle={(event) => {
                        const nextOpen = event.currentTarget.open;
                        setOpenGroupIds((current) => {
                          const next = new Set(current);
                          if (nextOpen) {
                            next.add(group.id);
                          } else {
                            next.delete(group.id);
                          }
                          return next;
                        });
                      }}
                    >
                      <summary>
                        <span>{group.label}</span>
                        <strong>{group.items.length}</strong>
                      </summary>
                      {group.items.length > 0 ? (
                        <HololiveSongList
                          items={group.items}
                          activeVideoId={activeMusicVideoId}
                          mediaGroupId={group.id}
                          focusedSongId={focusedGroupId === group.id ? focusedSongId : null}
                          playlists={playlists}
                          onMarkerChange={onMusicMarkerChange}
                          onExclude={onMusicExclude}
                          onPlay={onMusicPlay}
                          onPlaylistAdd={onMusicPlaylistAdd}
                        />
                      ) : (
                        <p>No entries yet.</p>
                      )}
                    </details>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="hololive-profile-message">Loading profile</div>
        )}
      </aside>
    </div>
  );
}

interface IdolTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  idol: HololiveIdol;
  tileSize: number;
  dragging?: boolean;
  overlay?: boolean;
  onOpenProfile?: (idolId: string) => void;
  style?: CSSProperties;
}

const IdolTile = forwardRef<HTMLButtonElement, IdolTileProps>(function IdolTile(
  {
    idol,
    tileSize,
    dragging = false,
    overlay = false,
    onOpenProfile,
    disabled = false,
    onKeyDown,
    style,
    ...buttonProps
  },
  ref
) {
  const [src, setSrc] = useState(idol.cachedIconUrl ?? idol.iconUrl);

  useEffect(() => {
    setSrc(idol.cachedIconUrl ?? idol.iconUrl);
  }, [idol.cachedIconUrl, idol.iconUrl]);

  return (
    <button
      ref={ref}
      className={`hololive-idol-tile ${dragging ? "dragging" : ""} ${overlay ? "overlay" : ""}`}
      type="button"
      style={{ width: tileSize, height: tileSize, ...style }}
      title={overlay ? idol.displayName : `${idol.displayName} - click to open profile; drag to rank`}
      aria-label={idol.displayName}
      disabled={disabled}
      data-idol-id={idol.id}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          overlay ||
          disabled ||
          dragging ||
          (event.key !== "Enter" && event.key !== " ")
        ) {
          return;
        }

        event.preventDefault();
        onOpenProfile?.(idol.id);
      }}
      {...buttonProps}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (src !== idol.iconUrl) {
            setSrc(idol.iconUrl);
          }
        }}
      />
      {idol.status !== "active" ? <span className={`idol-status ${idol.status}`}>{idol.status[0]}</span> : null}
    </button>
  );
});
