import type {
  AddChildBody,
  BagComposition,
  ChildResponse,
  SetBagCompositionBody,
} from '@hivekitchen/types';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import type { ChildrenRepository, DecryptedChildRow } from './children.repository.js';

export interface AddChildInput {
  householdId: string;
  body: AddChildBody;
}

export interface GetChildInput {
  householdId: string;
  childId: string;
}

export interface SetBagCompositionInput {
  householdId: string;
  childId: string;
  body: SetBagCompositionBody;
}

export interface SetBagCompositionResult {
  child: ChildResponse;
  audit: { old: BagComposition; new: BagComposition };
}

export class ChildrenService {
  constructor(private readonly repository: ChildrenRepository) {}

  async addChild(input: AddChildInput): Promise<ChildResponse> {
    const row = await this.repository.insert({
      household_id: input.householdId,
      name: input.body.name,
      age_band: input.body.age_band,
      school_policy_notes: input.body.school_policy_notes ?? null,
      declared_allergens: input.body.declared_allergens,
      cultural_identifiers: input.body.cultural_identifiers,
      dietary_preferences: input.body.dietary_preferences,
    });
    return toChildResponse(row);
  }

  /**
   * Slice C — idempotent child upsert keyed on case-insensitive name match
   * within the household. Used by the onboarding agent's child.upsert tool
   * so retries / re-mentions don't create duplicate rows.
   *
   * Returns { child, was_existing }. was_existing=true means an existing
   * row was UPDATEd; false means a new row was INSERTed.
   *
   * Bypasses the parental-notice acknowledgement check that
   * POST /v1/households/:id/children enforces — onboarding is the path
   * by which a household reaches consent, so writes are gated by audit
   * rather than by prior consent. The auditing service stamps
   * source='onboarding_agent' so post-hoc compliance review can
   * distinguish agent-initiated from parent-initiated child writes.
   */
  async upsertByName(input: AddChildInput): Promise<{
    child: ChildResponse;
    was_existing: boolean;
  }> {
    const existing = await this.repository.findByHouseholdId(input.householdId);
    const target = existing.find(
      (c) => c.name.trim().toLocaleLowerCase() === input.body.name.trim().toLocaleLowerCase(),
    );

    if (target !== undefined) {
      const row = await this.repository.updateProfile({
        id: target.id,
        household_id: input.householdId,
        name: input.body.name.trim(),
        age_band: input.body.age_band,
        school_policy_notes: input.body.school_policy_notes ?? null,
        declared_allergens: input.body.declared_allergens,
        cultural_identifiers: input.body.cultural_identifiers,
        dietary_preferences: input.body.dietary_preferences,
      });
      if (row === null) {
        // Race: the matched row was deleted between find and update.
        // Fall through to insert.
        const inserted = await this.repository.insert({
          household_id: input.householdId,
          name: input.body.name,
          age_band: input.body.age_band,
          school_policy_notes: input.body.school_policy_notes ?? null,
          declared_allergens: input.body.declared_allergens,
          cultural_identifiers: input.body.cultural_identifiers,
          dietary_preferences: input.body.dietary_preferences,
        });
        return { child: toChildResponse(inserted), was_existing: false };
      }
      return { child: toChildResponse(row), was_existing: true };
    }

    const inserted = await this.repository.insert({
      household_id: input.householdId,
      name: input.body.name,
      age_band: input.body.age_band,
      school_policy_notes: input.body.school_policy_notes ?? null,
      declared_allergens: input.body.declared_allergens,
      cultural_identifiers: input.body.cultural_identifiers,
      dietary_preferences: input.body.dietary_preferences,
    });
    return { child: toChildResponse(inserted), was_existing: false };
  }

  async getChild(input: GetChildInput): Promise<ChildResponse> {
    const row = await this.repository.findById(input.householdId, input.childId);
    if (row === null) throw new NotFoundError('Child not found');
    return toChildResponse(row);
  }

  async setBagComposition(input: SetBagCompositionInput): Promise<SetBagCompositionResult> {
    // Read current composition first so the audit event can record the
    // pre-image. A missing row here means the child belongs to another
    // household (or doesn't exist) — same 403 either way to avoid leaking
    // existence across households.
    const existing = await this.repository.findById(input.householdId, input.childId);
    if (existing === null) {
      throw new ForbiddenError('Child not in this household');
    }

    const updated = await this.repository.updateBagComposition(
      input.childId,
      input.householdId,
      input.body,
    );
    if (updated === null) {
      throw new ForbiddenError('Child not in this household');
    }

    return {
      child: toChildResponse(updated),
      audit: {
        old: existing.bag_composition,
        new: updated.bag_composition,
      },
    };
  }
}

function toChildResponse(row: DecryptedChildRow): ChildResponse {
  return {
    id: row.id,
    household_id: row.household_id,
    name: row.name,
    age_band: row.age_band,
    school_policy_notes: row.school_policy_notes,
    declared_allergens: row.declared_allergens,
    cultural_identifiers: row.cultural_identifiers,
    dietary_preferences: row.dietary_preferences,
    allergen_rule_version: row.allergen_rule_version,
    bag_composition: row.bag_composition,
    created_at: row.created_at,
  };
}
