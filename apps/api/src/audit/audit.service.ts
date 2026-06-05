import type { AuditRepository } from './audit.repository.js';
import type { AuditWriteInput, ConsentAuditRow } from './audit.types.js';

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.repository.insert(input);
  }

  // Slice 7-S9 — consent history read path. Thin delegation to the repo.
  async getConsentHistory(householdId: string): Promise<ConsentAuditRow[]> {
    return this.repository.findConsentEventsByHousehold(householdId);
  }
}
