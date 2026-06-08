// Slice 5-S10 — deterministic curated kinship-term dictionary. Unambiguous
// non-English family-language words ONLY (no "Nana"/"Papa"/"Baba" — those collide
// with English or with given names). Extend the dictionary as new terms surface;
// open-vocabulary LLM detection is a deferred enhancement.
//
// Keep keys lowercase; matching is case-insensitive on word boundaries.
const KINSHIP_TERMS: Record<string, string> = {
  nani: 'grandmother',
  dadi: 'grandmother',
  dada: 'grandfather',
  lola: 'grandmother',
  lolo: 'grandfather',
  bibi: 'grandmother',
  abuela: 'grandmother',
  abuelo: 'grandfather',
  halmoni: 'grandmother',
  yaya: 'grandmother',
  teta: 'grandmother',
  jiddo: 'grandfather',
};

export interface DetectedTerm {
  term: string; // canonical display form, title-cased (e.g. "Nani")
  maps_to: string; // e.g. "grandmother"
  occurrences: number; // count in this single message
}

export function detectFamilyLanguageTerms(message: string): DetectedTerm[] {
  const counts = new Map<string, number>();
  for (const raw of message.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
    if (KINSHIP_TERMS[raw] !== undefined) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, occurrences]) => ({
    term: key.charAt(0).toUpperCase() + key.slice(1),
    maps_to: KINSHIP_TERMS[key]!,
    occurrences,
  }));
}

export const FAMILY_LANGUAGE_RATIFY_THRESHOLD = 2;
