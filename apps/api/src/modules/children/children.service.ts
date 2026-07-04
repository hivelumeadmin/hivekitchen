import type {
  AddChildBody,
  BagCompositionPattern,
  ChildResponse,
  SetBagCompositionBody,
} from '@hivekitchen/types';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import type { ChildrenRepository, DecryptedChildRow } from './children.repository.js';

export interface AddChildInput {
  householdId: string;
  body: AddChildBody;
}

/**
 * Slice C / polish — partial-update variant of AddChildBody for the
 * onboarding agent's child.upsert tool. Tag arrays + school_policy_notes
 * are optional (undefined = preserve existing on update; empty array =
 * explicit overwrite). name + age_band stay required because they're
 * the identifying fields.
 */
export interface UpsertByNameBody {
  name: AddChildBody['name'];
  age_band: AddChildBody['age_band'];
  school_policy_notes?: AddChildBody['school_policy_notes'] | undefined;
  declared_allergens?: AddChildBody['declared_allergens'] | undefined;
  cultural_identifiers?: AddChildBody['cultural_identifiers'] | undefined;
  dietary_preferences?: AddChildBody['dietary_preferences'] | undefined;
  // Slice 2.5-s8 — parent-stated bag composition pattern captured in Moment 4.
  // PATCH semantics: undefined preserves existing; explicit null clears.
  bag_composition_pattern?: BagCompositionPattern | null | undefined;
}

export interface UpsertByNameInput {
  householdId: string;
  body: UpsertByNameBody;
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
  // Story 3-DM-B1 — audit shape moved to bag_composition_pattern values
  // (the canonical column). Downstream audit consumers can derive the
  // boolean struct via bagCompositionFromPattern if needed.
  audit: { old: BagCompositionPattern; new: BagCompositionPattern };
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
   * PATCH semantics on update: optional tag-array fields preserve existing
   * values when omitted (undefined). Pass an explicit array (including
   * empty []) to overwrite. This lets the onboarding agent volunteer
   * incremental facts without clobbering earlier learnings — e.g. turn 1
   * sets declared_allergens=['peanut']; turn 2's child.upsert that
   * doesn't mention allergens preserves ['peanut'] rather than clearing it.
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
  async upsertByName(input: UpsertByNameInput): Promise<{
    child: ChildResponse;
    was_existing: boolean;
  }> {
    const existing = await this.repository.findByHouseholdId(input.householdId);
    const target = existing.find(
      (c) => c.name.trim().toLocaleLowerCase() === input.body.name.trim().toLocaleLowerCase(),
    );

    if (target !== undefined) {
      // PATCH merge: undefined fields preserve existing values; explicit
      // arrays (including []) overwrite. school_policy_notes follows the
      // same rule (undefined preserves; null explicitly clears).
      // bag_composition_pattern (2.5-s8) follows the same rule: undefined
      // skips the column entirely, null clears, value writes. The repository
      // omits the column from the UPDATE statement when undefined is passed.
      const row = await this.repository.updateProfile({
        id: target.id,
        household_id: input.householdId,
        name: input.body.name.trim(),
        age_band: input.body.age_band,
        school_policy_notes:
          input.body.school_policy_notes === undefined
            ? target.school_policy_notes
            : input.body.school_policy_notes,
        declared_allergens: input.body.declared_allergens ?? target.declared_allergens,
        cultural_identifiers: input.body.cultural_identifiers ?? target.cultural_identifiers,
        dietary_preferences: input.body.dietary_preferences ?? target.dietary_preferences,
        bag_composition_pattern: input.body.bag_composition_pattern,
      });
      if (row === null) {
        // Race: the matched row was deleted between find and update.
        // Fall through to insert with whatever fields the input has.
        const inserted = await this.repository.insert({
          household_id: input.householdId,
          name: input.body.name,
          age_band: input.body.age_band,
          school_policy_notes: input.body.school_policy_notes ?? null,
          declared_allergens: input.body.declared_allergens ?? [],
          cultural_identifiers: input.body.cultural_identifiers ?? [],
          dietary_preferences: input.body.dietary_preferences ?? [],
          bag_composition_pattern: input.body.bag_composition_pattern ?? undefined,
        });
        return { child: toChildResponse(inserted), was_existing: false };
      }
      return { child: toChildResponse(row), was_existing: true };
    }

    // INSERT path: missing tag arrays default to empty (no existing value
    // to merge with). This matches the existing addChild semantics.
    const inserted = await this.repository.insert({
      household_id: input.householdId,
      name: input.body.name,
      age_band: input.body.age_band,
      school_policy_notes: input.body.school_policy_notes ?? null,
      declared_allergens: input.body.declared_allergens ?? [],
      cultural_identifiers: input.body.cultural_identifiers ?? [],
      dietary_preferences: input.body.dietary_preferences ?? [],
      bag_composition_pattern: input.body.bag_composition_pattern ?? undefined,
    });
    return { child: toChildResponse(inserted), was_existing: false };
  }

  /**
   * Slice C polish — case-insensitive name lookup used by the onboarding
   * agent's memory.note tool to resolve subject_child_name → child_id when
   * the agent fires child.upsert and memory.note in the same iteration
   * (parallel tool execution: memory.note sees no child_id at call time
   * because child.upsert hasn't returned yet). Returns the matched child's
   * id, or null if no match.
   *
   * Name match is .trim().toLocaleLowerCase() — same rule as upsertByName,
   * so a memory.note in the SAME turn as the child.upsert that just
   * created the child will resolve correctly.
   */
  async findChildIdByName(householdId: string, name: string): Promise<string | null> {
    const existing = await this.repository.findByHouseholdId(householdId);
    const target = existing.find(
      (c) => c.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    );
    return target?.id ?? null;
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
        // Story 3-DM-B1 — audit logs the pattern change (the canonical column);
        // the boolean struct can be derived from these in any reader.
        old: existing.bag_composition_pattern,
        new: updated.bag_composition_pattern,
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
    // Story 3-DM-B1 — new variation-driving attributes + promoted enum.
    appetite_level: row.appetite_level,
    texture_needs: row.texture_needs,
    spice_tolerance: row.spice_tolerance,
    bag_composition_pattern: row.bag_composition_pattern,
    created_at: row.created_at,
  };
}
