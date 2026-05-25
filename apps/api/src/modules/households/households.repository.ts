import { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
import { HouseholdDecryptError, NotFoundError } from '../../common/errors.js';

// Story 2.10 lazy-migration shape: pre-2.10 rows held jsonb that was cast to
// text by `ALTER COLUMN ... TYPE text USING caregiver_relationships::text`.
// Those rows look like raw JSON (e.g. `{"primary":"alice"}`) — no NOOP: prefix
// and not valid AES-GCM base64. Read MUST tolerate that shape until the next
// write re-encrypts the row. New writes always go through encryptField.

export class HouseholdsRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {
    super(client);
  }

  // TODO (Story 5.5): replace `unknown` with a Zod-validated type once the caregiver
  // relationship shape is finalised and this repository is wired into the application.
  async getCaregiverRelationships(householdId: string): Promise<unknown> {
    const { data, error } = await this.client
      .from('households')
      .select('caregiver_relationships')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const stored = (data as { caregiver_relationships: string | null } | null)
      ?.caregiver_relationships ?? null;
    if (stored === null) return null;
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return decryptCaregiverRelationships(stored, dek);
  }

  async setCaregiverRelationships(householdId: string, value: unknown): Promise<void> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(value, dek);
    const { error } = await this.client
      .from('households')
      .update({ caregiver_relationships: ciphertext, updated_at: new Date().toISOString() })
      .eq('id', householdId);
    if (error) throw error;
  }

  // Story 2.14 — anxiety-leakage flag. Server-written only; the Plan Tile
  // component (Epic 3) reads this to decide whether to render a "saved just
  // now" pip after edits during the first 14 days.
  async getTileGhostFlag(householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('households')
      .select('tile_ghost_timestamp_enabled')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { tile_ghost_timestamp_enabled: boolean } | null)
      ?.tile_ghost_timestamp_enabled ?? false;
  }

  async setTileGhostFlag(householdId: string): Promise<void> {
    const { data, error } = await this.client
      .from('households')
      .update({
        tile_ghost_timestamp_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new Error(`household not found: ${householdId}`);
    }
  }

  // Returns a page of household ids + timezones for the plan-generation fan-out.
  // Service-role client bypasses RLS — this is a background system query, not
  // a user-scoped read. Callers must loop with increasing offset until the
  // returned slice is shorter than limit (signals last page).
  async findAllActive(
    offset = 0,
    limit = 500,
  ): Promise<Array<{ id: string; timezone: string }>> {
    const { data, error } = await this.client
      .from('households')
      .select('id, timezone')
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; timezone: string }>;
  }

  // Returns household age in milliseconds (now - created_at). Used by the
  // tile-retry route to gate the ghost-timestamp escalation to week 1–2.
  // Throws if the household row is missing — no silent zero fallback that
  // could mis-classify an unknown household as fresh.
  async getHouseholdAge(householdId: string): Promise<number> {
    const { data, error } = await this.client
      .from('households')
      .select('created_at')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { created_at: string } | null;
    if (row === null) {
      throw new Error(`household not found: ${householdId}`);
    }
    return Date.now() - new Date(row.created_at).getTime();
  }

  // Slice 2.6-s2 — Stage 0 catalog materialization idempotency gate.
  // NULL = initial materialization has not yet run for this household; a
  // non-null timestamp means CuratedBaselineMaterializationService.materialize
  // has already populated the catalog and another call must be a no-op.
  async getStage0MaterializedAt(householdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('households')
      .select('stage0_materialized_at')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { stage0_materialized_at: string | null } | null;
    if (row === null) return null;
    return row.stage0_materialized_at;
  }

  async setStage0MaterializedAt(householdId: string): Promise<void> {
    const { error } = await this.client
      .from('households')
      .update({ stage0_materialized_at: new Date().toISOString() })
      .eq('id', householdId);
    if (error) throw error;
  }

  // Slice 2.6-s3 — Stage 1 catalog seeding completion gate. NULL = Stage 1
  // has not yet completed (or the failure path took the silent NULL branch).
  // 2.6-s4 polls this column to decide whether to show the personalized M5
  // chip card or route to the cold-start fallback.
  async getStage1CompletedAt(householdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('households')
      .select('stage1_completed_at')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { stage1_completed_at: string | null } | null;
    if (row === null) return null;
    return row.stage1_completed_at;
  }

  async setStage1CompletedAt(householdId: string): Promise<void> {
    const { error } = await this.client
      .from('households')
      .update({ stage1_completed_at: new Date().toISOString() })
      .eq('id', householdId);
    if (error) throw error;
  }

  // ---- Slice 2-s27 — household-level food identity ------------------------
  //
  // Three encrypted columns added by migration 20260902000000:
  // cultural_identifiers / dietary_preferences / declared_allergens. Each
  // stores an AES-GCM ciphertext (or NOOP:base64(JSON) in NODE_ENV=dev) of a
  // JSON string[]; NULL means "no household-level value set yet" and reads
  // back as []. The household DEK is the same one that protects children
  // and caregiver_relationships, derived via getHouseholdDek / getOrCreateHouseholdDek.

  async getProfile(householdId: string): Promise<{
    cultural_identifiers: string[];
    dietary_preferences: string[];
    declared_allergens: string[];
  }> {
    const { data, error } = await this.client
      .from('households')
      .select('cultural_identifiers, dietary_preferences, declared_allergens')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as
      | {
          cultural_identifiers: string | null;
          dietary_preferences: string | null;
          declared_allergens: string | null;
        }
      | null;
    if (row === null) {
      throw new NotFoundError(`household not found: ${householdId}`);
    }

    // Decrypt only if anything is set — avoids an unnecessary DEK fetch on
    // brand-new households (and gracefully handles dev environments with no
    // KEK configured).
    if (
      row.cultural_identifiers === null &&
      row.dietary_preferences === null &&
      row.declared_allergens === null
    ) {
      return {
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      };
    }

    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return {
      cultural_identifiers: decryptArrayColumn(row.cultural_identifiers, dek),
      dietary_preferences: decryptArrayColumn(row.dietary_preferences, dek),
      declared_allergens: decryptArrayColumn(row.declared_allergens, dek),
    };
  }

  async patchProfile(
    householdId: string,
    patch: {
      cultural_identifiers?: string[];
      dietary_preferences?: string[];
      declared_allergens?: string[];
    },
  ): Promise<{
    cultural_identifiers: string[];
    dietary_preferences: string[];
    declared_allergens: string[];
  }> {
    const hasAnyField =
      patch.cultural_identifiers !== undefined ||
      patch.dietary_preferences !== undefined ||
      patch.declared_allergens !== undefined;

    if (!hasAnyField) {
      return this.getProfile(householdId);
    }

    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const update: Record<string, string> = {};
    if (patch.cultural_identifiers !== undefined) {
      update.cultural_identifiers = encryptField(patch.cultural_identifiers, dek);
    }
    if (patch.dietary_preferences !== undefined) {
      update.dietary_preferences = encryptField(patch.dietary_preferences, dek);
    }
    if (patch.declared_allergens !== undefined) {
      update.declared_allergens = encryptField(patch.declared_allergens, dek);
    }
    // Use .update().select() to return the post-write row in a single
    // round-trip, eliminating the torn-read window between the write and
    // the follow-on getProfile() call.
    const { data, error } = await this.client
      .from('households')
      .update(update)
      .eq('id', householdId)
      .select('cultural_identifiers, dietary_preferences, declared_allergens')
      .maybeSingle();
    if (error) throw error;
    if (data === null) throw new NotFoundError(`household not found: ${householdId}`);

    const row = data as {
      cultural_identifiers: string | null;
      dietary_preferences: string | null;
      declared_allergens: string | null;
    };
    return {
      cultural_identifiers: decryptArrayColumn(row.cultural_identifiers, dek),
      dietary_preferences: decryptArrayColumn(row.dietary_preferences, dek),
      declared_allergens: decryptArrayColumn(row.declared_allergens, dek),
    };
  }

  async bumpKitchenMapVersion(householdId: string): Promise<void> {
    const { error } = await this.client.rpc('bump_kitchen_map_version_for_household', {
      p_household_id: householdId,
    });
    if (error) throw error;
  }

  // Slice 2.5-s5 — parent-chosen household label captured in Moment 1.
  // Intentionally NOT encrypted: low PII risk (self-chosen label like
  // "The Menons"), and storing in plaintext lets the kitchen-map composer
  // and agent prompt read it without a DEK round-trip on every turn.
  async setDisplayName(householdId: string, displayName: string): Promise<void> {
    const { data, error } = await this.client
      .from('households')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new Error(`household not found: ${householdId}`);
    }
    await this.bumpKitchenMapVersion(householdId);
  }

  // Advisory lock helpers — bracket addAllergens read-modify-write to prevent
  // concurrent turns from silently overwriting each other's allergen additions.
  // Session-level: caller MUST call releaseAllergenLock in a finally block.
  async acquireAllergenLock(householdId: string): Promise<void> {
    const { error } = await this.client.rpc('acquire_household_allergen_lock', {
      p_household_id: householdId,
    });
    if (error) throw error;
  }

  async releaseAllergenLock(householdId: string): Promise<void> {
    const { error } = await this.client.rpc('release_household_allergen_lock', {
      p_household_id: householdId,
    });
    if (error) throw error;
  }
}

function decryptArrayColumn(stored: string | null, dek: Buffer | null): string[] {
  if (stored === null) return [];
  try {
    return decryptField<string[]>(stored, dek);
  } catch {
    // Throw rather than returning [] — an empty allergen list is semantically
    // different from "data unreadable." Fail-closed keeps the safety invariant:
    // a corrupt or mis-keyed cell surfaces as a 500, not as "no allergens."
    throw new HouseholdDecryptError();
  }
}

export function decryptCaregiverRelationships(
  stored: string,
  dek: Buffer | null,
): unknown {
  // Empty string: guard against a partial write leaving '' in the text column.
  if (stored.length === 0) return null;
  // Legacy jsonb-cast-to-text rows: objects and arrays always start with { or [.
  // Parse directly — re-encrypted on next write via setCaregiverRelationships.
  if (stored.startsWith('{') || stored.startsWith('[')) {
    return JSON.parse(stored);
  }
  // NOOP:-prefixed (dev/test) or AES-GCM base64 (staging/production).
  // decryptField handles both branches internally.
  return decryptField<unknown>(stored, dek);
}
