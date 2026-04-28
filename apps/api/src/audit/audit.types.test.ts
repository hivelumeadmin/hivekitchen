import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { AUDIT_EVENT_TYPES } from './audit.types.js';

describe('audit.types — Postgres enum parity', () => {
  it('AUDIT_EVENT_TYPES matches the audit_event_type Postgres enum across all migrations', () => {
    const migrationsDir = fileURLToPath(
      new URL('../../../../supabase/migrations/', import.meta.url),
    );
    const files = readdirSync(migrationsDir).sort();

    const sqlValues = new Set<string>();
    for (const file of files) {
      const raw = readFileSync(`${migrationsDir}${file}`, 'utf8');
      // Strip line comments so placeholders like '<value>' in headers don't leak in.
      const sql = raw.replace(/--[^\n]*/g, '');

      const createMatch = sql.match(/CREATE TYPE audit_event_type AS ENUM \(([\s\S]*?)\);/);
      if (createMatch) {
        for (const [, value] of createMatch[1]!.matchAll(/'([^']+)'/g)) {
          sqlValues.add(value!);
        }
      }
      for (const [, value] of sql.matchAll(
        /ALTER TYPE audit_event_type ADD VALUE(?: IF NOT EXISTS)? '([^']+)'/g,
      )) {
        sqlValues.add(value!);
      }
    }

    expect(sqlValues.size, 'No audit_event_type values found in migrations').toBeGreaterThan(0);

    const tsValues = [...AUDIT_EVENT_TYPES].sort();
    const sqlSorted = [...sqlValues].sort();
    expect(tsValues).toEqual(sqlSorted);
  });
});
