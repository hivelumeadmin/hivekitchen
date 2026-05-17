import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { HouseholdsService } from './households.service.js';
import type { HouseholdsRepository } from './households.repository.js';
import type { VocabularyService } from '../vocabulary/vocabulary.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeLogger(): FastifyBaseLogger {
  const fn = vi.fn();
  return {
    info: fn, warn: fn, error: fn, debug: fn, fatal: fn, trace: fn,
    child: () => makeLogger(), level: 'info', silent: () => {},
  } as unknown as FastifyBaseLogger;
}

function makeRepo(): HouseholdsRepository {
  return {
    getProfile: vi.fn(),
    patchProfile: vi.fn(),
    bumpKitchenMapVersion: vi.fn().mockResolvedValue(undefined),
  } as unknown as HouseholdsRepository;
}

function makeVocabulary(overrides: Partial<VocabularyService> = {}): VocabularyService {
  return {
    validateCultural: vi.fn((keys: string[]) => [...keys]),
    validateDietary: vi.fn((keys: string[]) => [...keys]),
    validateAllergens: vi.fn((keys: string[]) => [...keys]),
    ...overrides,
  } as unknown as VocabularyService;
}

function makeService(
  repo: HouseholdsRepository = makeRepo(),
  vocabulary: VocabularyService = makeVocabulary(),
): { service: HouseholdsService; repo: HouseholdsRepository; vocabulary: VocabularyService } {
  const service = new HouseholdsService({ repository: repo, vocabulary, logger: makeLogger() });
  return { service, repo, vocabulary };
}

describe('HouseholdsService.getProfile', () => {
  it('returns id + the repository projection', async () => {
    const { service, repo } = makeService();
    (repo.getProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cultural_identifiers: ['south_asian'],
      dietary_preferences: ['vegetarian'],
      declared_allergens: ['pork'],
    });

    const result = await service.getProfile(HOUSEHOLD_ID);

    expect(result).toEqual({
      id: HOUSEHOLD_ID,
      cultural_identifiers: ['south_asian'],
      dietary_preferences: ['vegetarian'],
      declared_allergens: ['pork'],
    });
  });
});

describe('HouseholdsService.patchProfile', () => {
  it('passes through a single-field patch unchanged', async () => {
    const { service, repo } = makeService();
    (repo.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cultural_identifiers: [],
      dietary_preferences: ['halal'],
      declared_allergens: [],
    });

    const result = await service.patchProfile(HOUSEHOLD_ID, {
      dietary_preferences: ['halal'],
    });

    expect(result.dietary_preferences).toEqual(['halal']);
    expect(repo.patchProfile).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      dietary_preferences: ['halal'],
    });
  });

  it('omits unset fields from the repository call (PATCH semantics)', async () => {
    const { service, repo } = makeService();
    (repo.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: ['pork'],
    });

    await service.patchProfile(HOUSEHOLD_ID, { declared_allergens: ['pork'] });

    const call = (repo.patchProfile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(call).toEqual({ declared_allergens: ['pork'] });
    expect(call && 'cultural_identifiers' in call).toBe(false);
    expect(call && 'dietary_preferences' in call).toBe(false);
  });

  it('clears a field when an empty array is provided', async () => {
    const { service, repo } = makeService();
    (repo.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    });

    await service.patchProfile(HOUSEHOLD_ID, { declared_allergens: [] });

    expect(repo.patchProfile).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      declared_allergens: [],
    });
  });

  it('validates tags via the vocabulary service before writing', async () => {
    const validateAllergens = vi.fn((keys: string[]) => keys);
    const validateCultural = vi.fn((keys: string[]) => keys);
    const validateDietary = vi.fn((keys: string[]) => keys);
    const vocab = makeVocabulary({
      validateAllergens,
      validateCultural,
      validateDietary,
    });
    const { service, repo } = makeService(makeRepo(), vocab);
    (repo.patchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cultural_identifiers: ['south_asian'],
      dietary_preferences: ['halal'],
      declared_allergens: ['pork'],
    });

    await service.patchProfile(HOUSEHOLD_ID, {
      cultural_identifiers: ['south_asian'],
      dietary_preferences: ['halal'],
      declared_allergens: ['pork'],
    });

    expect(validateCultural).toHaveBeenCalledWith(['south_asian']);
    expect(validateDietary).toHaveBeenCalledWith(['halal']);
    expect(validateAllergens).toHaveBeenCalledWith(['pork']);
  });

  it('surfaces vocabulary rejection as an Error (route maps to 400)', async () => {
    const vocab = makeVocabulary({
      validateAllergens: vi.fn(() => {
        throw new Error('Unknown or inactive allergen tag: kryptonite');
      }),
    });
    const { service } = makeService(makeRepo(), vocab);

    await expect(
      service.patchProfile(HOUSEHOLD_ID, { declared_allergens: ['kryptonite'] }),
    ).rejects.toThrow(/Unknown or inactive allergen/);
  });
});
