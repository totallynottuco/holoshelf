import type {
  CatalogItem,
  RecommendationProvider,
  RecommendationRequest,
  RecommendationResult
} from "./contracts";
import { hasBlockedTags, normalizeTags } from "./blocklist";

function scoreItem(request: RecommendationRequest, item: CatalogItem): RecommendationResult | null {
  if (item.moduleId !== request.moduleId) {
    return null;
  }

  if (hasBlockedTags(item.tags, request.blockedTags)) {
    return null;
  }

  const preferred = normalizeTags(request.preferredTags);
  const itemTags = normalizeTags(item.tags);
  const reasons: string[] = [];
  let score = 0;

  for (const tag of itemTags) {
    if (preferred.includes(tag)) {
      score += 10;
      reasons.push(`tag:${tag}`);
    }
  }

  if (typeof item.rating === "number") {
    score += item.rating * 1.5;
    reasons.push(`rating:${item.rating}`);
  }

  if (item.status === "completed") {
    score += 2;
  }

  if (item.status === "dropped" || item.status === "ignored") {
    score -= 20;
  }

  if (request.seedItemId && item.id === request.seedItemId) {
    score -= 100;
  }

  return { item, score, reasons };
}

export const localTagRecommendationProvider: RecommendationProvider = {
  id: "local-tag-score",
  label: "Local tag score",
  localOnly: true,
  recommend(request, items) {
    return items
      .map((item) => scoreItem(request, item))
      .filter((result): result is RecommendationResult => result !== null)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
      .slice(0, request.limit);
  }
};

