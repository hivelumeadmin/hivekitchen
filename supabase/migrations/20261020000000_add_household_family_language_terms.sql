-- Slice 5-S10 — household-scoped family-language ratchet (UX-DR47, forward-only).
-- One JSONB array per household; each element is a recognized kinship term and
-- its ratchet state. Forward-only is enforced at the service layer (an 'active'
-- term is never demoted), mirroring the cultural_language enum's service-layer
-- ratchet (migration 20260503100000).
--
-- Element shape (validated by FamilyLanguageTermSchema in @hivekitchen/contracts):
--   { "term": "Nani", "maps_to": "grandmother", "usage_count": 2,
--     "state": "candidate" | "active" | "forgotten",
--     "first_seen_at": "<iso>", "ratified_at": "<iso>" | null }
--
-- Rollback: ALTER TABLE households DROP COLUMN IF EXISTS preferred_family_language_terms;

ALTER TABLE households
  ADD COLUMN preferred_family_language_terms jsonb NOT NULL DEFAULT '[]'::jsonb;
