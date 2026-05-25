-- Slice 2.6-s7 — drop the now-redundant `allergy_rules` table.
--
-- Preconditions (verify before applying):
--   1. apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts
--      reads FALCPA seeds from allergen_tags WHERE rule_class='falcpa', not allergy_rules.
--   2. No other production code references allergy_rules (grep confirmed 2026-05-24).
--   3. The only remaining rows are the 9 FALCPA seeds (household_id IS NULL).
--      Verify: SELECT COUNT(*) FROM allergy_rules WHERE household_id IS NOT NULL;
--              -> must return 0 (2-s27 migrated parent-declared rows to households/children).
--
-- Rollback: the table is recreatable from 20260610000000_create_allergy_guardrail_tables.sql;
--   the 9 FALCPA rows are re-insertable from the same migration file. After recreation,
--   revert allergy-guardrail.repository.ts to read from allergy_rules. No data loss occurs
--   because the FALCPA reference set is static and reconstructable.
--
-- RLS policies are dropped automatically on table drop.

DROP TABLE IF EXISTS allergy_rules;
