import type { PlanComposeInput, PlanComposeOutput } from '@hivekitchen/types';
import { NotImplementedError } from '../../common/errors.js';

export class PlanService {
  async compose(_input: PlanComposeInput): Promise<PlanComposeOutput> {
    throw new NotImplementedError('plan.compose — real service lands in Story 3.5');
  }
}
