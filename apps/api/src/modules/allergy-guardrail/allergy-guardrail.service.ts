import type { FastifyBaseLogger } from 'fastify';
import type { GuardrailResult, PlanItemForGuardrail } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
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
    const rules = await this.repo.getRulesForHousehold(householdId);
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
      this.logger.error(
        {
          household_id: householdId,
          request_id: requestId,
          reason: result.reason,
          guardrail_version: GUARDRAIL_VERSION,
        },
        'allergy guardrail returned uncertain — refusing to render',
      );
      await this.auditService.write({
        event_type: 'allergy.uncertainty',
        household_id: householdId,
        request_id: requestId,
        metadata: {
          reason: result.reason,
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

    await this.repo.writeDecision({
      household_id: householdId,
      verdict: result.verdict,
      guardrail_version: GUARDRAIL_VERSION,
      conflicts: result.conflicts,
      request_id: requestId,
    });

    return result;
  }
}
