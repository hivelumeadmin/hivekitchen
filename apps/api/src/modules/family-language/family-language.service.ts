import type {
  FamilyLanguageRatifyAction,
  FamilyLanguageState,
  FamilyLanguageTerm,
} from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import type { FamilyLanguageRepository } from './family-language.repository.js';

export interface FamilyLanguageRatifyInput {
  householdId: string;
  term: string;
  action: FamilyLanguageRatifyAction;
}

export interface FamilyLanguageRatifyResult {
  term: FamilyLanguageTerm;
  lumi_response?: string;
  // Set ONLY when state actually transitioned (opt_in / forget on a candidate).
  // The route uses this to populate request.auditContext. The family-language
  // word is culturally sensitive and is NEVER written to audit — maps_to + state
  // codes only (project-context PII rule).
  audit?: {
    maps_to: string;
    from_state: FamilyLanguageState;
    to_state: FamilyLanguageState;
  };
}

// Warm, no-LLM follow-up for "tell Lumi more". The term stays a candidate.
const TELL_LUMI_MORE_REPLY = "Tell me — what should I call them, and I'll use your word.";

export class FamilyLanguageService {
  private readonly repository: FamilyLanguageRepository;

  constructor(repository: FamilyLanguageRepository) {
    this.repository = repository;
  }

  async ratify(input: FamilyLanguageRatifyInput): Promise<FamilyLanguageRatifyResult> {
    const { updated, from } = await this.repository.ratify(
      input.householdId,
      input.term,
      input.action,
    );

    if (updated === null) {
      throw new NotFoundError('family-language term not found');
    }

    if (input.action === 'tell_lumi_more') {
      return { term: updated, lumi_response: TELL_LUMI_MORE_REPLY };
    }

    if (from === null) {
      // Idempotent opt_in on active, forward-only forget no-op on active, or
      // forget on already-forgotten — no state change, so no audit.
      return { term: updated };
    }

    return {
      term: updated,
      audit: { maps_to: updated.maps_to, from_state: from, to_state: updated.state },
    };
  }
}
