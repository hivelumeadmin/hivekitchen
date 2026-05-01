import type { GuardrailResult, PlanItemForGuardrail } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
import { evaluate, GUARDRAIL_VERSION } from './allergy-rules.engine.js';

export class AllergyGuardrailService {
  constructor(
    private readonly repo: AllergyGuardrailRepository,
    private readonly auditService: AuditService,
  ) {}

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
    await this.repo.writeDecision({
      household_id: householdId,
      verdict: result.verdict,
      guardrail_version: GUARDRAIL_VERSION,
      conflicts: result.conflicts,
      request_id: requestId,
    });
    if (result.verdict === 'blocked') {
      await this.auditService.write({
        event_type: 'allergy.guardrail_rejection',
        household_id: householdId,
        request_id: requestId,
        metadata: {
          conflicts: result.conflicts,
          guardrail_version: GUARDRAIL_VERSION,
        },
      });
    }
    return result;
  }
}
