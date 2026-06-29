import { Circle, CircleMinus, Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import type { HololiveMusicMarker } from "../../shared/contracts";

export const MUSIC_MARKERS: Array<{
  value: HololiveMusicMarker;
  label: string;
  icon: typeof Heart;
}> = [
  { value: "favorite", label: "Favorite", icon: Heart },
  { value: "like", label: "Like", icon: ThumbsUp },
  { value: "neutral", label: "Neutral", icon: CircleMinus },
  { value: "dislike", label: "Dislike", icon: ThumbsDown }
];

export function musicMarkerLabel(marker?: HololiveMusicMarker | null): string {
  return MUSIC_MARKERS.find((candidate) => candidate.value === marker)?.label ?? "Unmarked";
}

export function MusicMarkerIcon({
  marker,
  size = 13
}: {
  marker?: HololiveMusicMarker | null;
  size?: number;
}) {
  const markerDefinition = MUSIC_MARKERS.find((candidate) => candidate.value === marker);
  const Icon = markerDefinition?.icon ?? Circle;
  return <Icon size={size} aria-hidden="true" />;
}
