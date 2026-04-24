import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { AUDIT_EVENT_TYPES } from './audit.types.js';

describe('audit.types — Postgres enum parity', () => {
  it('AUDIT_EVENT_TYPES matches the audit_event_type Postgres enum in migration 20260501110000', () => {
    const migrationPath = fileURLToPath(
      new URL(
        '../../../../supabase/migrations/20260501110000_create_audit_event_type_enum.sql',
        import.meta.url,
      ),
    );
    const sql = readFileSync(migrationPath, 'utf8');

    const match = sql.match(/CREATE TYPE audit_event_type AS ENUM \(([\s\S]*?)\);/);
    expect(match, 'Migration must contain CREATE TYPE audit_event_type AS ENUM').toBeTruthy();

    const sqlValues = [...match![1]!.matchAll(/'([^']+)'/g)]
      .map(([, value]) => value)
      .sort();

    const tsValues = [...AUDIT_EVENT_TYPES].sort();

    expect(tsValues).toEqual(sqlValues);
  });
});
