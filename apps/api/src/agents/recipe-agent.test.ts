import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import type { TavilyClient } from '@tavily/core';
import type { RecipeDiscoverInput, RecipeIngredient } from '@hivekitchen/types';
import {
  RecipeAgent,
  buildTavilyQuery,
  detectSourceSite,
  normaliseIngredientHeadNoun,
} from './recipe-agent.js';
import type { VocabularyService } from '../modules/vocabulary/vocabulary.service.js';

/**
 * Story 3-31 — RecipeAgent unit tests.
 *
 * Strategy: stub Tavily + OpenAI + VocabularyService at the boundary. The
 * agent is stateless, so each test constructs its own instance with custom
 * mocks. We verify:
 *  - Tavily is called with includeDomains restricted to allrecipes.com +
 *    recipetineats.com
 *  - LLM extraction failures (parse / Zod / network) drop the candidate
 *    rather than fail the whole batch
 *  - The head-noun normaliser correctly splits known compound prefixes
 *  - Vocabulary post-pass drops unknown values
 */

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const PLAN_BUILD_ID = 'plan-build-test-001';

function makeVocabulary(active: {
  cuisine?: string[];
  cultural?: string[];
  dietary?: string[];
  allergen?: string[];
}): VocabularyService {
  const cuisine = active.cuisine ?? [];
  const cultural = active.cultural ?? [];
  const dietary = active.dietary ?? [];
  const allergen = active.allergen ?? [];
  return {
    snapshot: () => ({
      cuisine_tags: cuisine.map((key) => ({ key, is_active: true })),
      cultural_tags: cultural.map((key) => ({ key, is_active: true })),
      dietary_tags: dietary.map((key) => ({ key, is_active: true })),
      allergen_tags: allergen.map((key) => ({ key, is_active: true })),
      loaded_at: new Date().toISOString(),
    }),
    filterActive: (category: string, keys: readonly string[]) => {
      const allowed: Record<string, string[]> = {
        cuisine,
        cultural,
        dietary,
        allergen,
      };
      const kept: string[] = [];
      const dropped: string[] = [];
      for (const k of keys) {
        if (allowed[category]?.includes(k)) {
          if (!kept.includes(k)) kept.push(k);
        } else {
          dropped.push(k);
        }
      }
      return { kept, dropped };
    },
  } as unknown as VocabularyService;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as ConstructorParameters<typeof RecipeAgent>[0]['logger'];
}

function makeOpenAI(responses: Array<string>): OpenAI {
  const create = vi.fn();
  for (const content of responses) {
    create.mockResolvedValueOnce({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  }
  return {
    chat: { completions: { create } },
  } as unknown as OpenAI;
}

function makeTavily(results: Array<{ url: string; rawContent: string }>): {
  client: TavilyClient;
  searchMock: ReturnType<typeof vi.fn>;
} {
  const searchMock = vi.fn().mockResolvedValue({
    query: '',
    results: results.map((r) => ({
      url: r.url,
      rawContent: r.rawContent,
      title: 'mock',
      content: '',
      score: 1,
    })),
    responseTime: 100,
  });
  return {
    client: { search: searchMock } as unknown as TavilyClient,
    searchMock,
  };
}

function validExtractionJson(opts: { sourceUrl: string; sourceSite: string }): string {
  return JSON.stringify({
    name: 'Test Dish',
    source_url: opts.sourceUrl,
    source_site: opts.sourceSite,
    cuisine_tags: ['south_asian'],
    cultural_tags: [],
    dietary_flags: [],
    allergen_flags: [],
    prep_time_minutes: 30,
    ingredients: [
      {
        key: 'chicken',
        modifier: 'thigh',
        display: '1 lb chicken thighs',
        quantity: 1,
        unit: 'lb',
        optional: false,
        substitutes: [],
      },
    ],
    instructions: ['Cook the chicken.'],
    allergen_info_from_source: null,
  });
}

function discoverInput(overrides: Partial<RecipeDiscoverInput> = {}): RecipeDiscoverInput {
  return {
    household_id: HOUSEHOLD_ID,
    plan_build_id: PLAN_BUILD_ID,
    slot: 'main',
    count: 2,
    intent: 'kid-friendly weeknight lunch',
    constraints: {
      cuisine_tags: ['south_asian'],
      cultural_tags: [],
      dietary_flags: [],
      allergen_exclusions: [],
      max_prep_minutes: null,
    },
    ...overrides,
  };
}

describe('buildTavilyQuery', () => {
  it('includes the intent and the word "recipe"', () => {
    const q = buildTavilyQuery(discoverInput({ intent: 'tofu stir-fry' }));
    expect(q).toContain('tofu stir-fry');
    expect(q).toContain('recipe');
  });

  it('appends a humanised cuisine hint when present', () => {
    const q = buildTavilyQuery(
      discoverInput({
        intent: 'weeknight lunch',
        constraints: {
          cuisine_tags: ['north_indian'],
          cultural_tags: [],
          dietary_flags: [],
          allergen_exclusions: [],
          max_prep_minutes: null,
        },
      }),
    );
    expect(q).toContain('north indian');
  });
});

describe('detectSourceSite', () => {
  it('detects allrecipes', () => {
    expect(detectSourceSite('https://www.allrecipes.com/recipe/123')).toBe('allrecipes');
  });

  it('detects recipetineats', () => {
    expect(detectSourceSite('https://www.recipetineats.com/chicken-biryani/')).toBe(
      'recipetineats',
    );
  });

  it('returns null for any other host', () => {
    expect(detectSourceSite('https://food.com/recipe/123')).toBeNull();
    expect(detectSourceSite('https://reddit.com/r/recipes')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(detectSourceSite('not-a-url')).toBeNull();
  });
});

describe('normaliseIngredientHeadNoun', () => {
  const base: RecipeIngredient = {
    key: 'placeholder',
    modifier: null,
    display: 'placeholder',
    quantity: null,
    unit: null,
    optional: false,
    substitutes: [],
  };

  it('splits a known compound key into base + modifier', () => {
    const r = normaliseIngredientHeadNoun({ ...base, key: 'chicken_thigh' });
    expect(r.key).toBe('chicken');
    expect(r.modifier).toBe('thigh');
  });

  it('does not split an unknown compound key (e.g. taco_seasoning)', () => {
    const r = normaliseIngredientHeadNoun({ ...base, key: 'taco_seasoning' });
    expect(r.key).toBe('taco_seasoning');
    expect(r.modifier).toBeNull();
  });

  it('does not override an explicit modifier', () => {
    const r = normaliseIngredientHeadNoun({
      ...base,
      key: 'chicken_thigh',
      modifier: 'smoked',
    });
    expect(r.key).toBe('chicken_thigh');
    expect(r.modifier).toBe('smoked');
  });

  it('passes through a simple key unchanged', () => {
    const r = normaliseIngredientHeadNoun({ ...base, key: 'rice' });
    expect(r.key).toBe('rice');
    expect(r.modifier).toBeNull();
  });
});

describe('RecipeAgent.discover — Tavily domain restriction (AC12)', () => {
  it('calls Tavily ONLY with includeDomains: [allrecipes.com, recipetineats.com]', async () => {
    const tavily = makeTavily([
      {
        url: 'https://www.allrecipes.com/recipe/1',
        rawContent: 'Some recipe text',
      },
    ]);
    const openai = makeOpenAI([
      validExtractionJson({
        sourceUrl: 'https://www.allrecipes.com/recipe/1',
        sourceSite: 'allrecipes',
      }),
    ]);
    const vocab = makeVocabulary({ cuisine: ['south_asian'] });
    const agent = new RecipeAgent({
      tavily: tavily.client,
      openai,
      vocabulary: vocab,
      logger: makeLogger(),
    });
    await agent.discover(discoverInput());
    expect(tavily.searchMock).toHaveBeenCalledTimes(1);
    const [, options] = tavily.searchMock.mock.calls[0]!;
    expect(options.includeDomains).toEqual(['allrecipes.com', 'recipetineats.com']);
  });
});

describe('RecipeAgent.discover — failure modes', () => {
  it('drops a candidate when LLM returns non-JSON, keeps the others', async () => {
    const tavily = makeTavily([
      { url: 'https://www.allrecipes.com/recipe/1', rawContent: 'page 1 text' },
      { url: 'https://www.recipetineats.com/recipe/2/', rawContent: 'page 2 text' },
    ]);
    const openai = makeOpenAI([
      'not valid json at all',
      validExtractionJson({
        sourceUrl: 'https://www.recipetineats.com/recipe/2/',
        sourceSite: 'recipetineats',
      }),
    ]);
    const vocab = makeVocabulary({ cuisine: ['south_asian'] });
    const agent = new RecipeAgent({
      tavily: tavily.client,
      openai,
      vocabulary: vocab,
      logger: makeLogger(),
    });
    const result = await agent.discover(discoverInput());
    expect(result.candidates).toHaveLength(1);
    expect(result.droppedCount).toBe(1);
  });

  it('drops a candidate when LLM output fails Zod parse', async () => {
    const tavily = makeTavily([
      { url: 'https://www.allrecipes.com/recipe/1', rawContent: 'page 1 text' },
    ]);
    const openai = makeOpenAI([
      // Missing required ingredients array
      JSON.stringify({
        name: 'Broken',
        source_url: 'https://www.allrecipes.com/recipe/1',
        source_site: 'allrecipes',
        cuisine_tags: [],
        cultural_tags: [],
        dietary_flags: [],
        allergen_flags: [],
        prep_time_minutes: null,
        instructions: ['Cook it.'],
        allergen_info_from_source: null,
      }),
    ]);
    const vocab = makeVocabulary({});
    const agent = new RecipeAgent({
      tavily: tavily.client,
      openai,
      vocabulary: vocab,
      logger: makeLogger(),
    });
    const result = await agent.discover(discoverInput());
    expect(result.candidates).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it('drops a result whose host is outside the allowed domains (belt + suspenders)', async () => {
    const tavily = makeTavily([
      // Imagine Tavily ignored includeDomains and returned something else
      { url: 'https://food.com/recipe/sneaky', rawContent: 'page text' },
    ]);
    const openai = makeOpenAI([]);
    const vocab = makeVocabulary({});
    const agent = new RecipeAgent({
      tavily: tavily.client,
      openai,
      vocabulary: vocab,
      logger: makeLogger(),
    });
    const result = await agent.discover(discoverInput());
    expect(result.candidates).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });
});

describe('RecipeAgent.discover — vocabulary post-pass (AC5)', () => {
  it('drops emitted tags not in the active vocabulary, keeps the recipe', async () => {
    const tavily = makeTavily([
      { url: 'https://www.allrecipes.com/recipe/1', rawContent: 'page text' },
    ]);
    const openai = makeOpenAI([
      JSON.stringify({
        name: 'Test',
        source_url: 'https://www.allrecipes.com/recipe/1',
        source_site: 'allrecipes',
        cuisine_tags: ['fictional_cuisine', 'south_asian'],
        cultural_tags: [],
        dietary_flags: [],
        allergen_flags: [],
        prep_time_minutes: 30,
        ingredients: [
          { key: 'rice', modifier: null, display: '1 cup rice', quantity: 1, unit: 'cup', optional: false, substitutes: [] },
        ],
        instructions: ['Cook the rice.'],
        allergen_info_from_source: null,
      }),
    ]);
    const vocab = makeVocabulary({ cuisine: ['south_asian'] });
    const logger = makeLogger();
    const agent = new RecipeAgent({ tavily: tavily.client, openai, vocabulary: vocab, logger });
    const result = await agent.discover(discoverInput());
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.extraction.cuisine_tags).toEqual(['south_asian']);
    // AC5: each dropped tag must emit a logger.info call
    expect((logger.info as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'vocabulary.drop', tag_type: 'cuisine', dropped_value: 'fictional_cuisine' }),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// AC4 — head-noun discipline: fixture pages for chicken biryani, tofu
// stir-fry, and chickpea stew. Each test stubs Tavily with a representative
// page URL and stubs the LLM to return a realistic extraction JSON that
// exercises the compound-key normaliser. The assertions verify that the
// primary protein/grain/legume always ends up in `key`, not buried in the
// compound slug.
// ---------------------------------------------------------------------------

describe('RecipeAgent.discover — head-noun discipline fixture pages (AC4)', () => {
  const BIRYANI_URL = 'https://www.allrecipes.com/recipe/biryani';
  const STIRFRY_URL = 'https://www.recipetineats.com/tofu-stir-fry/';
  const STEW_URL = 'https://www.allrecipes.com/recipe/chickpea-stew';

  function biryaniExtractionJson(): string {
    return JSON.stringify({
      name: 'Chicken Biryani',
      source_url: BIRYANI_URL,
      source_site: 'allrecipes',
      cuisine_tags: ['south_asian'],
      cultural_tags: [],
      dietary_flags: [],
      allergen_flags: ['dairy'],
      prep_time_minutes: 45,
      ingredients: [
        // LLM emits compound key — normaliser should split it
        { key: 'chicken_thigh', modifier: null, display: '500g chicken thighs', quantity: 500, unit: 'g', optional: false, substitutes: [] },
        { key: 'rice', modifier: 'basmati', display: '2 cups basmati rice', quantity: 2, unit: 'cup', optional: false, substitutes: [] },
        // Compound spice product — should NOT be split
        { key: 'garam_masala', modifier: null, display: '1 tsp garam masala', quantity: 1, unit: 'tsp', optional: false, substitutes: [] },
      ],
      instructions: ['Marinate chicken.', 'Cook rice.', 'Layer and steam.'],
      allergen_info_from_source: null,
    });
  }

  function stirFryExtractionJson(): string {
    return JSON.stringify({
      name: 'Tofu Stir-Fry',
      source_url: STIRFRY_URL,
      source_site: 'recipetineats',
      cuisine_tags: [],
      cultural_tags: [],
      dietary_flags: ['vegan'],
      allergen_flags: ['soy'],
      prep_time_minutes: 20,
      ingredients: [
        // LLM emits compound key — normaliser should split at 'tofu'
        { key: 'tofu_firm', modifier: null, display: '400g firm tofu', quantity: 400, unit: 'g', optional: false, substitutes: [] },
        { key: 'broccoli', modifier: null, display: '2 cups broccoli florets', quantity: 2, unit: 'cup', optional: false, substitutes: [] },
      ],
      instructions: ['Press tofu.', 'Stir-fry vegetables.', 'Add sauce.'],
      allergen_info_from_source: 'Contains soy.',
    });
  }

  function chickpeaStewExtractionJson(): string {
    return JSON.stringify({
      name: 'Chickpea Stew',
      source_url: STEW_URL,
      source_site: 'allrecipes',
      cuisine_tags: ['mediterranean'],
      cultural_tags: [],
      dietary_flags: ['vegan'],
      allergen_flags: [],
      prep_time_minutes: 25,
      ingredients: [
        // LLM emits compound key — normaliser should split at 'chickpea'
        { key: 'chickpea_canned', modifier: null, display: '1 can chickpeas, drained', quantity: 1, unit: 'can', optional: false, substitutes: [] },
        { key: 'tomato', modifier: null, display: '2 diced tomatoes', quantity: 2, unit: 'piece', optional: false, substitutes: [] },
      ],
      instructions: ['Sauté aromatics.', 'Add chickpeas and tomatoes.', 'Simmer 15 minutes.'],
      allergen_info_from_source: null,
    });
  }

  it('chicken biryani — protein key is "chicken", garam_masala compound key left intact', async () => {
    const tavily = makeTavily([{ url: BIRYANI_URL, rawContent: 'biryani page text' }]);
    const openai = makeOpenAI([biryaniExtractionJson()]);
    const vocab = makeVocabulary({ cuisine: ['south_asian'] });
    const agent = new RecipeAgent({ tavily: tavily.client, openai, vocabulary: vocab, logger: makeLogger() });
    const result = await agent.discover(discoverInput({ count: 1 }));
    expect(result.candidates).toHaveLength(1);
    const ingredients = result.candidates[0]!.extraction.ingredients;
    const chickenIng = ingredients.find((i) => i.key === 'chicken');
    expect(chickenIng).toBeDefined();
    expect(chickenIng!.modifier).toBe('thigh');
    // garam_masala is a compound spice product — head-noun normaliser should NOT split it
    const masalaIng = ingredients.find((i) => i.key === 'garam_masala');
    expect(masalaIng).toBeDefined();
    expect(masalaIng!.modifier).toBeNull();
  });

  it('tofu stir-fry — protein key is "tofu", modifier is "firm"', async () => {
    const tavily = makeTavily([{ url: STIRFRY_URL, rawContent: 'stir-fry page text' }]);
    const openai = makeOpenAI([stirFryExtractionJson()]);
    const vocab = makeVocabulary({ dietary: ['vegan'] });
    const agent = new RecipeAgent({ tavily: tavily.client, openai, vocabulary: vocab, logger: makeLogger() });
    const result = await agent.discover(discoverInput({ count: 1 }));
    expect(result.candidates).toHaveLength(1);
    const tofuIng = result.candidates[0]!.extraction.ingredients.find((i) => i.key === 'tofu');
    expect(tofuIng).toBeDefined();
    expect(tofuIng!.modifier).toBe('firm');
  });

  it('chickpea stew — legume key is "chickpea", modifier is "canned"', async () => {
    const tavily = makeTavily([{ url: STEW_URL, rawContent: 'stew page text' }]);
    const openai = makeOpenAI([chickpeaStewExtractionJson()]);
    const vocab = makeVocabulary({ cuisine: ['mediterranean'], dietary: ['vegan'] });
    const agent = new RecipeAgent({ tavily: tavily.client, openai, vocabulary: vocab, logger: makeLogger() });
    const result = await agent.discover(discoverInput({ count: 1 }));
    expect(result.candidates).toHaveLength(1);
    const chickpeaIng = result.candidates[0]!.extraction.ingredients.find((i) => i.key === 'chickpea');
    expect(chickpeaIng).toBeDefined();
    expect(chickpeaIng!.modifier).toBe('canned');
  });
});
