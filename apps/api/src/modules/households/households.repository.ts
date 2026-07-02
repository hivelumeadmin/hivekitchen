import { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HouseholdGeolocationConsentSchema } from '@hivekitchen/contracts';
import type { HouseholdGeolocationConsent } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
import { DataIntegrityError, NotFoundError, ValidationError } from '../../common/errors.js';
import { HouseholdAllergensRepository } from './household-allergens.repository.js';
import { HouseholdCulturalIdentifiersRepository } from './household-cultural-identifiers.repository.js';

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
  // Story 3-S35 — auto_compose_enabled is selected so the cron can skip
  // households that have toggled weekly auto-compose off.
  async findAllActive(
    offset = 0,
    limit = 500,
  ): Promise<Array<{ id: string; timezone: string; auto_compose_enabled: boolean }>> {
    const { data, error } = await this.client
      .from('households')
      .select('id, timezone, auto_compose_enabled')
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []) as Array<{
      id: string;
      timezone: string;
      auto_compose_enabled: boolean;
    }>;
  }

  // Story 3-S35 — weekly auto-compose enrollment toggle. NOT NULL DEFAULT true
  // at the column level; the null branch here only covers a missing row.
  async getAutoComposeEnabled(householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('households')
      .select('auto_compose_enabled')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { auto_compose_enabled: boolean } | null;
    if (row === null) throw new NotFoundError(`household not found: ${householdId}`);
    return row.auto_compose_enabled;
  }

  async setAutoComposeEnabled(householdId: string, enabled: boolean): Promise<void> {
    const { data, error } = await this.client
      .from('households')
      .update({ auto_compose_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) throw new NotFoundError(`household not found: ${householdId}`);
  }

  // Story 3-S34 — single-household IANA timezone for the on-demand composition
  // window. Throws if the household row is missing (deriveCompositionWindow
  // cannot pick the right week without a real timezone). Does not touch
  // encrypted columns, so kek is not required.
  async getTimezone(householdId: string): Promise<string> {
    const { data, error } = await this.client
      .from('households')
      .select('timezone')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new NotFoundError(`household not found: ${householdId}`);
    }
    const tz = (data as { timezone: string | null }).timezone;
    if (!tz) {
      throw new DataIntegrityError(`household ${householdId} has no timezone configured`);
    }
    return tz;
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

  // ---- Story 3-DM-B2 — household-level food identity reads/writes --------
  //
  // The legacy 2-s27 encrypted columns (households.cultural_identifiers,
  // .dietary_preferences, .declared_allergens) are dropped. Reads and writes
  // route through the structured tables:
  //   - household_cultural_identifiers   (closed-vocab, no encryption)
  //   - dietary_preferences (child_id=NULL = household-scoped, closed-vocab)
  //   - household_allergens (child_id=NULL = household-wide, encrypted)
  // The household DEK is still derived here for the household_allergens path
  // (allergen plaintext is encrypted under it).

  async getProfile(householdId: string): Promise<{
    cultural_identifiers: string[];
    dietary_preferences: string[];
    declared_allergens: string[];
  }> {
    // Existence check — preserves the prior NotFoundError contract for
    // callers that distinguish "no row" from "no profile data."
    const exists = await this.client
      .from('households')
      .select('id')
      .eq('id', householdId)
      .maybeSingle();
    if (exists.error) throw exists.error;
    if (exists.data === null) {
      throw new NotFoundError(`household not found: ${householdId}`);
    }

    const allergensRepo = new HouseholdAllergensRepository(this.client, this.kek);
    const culturalRepo = new HouseholdCulturalIdentifiersRepository(this.client);

    const [allergenRows, culturalTags, dietaryRows] = await Promise.all([
      allergensRepo.findByHouseholdId(householdId),
      culturalRepo.listTags(householdId),
      this.fetchHouseholdDietaryTags(householdId),
    ]);

    return {
      cultural_identifiers: culturalTags,
      dietary_preferences: dietaryRows,
      // Household-wide only — per-child rows live on this same table but are
      // not part of the household-profile payload (consumers read those via
      // ChildrenRepository.findById which overlays per-child allergen rows).
      declared_allergens: allergenRows
        .filter((r) => r.child_id === null)
        .map((r) => r.allergen),
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

    const allergensRepo = new HouseholdAllergensRepository(this.client, this.kek);
    const culturalRepo = new HouseholdCulturalIdentifiersRepository(this.client);

    if (patch.cultural_identifiers !== undefined) {
      // Replace semantics: delete existing tags, insert the new set.
      await culturalRepo.replaceSet({
        household_id: householdId,
        tags: patch.cultural_identifiers,
        source: 'parent_edited',
      });
    }
    if (patch.dietary_preferences !== undefined) {
      // Replace semantics: delete household-wide dietary rows, insert the new set.
      const { error: delErr } = await this.client
        .from('dietary_preferences')
        .delete()
        .eq('household_id', householdId)
        .is('child_id', null);
      if (delErr) throw delErr;
      await this.upsertHouseholdDietaryTags(householdId, patch.dietary_preferences);
    }
    if (patch.declared_allergens !== undefined) {
      // Insert-first replace: upsert the new set first, then prune stale rows.
      // This prevents a transient window where household-wide allergens are
      // absent between a delete and re-insert — which could produce
      // verdict='clear' on a concurrent guardrail read.
      for (const allergen of patch.declared_allergens) {
        await allergensRepo.declareIfNew({
          household_id: householdId,
          child_id: null,
          allergen,
          source: 'parent_edited',
        });
      }
      const newHashes = patch.declared_allergens.map((a) => normalizedHash(a));
      const pruneQuery = this.client
        .from('household_allergens')
        .delete()
        .eq('household_id', householdId)
        .is('child_id', null);
      const { error: pruneError } = await (
        newHashes.length > 0
          ? pruneQuery.not('allergen_hash', 'in', `(${newHashes.join(',')})`)
          : pruneQuery
      );
      if (pruneError) throw pruneError;
    }

    return this.getProfile(householdId);
  }

  private async fetchHouseholdDietaryTags(householdId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('dietary_preferences')
      .select('tag')
      .eq('household_id', householdId)
      .is('child_id', null);
    if (error) throw error;
    return ((data ?? []) as Array<{ tag: string }>).map((r) => r.tag);
  }

  private async upsertHouseholdDietaryTags(
    householdId: string,
    tags: readonly string[],
  ): Promise<void> {
    if (tags.length === 0) return;
    const rows = tags.map((tag) => ({
      household_id: householdId,
      child_id: null,
      tag,
      source: 'parent_edited' as const,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await this.client
      .from('dietary_preferences')
      .upsert(rows, {
        onConflict: 'household_id,tag',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  // Story 3.29 — household sovereignty-mode for cultural-rule reconciliation.
  // Defaults are enforced at the column level (NOT NULL DEFAULT 'unified'); the
  // null branch here only covers a missing row, surfaced via NotFoundError.
  async getSovereigntyMode(householdId: string): Promise<'unified' | 'alternating'> {
    const { data, error } = await this.client
      .from('households')
      .select('sovereignty_mode')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { sovereignty_mode: 'unified' | 'alternating' } | null;
    if (row === null) throw new NotFoundError(`household not found: ${householdId}`);
    return row.sovereignty_mode;
  }

  async setSovereigntyMode(
    householdId: string,
    mode: 'unified' | 'alternating',
  ): Promise<void> {
    const { data, error } = await this.client
      .from('households')
      .update({
        sovereignty_mode: mode,
        sovereignty_mode_updated_at: new Date().toISOString(),
      })
      .eq('id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) throw new NotFoundError(`household not found: ${householdId}`);
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

  // 7-S11: look up display_name for deletion confirmation match.
  async getDisplayName(
    householdId: string,
  ): Promise<{ display_name: string | null; deletion_requested_at: string | null } | null> {
    const { data, error } = await this.client
      .from('households')
      .select('display_name, deletion_requested_at')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    return data as {
      display_name: string | null;
      deletion_requested_at: string | null;
    } | null;
  }

  // 7-S11: soft-delete — sets deletion_requested_at.
  async requestDeletion(householdId: string, now: string): Promise<void> {
    const { error } = await this.client
      .from('households')
      .update({ deletion_requested_at: now })
      .eq('id', householdId);
    if (error) throw error;
  }

  // Slice 5-S14 — household-level geolocation consent. Consent-only: no
  // coordinates are ever stored. geolocation_consented_at is preserved on
  // opt-out (historical record); only the service-built update payload decides
  // which columns are written.
  async getGeolocationConsent(householdId: string): Promise<HouseholdGeolocationConsent | null> {
    const { data, error } = await this.client
      .from('households')
      .select('geolocation_enabled, geolocation_consented_at, geolocation_purpose')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    return data ? HouseholdGeolocationConsentSchema.parse(data) : null;
  }

  async updateGeolocationConsent(
    householdId: string,
    input: {
      geolocation_enabled: boolean;
      geolocation_purpose: 'cultural_supplier_routing' | null;
      geolocation_consented_at?: string; // only present when enabling
    },
  ): Promise<HouseholdGeolocationConsent> {
    const { data, error } = await this.client
      .from('households')
      .update(input)
      .eq('id', householdId)
      .select('geolocation_enabled, geolocation_consented_at, geolocation_purpose')
      .single();
    if (error) throw error;
    return HouseholdGeolocationConsentSchema.parse(data);
  }

  // 7-S11: job sweep — find households past the 30-day threshold.
  async findPendingHardDeletes(
    cutoffIso: string,
  ): Promise<Array<{ id: string; deletion_requested_at: string }>> {
    const { data, error } = await this.client
      .from('households')
      .select('id, deletion_requested_at')
      .not('deletion_requested_at', 'is', null)
      .lt('deletion_requested_at', cutoffIso);
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; deletion_requested_at: string }>;
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
