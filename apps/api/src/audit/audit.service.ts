import type { AuditRepository } from './audit.repository.js';
import type { AuditWriteInput } from './audit.types.js';

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.repository.insert(input);
  }
}
