import { BaseRepository } from '../repository/base.repository.js';
import type { AllergyAuditRow, AuditWriteInput } from './audit.types.js';

const ALLERGY_EVENT_TYPES = [
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
] as const;

export class AuditRepository extends BaseRepository {
  async insert(input: AuditWriteInput): Promise<void> {
    const { error } = await this.client.from('audit_log').insert({
      household_id: input.household_id ?? null,
      user_id: input.user_id ?? null,
      event_type: input.event_type,
      correlation_id: input.correlation_id ?? null,
      request_id: input.request_id,
      stages: input.stages ?? null,
      metadata: input.metadata,
    });
    if (error) throw error;
  }

  // Slice 4-S17 — first read method on this repository. Returns the household's
  // allergy.* audit rows oldest-first for the transparency log export. Uses
  // `.in()` (not `.like()`) on the enum column so the query is type-safe and
  // hits the composite index (household_id, event_type, …) directly.
  async findAllergyEventsByHousehold(householdId: string): Promise<AllergyAuditRow[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('id, event_type, metadata, created_at')
      .eq('household_id', householdId)
      .in('event_type', ALLERGY_EVENT_TYPES)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as AllergyAuditRow[];
  }
}
