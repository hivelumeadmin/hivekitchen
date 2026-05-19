-- Story 3-31: add recipe.agent_fetch + recipe.candidate.cache_miss to
-- the audit_event_type Postgres enum so the TypeScript union stays in sync.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'recipe.agent_fetch';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'recipe.candidate.cache_miss';
