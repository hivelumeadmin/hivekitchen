-- Slice 16-s1 — generated M5 chip suggestions.
--
-- The M5 "starting line" chip catalog used to be a projection over
-- `recipes`/`household_recipe_usage`. That forced recipe seeding to happen
-- before the information that should drive it (M3 stated taste) existed.
-- 16-s1 generates chips directly from a household snapshot instead; this
-- table is where those generated suggestions land, keyed and resolvable by
-- id so a later request (a tapped chip) can look the label back up.
--
-- `id` stays UUID-shaped deliberately: the client's `[Chips selected: ...]`
-- wire format and the onboarding service's UUID_RE detection branch both key
-- off chip keys looking like recipe ids. Keeping this table's ids the same
-- shape means only the RESOLUTION TARGET changes (suggestion store first,
-- recipes fallback second) — the wire format and detection are untouched.
--
-- No `kitchen_map_version` bump trigger: the KitchenMap projection does not
-- read this table (chips are a preference-elicitation surface, not part of
-- the authoritative food-identity projection). See the standing rule that any
-- table feeding KitchenMapRepository.loadRaw() needs one — this one doesn't
-- feed it.
--
-- Blocked/filtered suggestions are NOT persisted here (see 16-s1's
-- allergen-filter task) — only survivors land in this table.
--
-- Rollback:
--   DROP TABLE onboarding_chip_suggestions;

CREATE TABLE onboarding_chip_suggestions (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id    uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  label           text        NOT NULL,
  cuisine_tags    text[]      NOT NULL DEFAULT '{}',
  dietary_flags   text[]      NOT NULL DEFAULT '{}',
  allergen_flags  text[]      NOT NULL DEFAULT '{}',
  primary_starch  text,
  primary_protein text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX onboarding_chip_suggestions_household_id_idx
  ON onboarding_chip_suggestions (household_id);

-- API-only surface via the service-role client, same baseline-only posture as
-- cultural_priors (20260515000300_cultural_priors_rls.sql) — no explicit
-- policies, RLS just blocks anon/authed direct-SDK access.
ALTER TABLE onboarding_chip_suggestions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE onboarding_chip_suggestions IS
  'Generated M5 chip suggestions for a household, survivors of the deterministic allergen filter. Read for the M5 chip payload; looked up by id when a chip is tapped, because favorite_lunch.add takes a label, not an id.';
