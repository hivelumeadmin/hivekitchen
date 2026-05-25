import type { FastifyBaseLogger } from 'fastify';
import type { GuardrailResult, PlanItemForGuardrail } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { AllergyGuardrailDecryptError } from './allergy-guardrail.repository.js';
import { evaluate, GUARDRAIL_VERSION } from './allergy-rules.engine.js';

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

  async evaluate(
    planItems: PlanItemForGuardrail[],
    householdId: string,
  ): Promise<GuardrailResult> {
    let rules;
    try {
      rules = await this.repo.getRulesForHousehold(householdId);
    } catch (err) {
      if (err instanceof AllergyGuardrailDecryptError) {
        this.logger.error(
          { household_id: householdId, err },
          'allergen data decrypt failed — returning uncertain to prevent silent approval',
        );
        return { verdict: 'uncertain', conflicts: [], reason: 'allergen_data_decrypt_failure' };
      }
      throw err;
    }
    return evaluate(planItems, rules);
  }

  async clearOrReject(
    planItems: PlanItemForGuardrail[],
    householdId: string,
    requestId: string,
  ): Promise<GuardrailResult> {
    const result = await this.evaluate(planItems, householdId);

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

    return result;
  }
}
