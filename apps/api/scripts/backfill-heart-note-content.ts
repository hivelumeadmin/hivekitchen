#!/usr/bin/env tsx
/**
 * Slice 4-S5 — one-shot backfill to re-encrypt any plaintext heart_notes.content
 * rows that were written by the 4-S1 implementation (pre-encryption).
 *
 * Idempotent — re-running is safe: rows already in NOOP:<base64> format or
 * AES-GCM ciphertext form are skipped. Only plaintext rows (or empty strings
 * not yet round-tripped through encryptField) are re-encrypted.
 *
 * Detection heuristic (per row.content):
 *   1. starts with 'NOOP:'                    → already NOOP-encoded, skip
 *   2. /^[A-Za-z0-9+/=]{40,}$/ && no spaces   → likely AES-encrypted, skip
 *   3. otherwise                              → plaintext, re-encrypt
 *
 * AES-GCM with a 12-byte nonce + 16-byte tag is 28 bytes minimum, which
 * base64-encodes to 40 characters. Real heart note plaintext (English
 * sentences with spaces / punctuation) won't pass the base64-only test.
 *
 * Run BEFORE deploying the 4-S5 API code (see migration runbook in
 * 20261002000000_heart_note_content_encryption_marker.sql).
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api backfill:heart-notes
 *
 * Environment:
 *   SUPABASE_URL                       — required
 *   SUPABASE_SERVICE_ROLE_KEY          — required
 *   ENVELOPE_ENCRYPTION_MASTER_KEY     — optional (NOOP cipher used when absent)
 */
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { encryptField } from '../src/lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../src/lib/household-key.js';

// Script-specific env schema — mirrors the Zod validation pattern in
// apps/api/src/common/env.ts but validates only the three vars this script
// needs. The full parseEnv() requires all API secrets (OPENAI_API_KEY,
// ELEVENLABS_API_KEY, etc.) that a standalone backfill environment does not have.
const BackfillEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ENVELOPE_ENCRYPTION_MASTER_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex string').optional(),
  ),
});

export interface BackfillSummary {
  rows_scanned: number;
  rows_skipped: number;
  rows_encrypted: number;
  errors: number;
}

export interface BackfillDeps {
  client: SupabaseClient;
  kek: Buffer | null;
  pageSize?: number;
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

interface HeartNoteIdContentRow {
  id: string;
  household_id: string;
  content: string;
}

// Regex used to detect AES-GCM ciphertext that's already been base64-encoded.
// Spaces are forbidden — real plaintext heart notes contain spaces.
const BASE64_ONLY = /^[A-Za-z0-9+/=]{40,}$/;

export function isAlreadyEncrypted(content: string): boolean {
  if (content.startsWith('NOOP:')) return true;
  if (content.includes(' ')) return false;
  return BASE64_ONLY.test(content);
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const pageSize = deps.pageSize ?? 100;
  const logger = deps.logger ?? {
    // eslint-disable-next-line no-console
    error: (obj, msg) => console.error('[backfill]', msg, obj),
  };
  const summary: BackfillSummary = {
    rows_scanned: 0,
    rows_skipped: 0,
    rows_encrypted: 0,
    errors: 0,
  };

  // Keyset pagination by id so concurrent inserts don't shift the offset.
  let lastId: string | null = null;

  for (;;) {
    let query = deps.client
      .from('heart_notes')
      .select('id, household_id, content')
      .order('id', { ascending: true })
      .limit(pageSize);
    if (lastId !== null) query = query.gt('id', lastId);

    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as HeartNoteIdContentRow[];
    if (page.length === 0) break;

    for (const row of page) {
      summary.rows_scanned += 1;
      try {
        if (isAlreadyEncrypted(row.content)) {
          summary.rows_skipped += 1;
          continue;
        }
        const dek = await getOrCreateHouseholdDek(deps.client, deps.kek, row.household_id);
        const ciphertext = encryptField(row.content, dek);
        const { error: updateError } = await deps.client
          .from('heart_notes')
          .update({ content: ciphertext })
          .eq('id', row.id);
        if (updateError) throw updateError;
        summary.rows_encrypted += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error({ row_id: row.id, household_id: row.household_id, err }, 'row encrypt failed');
      }
    }

    lastId = page[page.length - 1]?.id ?? null;
    if (page.length < pageSize) break;
  }

  return summary;
}

async function main(): Promise<void> {
  const envResult = BackfillEnvSchema.safeParse(process.env);
  if (!envResult.success) {
    const issues = envResult.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Env validation failed — ${issues}`);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENVELOPE_ENCRYPTION_MASTER_KEY } = envResult.data;

  const kek = ENVELOPE_ENCRYPTION_MASTER_KEY
    ? Buffer.from(ENVELOPE_ENCRYPTION_MASTER_KEY, 'hex')
    : null;
  if (kek === null) {
    // eslint-disable-next-line no-console
    console.warn(
      'ENVELOPE_ENCRYPTION_MASTER_KEY is unset — backfill will use the NOOP cipher (dev path).',
    );
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = await runBackfill({ client, kek });

  // eslint-disable-next-line no-console
  console.log('[backfill:heart-notes] summary:', summary);
  if (summary.errors > 0) process.exit(2);
}

const entryUrl = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === entryUrl) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[backfill:heart-notes] fatal', err);
    process.exit(1);
  });
}
