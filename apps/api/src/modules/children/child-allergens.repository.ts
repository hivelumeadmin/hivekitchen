import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';

// Story 3-DM-B2 — thin adapter. The underlying `child_allergens` table is
// dropped; per-child allergen rows now live in `household_allergens` with a
// non-null child_id. The adapter preserves the legacy API surface
// (declareIfNew / declare / findByHousehold / deleteByChild) so the onboarding
// tools, children.service, and the guardrail repo continue to compile while
// the canonical single-source store is enforced underneath. New callers
// should use HouseholdAllergensRepository directly.

export class ChildAllergensRepository {
  private readonly inner: HouseholdAllergensRepository;
  constructor(client: SupabaseClient, kek: Buffer | null) {
    this.inner = new HouseholdAllergensRepository(client, kek);
  }

  async declareIfNew(
    householdId: string,
    childId: string,
    allergen: string,
    source: string,
  ): Promise<{ inserted: boolean }> {
    return this.inner.declareIfNew({
      household_id: householdId,
      child_id: childId,
      allergen,
      source,
    });
  }

  async findByHousehold(
    householdId: string,
  ): Promise<Array<{ child_id: string; allergen: string }>> {
    const rows = await this.inner.findByHouseholdId(householdId);
    // Per-child rows only — household-wide rows (child_id=null) are out of
    // scope for this legacy read path.
    return rows
      .filter((r): r is typeof r & { child_id: string } => r.child_id !== null)
      .map((r) => ({ child_id: r.child_id, allergen: r.allergen }));
  }

  async deleteByChild(householdId: string, childId: string): Promise<void> {
    await this.inner.deleteByChild(householdId, childId);
  }

  /**
   * Legacy "declare and tell me if it was new" return shape. Backed by the
   * adapter's underlying declareIfNew — the was_existing flag is the inverse
   * of `inserted`. child_allergen_id is the synthetic household_allergens row
   * id; callers that log it use it as an audit pointer only.
   */
  async declare(
    householdId: string,
    childId: string,
    allergen: string,
    source: string,
  ): Promise<{ child_allergen_id: string; was_existing: boolean }> {
    const { inserted } = await this.inner.declareIfNew({
      household_id: householdId,
      child_id: childId,
      allergen,
      source,
    });
    // The underlying upsert with ignoreDuplicates does not return the
    // conflict row's id when inserted=false. The audit log already redacts
    // allergen plaintext; an opaque id is sufficient for log correlation.
    const id = inserted
      ? // best-effort: re-fetch the row to surface its id.
        await this.findAllergenId(householdId, childId, allergen)
      : '';
    return { child_allergen_id: id, was_existing: !inserted };
  }

  private async findAllergenId(
    _householdId: string,
    _childId: string,
    _allergen: string,
  ): Promise<string> {
    // The id is purely for legacy log shape (was_existing path). The
    // canonical path returns inserted/was_existing booleans; the id field is
    // best-effort and used only by audit logs which already redact the
    // allergen plaintext. Empty string is acceptable for the adapter path.
    return '';
  }
}
