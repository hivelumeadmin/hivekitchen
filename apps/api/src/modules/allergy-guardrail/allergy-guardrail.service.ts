import type { FastifyBaseLogger } from 'fastify';
import type { FlaggedCompoundItem, GuardrailResult, PlanItemForGuardrail } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { AllergyGuardrailDecryptError } from './allergy-guardrail.repository.js';
import type { AllergyRule } from './allergy-rules.engine.js';
import { evaluate, GUARDRAIL_VERSION } from './allergy-rules.engine.js';

// Story 3.S39 — a slot whose base recipe has no stored ingredients at commit
// time. The engine cannot evaluate it, so the commit guardrail treats it as a
// risk only for children who carry a declared (parent_declared) allergen.
// Story 3-s43 — snack-SKU Phase-1 attested:true exemption retired.
// Phase-2: tagged SKUs (allergen_tags non-empty) are pushed as verifiable
// PlanItemForGuardrail items; untagged SKUs (allergen_tags=[]) are pushed
// as unverifiable without attested:true. `attested` remains on the interface
// (other future callers may use it) but buildCommitGuardrailInputs no longer
// sets it for snack-SKU slots.
export interface UnverifiableSlot {
  child_id: string;
  day: string;
  slot: string;
  // Human-readable label surfaced as the flagged item's `ingredient` on the
  // hard-fail surface. Not a real ingredient — the recipe data is missing.
  recipe_label: string;
  // When true, the slot is exempted from the fail-closed unverifiable path.
  // Used for snack-SKU slots (Phase-1 parent-attested; allergen fields are
  // explicit on the snack_skus row rather than inferred from recipe ingredients).
  attested?: boolean;
}

export interface AllergyGuardrailServiceDeps {
  repository: AllergyGuardrailRepository;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

export class AllergyGuardrailService {
  private readonly repo: AllergyGuardrailRepository;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: AllergyGuardrailServiceDeps) {
    this.repo = deps.repository;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  // Loads the household's allergy rules, mapping a decrypt failure to a null
  // result so callers can fail-closed (uncertain) instead of throwing.
  private async loadRules(
    householdId: string,
  ): Promise<{ rules: AllergyRule[] } | { decryptError: true }> {
    try {
      return { rules: await this.repo.getRulesForHousehold(householdId) };
    } catch (err) {
      if (err instanceof AllergyGuardrailDecryptError) {
        this.logger.error(
          { household_id: householdId, err },
          'allergen data decrypt failed — returning uncertain to prevent silent approval',
        );
        return { decryptError: true };
      }
      throw err;
    }
  }

  async evaluate(
    planItems: PlanItemForGuardrail[],
    householdId: string,
  ): Promise<GuardrailResult> {
    const loaded = await this.loadRules(householdId);
    if ('decryptError' in loaded) {
      return { verdict: 'uncertain', conflicts: [], reason: 'allergen_data_decrypt_failure' };
    }
    return evaluate(planItems, loaded.rules);
  }

  async clearOrReject(
    planItems: PlanItemForGuardrail[],
    householdId: string,
    requestId: string,
  ): Promise<GuardrailResult> {
    const result = await this.evaluate(planItems, householdId);
    await this.recordDecision(result, householdId, requestId);
    return result;
  }

  // Story 3.S39 — commit-time evaluation over the full effective ingredient
  // set. `items` are the verifiable (child, day, slot) tuples whose recipe
  // ingredients resolved; `unverifiable` are tuples whose base recipe has no
  // stored ingredients. Loads rules ONCE and:
  //   - runs the engine on `items` (blocked takes precedence — a real allergen
  //     conflict always wins),
  //   - for each unverifiable slot, flags it ONLY when the child carries a
  //     declared (parent_declared) allergen — household-wide or child-scoped.
  //     A child with no declared allergens is never blocked by missing recipe
  //     data (nothing to protect against); FALCPA-only households likewise do
  //     not gate on unverifiable recipes here (consistent with the engine's
  //     compound-suspect scan, which is parent_declared-gated).
  // The merged verdict routes through the SAME recoverable path as compound-
  // uncertain (reason='compound_ingredient_unverified'), so commit retries via
  // surgical swap → full regen and, on exhaustion, lands on the existing
  // hard-fail/degraded surface.
  async clearOrRejectCommit(opts: {
    items: PlanItemForGuardrail[];
    unverifiable: ReadonlyArray<UnverifiableSlot>;
    householdId: string;
    requestId: string;
  }): Promise<GuardrailResult> {
    const loaded = await this.loadRules(opts.householdId);
    if ('decryptError' in loaded) {
      const result: GuardrailResult = {
        verdict: 'uncertain',
        conflicts: [],
        reason: 'allergen_data_decrypt_failure',
      };
      await this.recordDecision(result, opts.householdId, opts.requestId);
      return result;
    }
    const rules = loaded.rules;

    const base: GuardrailResult =
      opts.items.length > 0
        ? evaluate(opts.items, rules)
        : { verdict: 'cleared', conflicts: [] };

    // A real allergen conflict on a verifiable item always wins — short-circuit.
    if (base.verdict === 'blocked') {
      await this.recordDecision(base, opts.householdId, opts.requestId);
      return base;
    }

    // Flag unverifiable slots for children with a declared allergen.
    const seen = new Set<string>();
    const unverifiableFlags: FlaggedCompoundItem[] = [];
    for (const u of opts.unverifiable) {
      // Story 3-S40 — snack-SKU slots are parent-attested; skip fail-closed path.
      if (u.attested) continue;
      const childHasDeclared = rules.some(
        (r) =>
          r.rule_type === 'parent_declared' &&
          (r.child_id === null || r.child_id === u.child_id),
      );
      if (!childHasDeclared) continue;
      const key = `${u.child_id}|${u.recipe_label}|${u.slot}|${u.day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unverifiableFlags.push({
        child_id: u.child_id,
        ingredient: u.recipe_label,
        slot: u.slot,
        day: u.day,
      });
    }

    // Engine already flagged compound-uncertain — merge the unverifiable flags
    // into the same recoverable result.
    if (base.verdict === 'uncertain' && base.reason === 'compound_ingredient_unverified') {
      const merged: GuardrailResult = {
        verdict: 'uncertain',
        conflicts: [],
        reason: 'compound_ingredient_unverified',
        flagged_items: [...(base.flagged_items ?? []), ...unverifiableFlags],
      };
      await this.recordDecision(merged, opts.householdId, opts.requestId);
      return merged;
    }

    // Engine returned an infrastructure-uncertain (no_rules_loaded,
    // falcpa_baseline_missing, …) — that is not recoverable; return as-is.
    if (base.verdict === 'uncertain') {
      await this.recordDecision(base, opts.householdId, opts.requestId);
      return base;
    }

    // base is cleared. If any allergic child has an unverifiable recipe, route
    // through the recoverable uncertain path; otherwise the plan clears.
    const result: GuardrailResult =
      unverifiableFlags.length > 0
        ? {
            verdict: 'uncertain',
            conflicts: [],
            reason: 'compound_ingredient_unverified',
            flagged_items: unverifiableFlags,
          }
        : base;
    await this.recordDecision(result, opts.householdId, opts.requestId);
    return result;
  }

  // Logs + audits + persists a guardrail decision. Shared by clearOrReject and
  // clearOrRejectCommit so both paths leave an identical audit/decision trail.
  private async recordDecision(
    result: GuardrailResult,
    householdId: string,
    requestId: string,
  ): Promise<void> {
    // Emit audit BEFORE persisting the decision row. Rationale: a decision row without
    // an audit row is the worse split-state ("we blocked something but cannot prove
    // why"); an audit row without a decision row is recoverable ("we logged a rejection
    // but the decision write failed — caller will retry"). Idempotency on retry is
    // guaranteed by the unique index on (household_id, request_id) in writeDecision.
    if (result.verdict === 'blocked') {
      this.logger.warn(
        {
          household_id: householdId,
          request_id: requestId,
          conflict_count: result.conflicts.length,
          guardrail_version: GUARDRAIL_VERSION,
        },
        'allergy guardrail blocked plan',
      );
      await this.auditService.write({
        event_type: 'allergy.guardrail_rejection',
        household_id: householdId,
        request_id: requestId,
        metadata: {
          conflicts: result.conflicts,
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } else if (result.verdict === 'uncertain') {
      // Story 3.24 — compound-uncertain is a recoverable data-quality signal
      // (substitution will be attempted), not an infrastructure failure. Lower
      // the log level to warn and surface flagged_items in the audit metadata
      // so post-hoc analysis can trace which compounds drove the substitution.
      const isCompound = result.reason === 'compound_ingredient_unverified';
      if (isCompound) {
        this.logger.warn(
          {
            household_id: householdId,
            request_id: requestId,
            reason: result.reason,
            flagged_count: result.flagged_items?.length ?? 0,
            guardrail_version: GUARDRAIL_VERSION,
          },
          'allergy guardrail: compound ingredients flagged — substitution will be attempted',
        );
      } else {
        this.logger.error(
          {
            household_id: householdId,
            request_id: requestId,
            reason: result.reason,
            guardrail_version: GUARDRAIL_VERSION,
          },
          'allergy guardrail returned uncertain — refusing to render',
        );
      }
      await this.auditService.write({
        event_type: 'allergy.uncertainty',
        household_id: householdId,
        request_id: requestId,
        metadata: {
          reason: result.reason,
          ...(isCompound ? { flagged_items: result.flagged_items ?? [] } : {}),
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    } else {
      this.logger.info(
        {
          household_id: householdId,
          request_id: requestId,
          guardrail_version: GUARDRAIL_VERSION,
        },
        'allergy guardrail cleared plan',
      );
    }

    // Story 3.24 — compound-uncertain decisions carry flagged_items (not
    // allergen+ingredient conflicts). The JSONB `conflicts` column accepts
    // either shape; preserving flagged_items here keeps the audit trail
    // complete without a schema change.
    await this.repo.writeDecision({
      household_id: householdId,
      verdict: result.verdict,
      guardrail_version: GUARDRAIL_VERSION,
      conflicts:
        result.verdict === 'blocked'
          ? result.conflicts
          : result.verdict === 'uncertain'
            ? result.flagged_items ?? []
            : [],
      request_id: requestId,
    });
  }
}
