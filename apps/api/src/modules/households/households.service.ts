import type { FastifyBaseLogger } from 'fastify';
import type {
  HouseholdProfilePatchBody,
  HouseholdProfileResponse,
} from '@hivekitchen/contracts';
import type {
  HouseholdGeolocationConsent,
  UpdateGeolocationConsentRequest,
} from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import type { HouseholdsRepository } from './households.repository.js';
import type { VocabularyService } from '../vocabulary/vocabulary.service.js';

export interface HouseholdsServiceDeps {
  repository: HouseholdsRepository;
  vocabulary: VocabularyService;
  logger: FastifyBaseLogger;
}

// Slice 2-s27 — service-layer wrapper around the household profile reads /
// writes. Vocabulary validation runs here (not in the repository) so the
// agent tool and the parent-facing route share one canonical validation path.
export class HouseholdsService {
  constructor(private readonly deps: HouseholdsServiceDeps) {}

  async getProfile(householdId: string): Promise<HouseholdProfileResponse> {
    const profile = await this.deps.repository.getProfile(householdId);
    return {
      id: householdId,
      ...profile,
    };
  }

  // Slice 2.5-s5 — Moment 1 household label setter. No vocabulary validation
  // (display_name is free-text constrained at the contract boundary). The
  // repository handles the kitchen_map_version bump so the composer picks
  // up the new value on next read.
  async setDisplayName(householdId: string, displayName: string): Promise<void> {
    return this.deps.repository.setDisplayName(householdId, displayName);
  }

  async addAllergens(
    householdId: string,
    toAdd: string[],
    otherPatch: { cultural_identifiers?: string[]; dietary_preferences?: string[] } = {},
  ): Promise<HouseholdProfileResponse> {
    const validatedNew = this.deps.vocabulary.validateAllergens(toAdd);

    // Advisory lock prevents concurrent agent turns from reading the same stale
    // allergen list and overwriting each other's additions. Session-level —
    // MUST release in finally even if the read or write throws.
    await this.deps.repository.acquireAllergenLock(householdId);
    try {
      const current = await this.deps.repository.getProfile(householdId);
      // Merge validated new items with already-stored allergens. Do NOT
      // re-validate stored values through vocabularyService — those passed
      // validation at write time and a deactivated tag would break the merge.
      const merged = [...new Set([...current.declared_allergens, ...validatedNew])];

      // Build a pre-validated patch and write directly to the repository,
      // bypassing patchProfile's re-validation of declared_allergens.
      const patch: Parameters<typeof this.deps.repository.patchProfile>[1] = {
        declared_allergens: merged,
      };
      if (otherPatch.cultural_identifiers !== undefined) {
        patch.cultural_identifiers = this.deps.vocabulary.validateCultural(
          otherPatch.cultural_identifiers,
        );
      }
      if (otherPatch.dietary_preferences !== undefined) {
        patch.dietary_preferences = this.deps.vocabulary.validateDietary(
          otherPatch.dietary_preferences,
        );
      }

      const updated = await this.deps.repository.patchProfile(householdId, patch);
      await this.deps.repository.bumpKitchenMapVersion(householdId);
      return { id: householdId, ...updated };
    } finally {
      await this.deps.repository.releaseAllergenLock(householdId);
    }
  }

  async patchProfile(
    householdId: string,
    patch: HouseholdProfilePatchBody,
  ): Promise<HouseholdProfileResponse> {
    // Validate against the active vocabularies BEFORE touching the DB.
    // Unknown / inactive tags throw with a clear error that surfaces as 400
    // at the route handler. Expansion (e.g. dietary implies-closure) does NOT
    // run here — the household is a declared identity, not an inferred set,
    // so storing the parent's literal tags preserves their intent. Closure
    // expansion can be applied at planner-read time if needed.
    const validated: HouseholdProfilePatchBody = {};
    if (patch.cultural_identifiers !== undefined) {
      validated.cultural_identifiers = this.deps.vocabulary.validateCultural(
        patch.cultural_identifiers,
      );
    }
    if (patch.dietary_preferences !== undefined) {
      validated.dietary_preferences = this.deps.vocabulary.validateDietary(
        patch.dietary_preferences,
      );
    }
    if (patch.declared_allergens !== undefined) {
      validated.declared_allergens = this.deps.vocabulary.validateAllergens(
        patch.declared_allergens,
      );
    }

    const updated = await this.deps.repository.patchProfile(householdId, validated);
    const hasChanges = Object.keys(validated).length > 0;
    if (hasChanges) {
      await this.deps.repository.bumpKitchenMapVersion(householdId);
    }
    return {
      id: householdId,
      ...updated,
    };
  }

  // Story 3-S35 — weekly auto-compose enrollment toggle.
  async getAutoComposeEnabled(householdId: string): Promise<boolean> {
    return this.deps.repository.getAutoComposeEnabled(householdId);
  }

  async setAutoComposeEnabled(householdId: string, enabled: boolean): Promise<void> {
    return this.deps.repository.setAutoComposeEnabled(householdId, enabled);
  }

  // Slice 5-S14 — household-level geolocation consent (FR74, NFR-PRIV-3).
  async getGeolocationConsent(householdId: string): Promise<HouseholdGeolocationConsent> {
    const consent = await this.deps.repository.getGeolocationConsent(householdId);
    if (!consent) throw new NotFoundError(`Household ${householdId} not found`);
    return consent;
  }

  async updateGeolocationConsent(
    householdId: string,
    input: UpdateGeolocationConsentRequest,
  ): Promise<HouseholdGeolocationConsent> {
    const updatePayload: Parameters<
      typeof this.deps.repository.updateGeolocationConsent
    >[1] = {
      geolocation_enabled: input.geolocation_enabled,
      geolocation_purpose: input.geolocation_enabled
        ? (input.geolocation_purpose ?? 'cultural_supplier_routing')
        : null,
    };
    if (input.geolocation_enabled) {
      updatePayload.geolocation_consented_at = new Date().toISOString();
    }
    // geolocation_consented_at is NOT cleared on opt-out (preserved as historical record).
    return this.deps.repository.updateGeolocationConsent(householdId, updatePayload);
  }
}
