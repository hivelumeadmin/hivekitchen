import type { PantryReadInput, PantryReadOutput } from '@hivekitchen/types';
import { NotImplementedError } from '../../common/errors.js';

export class PantryService {
  async read(_input: PantryReadInput): Promise<PantryReadOutput> {
    throw new NotImplementedError('pantry.read — real service lands in Epic 6');
  }
}
