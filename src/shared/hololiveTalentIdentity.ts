export const HOLOLIVE_FUWAMOCO_TALENT_ID = "fuwamoco";
export const HOLOLIVE_FUWAMOCO_TALENT_NAME = "FUWAMOCO";
export const HOLOLIVE_FUWAMOCO_MEMBER_IDS = ["fuwawa-abyssgard", "mococo-abyssgard"] as const;

const HOLOLIVE_FUWAMOCO_MEMBER_ID_SET = new Set<string>(HOLOLIVE_FUWAMOCO_MEMBER_IDS);

export interface HololiveCanonicalTalentIdentity {
  id: string;
  name: string;
}

export function isHololiveFuwamocoMemberTalentId(id: string | null | undefined): boolean {
  return HOLOLIVE_FUWAMOCO_MEMBER_ID_SET.has(id?.trim() ?? "");
}

export function getHololiveCanonicalTalentIdentity(
  id: string | null | undefined,
  name?: string | null
): HololiveCanonicalTalentIdentity {
  const normalizedId = id?.trim() ?? "";
  if (normalizedId === HOLOLIVE_FUWAMOCO_TALENT_ID || isHololiveFuwamocoMemberTalentId(normalizedId)) {
    return {
      id: HOLOLIVE_FUWAMOCO_TALENT_ID,
      name: HOLOLIVE_FUWAMOCO_TALENT_NAME
    };
  }

  return {
    id: normalizedId,
    name: name?.trim() || normalizedId
  };
}

export function getHololiveCanonicalTalentId(id: string | null | undefined): string {
  return getHololiveCanonicalTalentIdentity(id).id;
}

export function getHololiveExpandedTalentIds(id: string | null | undefined): string[] {
  const normalizedId = id?.trim() ?? "";
  if (!normalizedId) {
    return [];
  }
  return normalizedId === HOLOLIVE_FUWAMOCO_TALENT_ID ? [...HOLOLIVE_FUWAMOCO_MEMBER_IDS] : [normalizedId];
}

export function getHololiveCanonicalTalentIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const canonicalIds: string[] = [];
  for (const id of ids) {
    const canonicalId = getHololiveCanonicalTalentId(id);
    if (canonicalId && !seen.has(canonicalId)) {
      seen.add(canonicalId);
      canonicalIds.push(canonicalId);
    }
  }
  return canonicalIds;
}
