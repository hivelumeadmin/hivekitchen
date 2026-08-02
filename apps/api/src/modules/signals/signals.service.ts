import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RecordSignalInputSchema } from '@hivekitchen/contracts';
import type { RecordSignalInput } from '@hivekitchen/types';
import { encryptField } from '../../lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../../lib/household-key.js';
import { SignalsRepository } from './signals.repository.js';

interface SignalsLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

// Story 15-s2 — the single write boundary for the signals log (canonical model
// v2 §4.9). Every producing seam calls record() and nothing else.
//
// Three properties live here, deliberately together:
//   1. Runtime Zod validation of the discriminated payload BEFORE insert. This
//      is stricter than the compile-time-only typing of brief_state.payload /
//      thread_turns.body — spec §7.4c mandates runtime validation for signal
//      payloads, so a malformed payload can never reach the append-only log.
//   2. Free-text fields (lunch_request.text, preference_edit.item) are
//      encrypted under the household DEK before insert (spec §7.1). Callers
//      pass PLAINTEXT; ciphertext is what lands at rest. preference_edit.item
//      mirrors food_preferences.item, which is already encrypted — a plaintext
//      copy here would weaken that guarantee.
//   3. record() NEVER throws. Signals are a secondary write on every seam; the
//      fire-and-forget convention (lunch-link.routes.ts:211-232) means a
//      signals failure must never break a rating, request, or preference edit.
export class SignalsService {
  private readonly repository: SignalsRepository;

  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
    private readonly logger: SignalsLogger,
  ) {
    this.repository = new SignalsRepository(client);
  }

  async record(input: RecordSignalInput): Promise<void> {
    // Null-safe on `input` itself: this line runs before the try, and the
    // catch below dereferences input too — a malformed call from a future JS
    // caller must not break the never-throws contract (15-s2 review patch).
    const kind =
      (input as { payload?: { kind?: string } } | null | undefined)?.payload?.kind ?? 'unknown';
    try {
      const parsed = RecordSignalInputSchema.parse(input);

      let payload: Record<string, unknown> = { ...parsed.payload };
      if (parsed.payload.kind === 'lunch_request') {
        const dek = await getOrCreateHouseholdDek(this.client, this.kek, parsed.household_id);
        payload = { ...parsed.payload, text: encryptField(parsed.payload.text, dek) };
      } else if (parsed.payload.kind === 'preference_edit') {
        const dek = await getOrCreateHouseholdDek(this.client, this.kek, parsed.household_id);
        payload = { ...parsed.payload, item: encryptField(parsed.payload.item, dek) };
      }

      await this.repository.insert({
        householdId: parsed.household_id,
        childId: parsed.child_id,
        kind: parsed.payload.kind,
        subjectRef: parsed.subject_ref,
        payload,
        occurredAt: parsed.occurred_at,
        source: parsed.source,
      });
    } catch (err) {
      // Never the payload — it can carry free text (PII).
      this.logger.warn(
        {
          err,
          household_id: (input as { household_id?: string } | null | undefined)?.household_id,
          kind,
        },
        'signals write failed — primary path unaffected (append-only log misses this event)',
      );
    }
  }
}
