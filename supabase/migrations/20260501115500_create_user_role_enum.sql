-- Rollback: DROP TYPE user_role;
-- Note: Adding values requires ALTER TYPE user_role ADD VALUE '<value>';
-- TypeScript mirror lives at apps/api/src/modules/auth/auth.types.ts (Story 2.1).

CREATE TYPE user_role AS ENUM (
  'primary_parent',
  'secondary_caregiver',
  'guest_author',
  'ops'
);
