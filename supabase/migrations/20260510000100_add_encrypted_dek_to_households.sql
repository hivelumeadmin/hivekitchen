-- Story 2.10: per-household envelope encryption key (DEK wrapped by master KEK).
-- Null until first child is added. Managed by ChildrenRepository.getOrCreateHouseholdDek().
ALTER TABLE households ADD COLUMN IF NOT EXISTS encrypted_dek text;
