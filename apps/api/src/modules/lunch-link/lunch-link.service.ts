import type { LunchLinkDevResponse } from '@hivekitchen/contracts';
import type { LunchLinkRepository } from './lunch-link.repository.js';
import type { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';

// Hardcoded stub bag for S2 — real bag from plan_items ships in a later slice.
const STUB_BAG = {
  name: 'Sandwich, apple & water',
  sub: 'Packed for you today',
  safetyNote: 'Nut-free',
} as const;

export class LunchLinkService {
  constructor(
    private readonly lunchLinkRepo: LunchLinkRepository,
    private readonly heartNoteRepo: HeartNoteRepository,
  ) {}

  // Returns null when childId is not in the caller's household; the caller
  // raises 404 from that null.
  async getDevPayload(
    householdId: string,
    childId: string,
    date: string,
  ): Promise<LunchLinkDevResponse | null> {
    const childName = await this.lunchLinkRepo.findChildName(childId, householdId);
    if (childName === null) return null;

    const noteRow = await this.heartNoteRepo.findByChildAndDate(householdId, childId, date);

    return {
      childName,
      date,
      heartNote: noteRow
        ? { body: noteRow.content, authorDisplayName: 'Parent' }
        : null,
      bag: { ...STUB_BAG },
    };
  }
}
