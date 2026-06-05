/**
 * Payload-scrubbing primitive (NFR-SEC-1, PRD §10, architecture cross-cutting 12).
 *
 * Any future sharing surface (trusted-circle recipe sharing, print export,
 * share-by-link) must pass payloads through `scrubForSharing` before egress so
 * child PII cannot leak. Built but unused at MVP — no caller wires it in yet.
 */

/**
 * The five fields classified as Safety-Classified-Sensitive under NFR-SEC-1.
 * Exported as the canonical source of truth so callers can gate on `.has(field)`
 * without duplicating the list. `ReadonlySet` — membership-checkable, immutable.
 */
export const SAFETY_CLASSIFIED_SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  'child_name',
  'declared_allergens',
  'cultural_identifiers',
  'dietary_preferences',
  'child_rating',
]);

/**
 * Returns a new object with every Safety-Classified-Sensitive top-level key
 * removed. Non-sensitive keys (and their values) are preserved unchanged. The
 * input `payload` is not mutated. Shallow only — nested objects are not
 * recursively scrubbed.
 */
export function scrubForSharing(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFETY_CLASSIFIED_SENSITIVE_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
