import { BaseRepository } from '../repository/base.repository.js';
import type { AuditWriteInput } from './audit.types.js';

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
}
