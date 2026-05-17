import type {
  CreateHeartNoteBody,
  PatchHeartNoteBody,
} from '@hivekitchen/contracts';
import { NotFoundError } from '../../common/errors.js';
import type { HeartNoteRepository, HeartNoteRow } from './heart-note.repository.js';


export class HeartNoteService {
  constructor(private readonly repo: HeartNoteRepository) {}

  async createDraft(
    householdId: string,
    authorUserId: string,
    body: CreateHeartNoteBody,
  ): Promise<HeartNoteRow> {
    const childValid = await this.repo.childBelongsToHousehold(body.child_id, householdId);
    if (!childValid) throw new NotFoundError('child not found');
    return this.repo.create({
      householdId,
      childId: body.child_id,
      authorUserId,
      content: body.content,
      scheduledFor: body.scheduled_for,
    });
  }

  async getDraft(
    householdId: string,
    childId: string,
    isoDate: string,
  ): Promise<HeartNoteRow | null> {
    return this.repo.findByChildAndDate(householdId, childId, isoDate);
  }

  async patchNote(
    id: string,
    householdId: string,
    body: PatchHeartNoteBody,
  ): Promise<HeartNoteRow> {
    const updated = await this.repo.patch(id, householdId, {
      content: body.content,
      scheduledFor: body.scheduled_for,
    });
    if (updated === null) {
      throw new NotFoundError('Heart note not found');
    }
    return updated;
  }
}
