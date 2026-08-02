import { z } from 'zod';
import { EnforcementLevelSchema } from './enforcement.js';

// Story 15-s2 (Epic 15, Canonical Data Model v2 §4.9) — the signals log.
// Mirrors supabase/migrations/20261035000200_create_signals.sql and
// apps/api/src/modules/signals/signals.repository.ts.
//
// Signals are append-only learning inputs: a correction is a NEW signal, never
// an update. The payload is jsonb typed per kind and runtime-Zod-validated at
// the write boundary (spec §7.4c — deliberately stricter than the compile-time-
// only typing of brief_state.payload / thread_turns.body).
//
// Free-text payload fields (`lunch_request.text`, `preference_edit.item`) are
// AES-256-GCM ciphertext AT REST under the household DEK (spec §7.1) — the
// schemas below describe the stored row; SignalsService encrypts before insert.

export const SignalKindSchema = z.enum([
  'lunch_rating',
  'lunch_request',
  // Reserved: no producer exists yet (leftover capture is deferred to Epic 6).
  'leftover_log',
  'extra_removal',
  'preference_edit',
]);

export const SignalSourceSchema = z.enum(['lunch_link', 'app', 'voice', 'import']);

// ── Per-kind payloads (discriminated on `kind`, TurnBody precedent thread.ts:73) ──
// Members are .strict() so an unknown key is rejected at the write boundary.

// Values mirror RateLunchLinkBodySchema (lunch-link.ts:111) — no standalone
// rating schema is exported there to reuse.
export const LunchRatingSignalPayloadSchema = z
  .object({
    kind: z.literal('lunch_rating'),
    rating: z.enum(['loved', 'ok', 'not-really']),
    date: z.string().date(),
  })
  .strict();

export const LunchRequestSignalPayloadSchema = z
  .object({
    kind: z.literal('lunch_request'),
    // Ciphertext at rest (envelope encryption under the household DEK).
    text: z.string().min(1),
  })
  .strict();

export const ExtraRemovalSignalPayloadSchema = z
  .object({
    kind: z.literal('extra_removal'),
    component_type: z.string().min(1).max(100),
  })
  .strict();

export const PreferenceEditSignalPayloadSchema = z
  .object({
    kind: z.literal('preference_edit'),
    // Ciphertext at rest — food_preferences.item is encrypted; a plaintext copy
    // here would silently weaken the existing at-rest guarantee.
    item: z.string().min(1),
    valence: z.enum(['loves', 'likes', 'neutral', 'dislikes', 'refuses']),
    // Closed enum, not a loose string — a typo'd level would append permanently
    // into the immutable log (15-s2 review patch). All three producers already
    // pass EnforcementLevelSchema-validated values.
    enforcement: EnforcementLevelSchema,
    scope: z.enum(['child', 'household']),
  })
  .strict();

// leftover_log has NO payload member: the union below is the PRODUCING set, so
// a leftover_log write fails validation until Epic 6 defines its shape.
export const SignalPayloadSchema = z.discriminatedUnion('kind', [
  LunchRatingSignalPayloadSchema,
  LunchRequestSignalPayloadSchema,
  ExtraRemovalSignalPayloadSchema,
  PreferenceEditSignalPayloadSchema,
]);

// ── Row + write-boundary input ──
//
// subject_ref is what the signal is ABOUT (payload is what was said), typed by
// convention per kind — producers construct these literals directly:
//   lunch_rating   → { recipe_id: uuid, slot_kind: string }
//   lunch_request  → { request_id: uuid, session_id: uuid }
//   extra_removal  → { plan_item_id: uuid | null }
//   preference_edit → null
// Kept as a loose record here; per-kind subject_ref schemas arrive with the
// first READER (the 15-s3 projection), which is when validation buys something.

export const SignalRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid().nullable(),
  kind: SignalKindSchema,
  subject_ref: z.record(z.string(), z.unknown()).nullable(),
  payload: SignalPayloadSchema,
  occurred_at: z.string().datetime({ offset: true }),
  source: SignalSourceSchema,
  created_at: z.string().datetime({ offset: true }),
});

// What a producing seam hands to SignalsService.record(). Free-text fields are
// PLAINTEXT here — the service encrypts them before insert; `kind` is carried
// by the payload discriminant.
export const RecordSignalInputSchema = z.object({
  household_id: z.string().uuid(),
  child_id: z.string().uuid().nullable(),
  subject_ref: z.record(z.string(), z.unknown()).nullable(),
  payload: SignalPayloadSchema,
  occurred_at: z.string().datetime({ offset: true }),
  source: SignalSourceSchema,
});

export type SignalKind = z.infer<typeof SignalKindSchema>;
export type SignalSource = z.infer<typeof SignalSourceSchema>;
export type SignalPayload = z.infer<typeof SignalPayloadSchema>;
export type LunchRatingSignalPayload = z.infer<typeof LunchRatingSignalPayloadSchema>;
export type LunchRequestSignalPayload = z.infer<typeof LunchRequestSignalPayloadSchema>;
export type ExtraRemovalSignalPayload = z.infer<typeof ExtraRemovalSignalPayloadSchema>;
export type PreferenceEditSignalPayload = z.infer<typeof PreferenceEditSignalPayloadSchema>;
export type SignalRow = z.infer<typeof SignalRowSchema>;
export type RecordSignalInput = z.infer<typeof RecordSignalInputSchema>;
