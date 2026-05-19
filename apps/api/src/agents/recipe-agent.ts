import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import type { TavilyClient, TavilySearchResponse } from '@tavily/core';
import { RecipeAgentExtractionSchema } from '@hivekitchen/contracts';
import type {
  RecipeAgentExtraction,
  RecipeDiscoverInput,
  RecipeIngredient,
  RecipePreview,
} from '@hivekitchen/types';
import { renderRecipeAgentPrompt } from './prompts/recipe-agent.prompt.js';
import type { VocabularyService } from '../modules/vocabulary/vocabulary.service.js';

// Story 3-31 — RecipeAgent
//
// Stateless extractor: takes a structured discover request, calls Tavily,
// runs the LLM extraction prompt per result, validates the output, applies
// vocabulary + head-noun post-passes, and returns candidate payloads.
// Does NOT touch Redis, the DB, or the audit log — those concerns live in
// RecipeService.discover, which wraps this agent.

const ALLOWED_DOMAINS = ['allrecipes.com', 'recipetineats.com'] as const;
const LLM_MODEL = 'gpt-4o-mini'; // extraction, not creative generation
const LLM_TEMPERATURE = 0.1;     // deterministic-ish — same page → same shape
// F-P11: raised from 2000 to 4000 — a complex recipe (20 ingredients + 15
// steps) easily exceeds 2000 tokens of structured JSON, causing a truncated
// parse failure and silent candidate drop.
const LLM_MAX_TOKENS = 4000;

// Known base-food prefixes used by the head-noun normaliser. When the LLM
// emits a compound key like "chicken_thigh" instead of {key: chicken,
// modifier: thigh}, the normaliser splits it. Keep this list short and
// only add entries we observe in production drift — over-aggressive
// splitting risks breaking compound items that are genuinely a single
// product (taco_seasoning, garam_masala, etc.).
const KNOWN_BASE_PREFIXES = new Set([
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck',
  'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn',
  'tofu', 'tempeh', 'paneer', 'cheese',
  'rice', 'pasta', 'noodle', 'bread',
  'potato', 'tomato', 'onion', 'garlic',
  'yogurt', 'milk', 'cream', 'butter',
  'lentil', 'chickpea', 'bean',
  'apple', 'banana', 'lemon', 'lime', 'orange',
]);

export interface RecipeAgentDeps {
  readonly tavily: TavilyClient;
  readonly openai: OpenAI;
  readonly vocabulary: VocabularyService;
  readonly logger: FastifyBaseLogger;
}

export interface RecipeCandidate {
  readonly candidateId: string;
  readonly extraction: RecipeAgentExtraction;
  readonly preview: RecipePreview;
}

export interface RecipeAgentDiscoverResult {
  readonly candidates: RecipeCandidate[];
  /** Source-domain breakdown for audit logging. */
  readonly sourceSites: string[];
  /** Number of Tavily results that failed extraction (Zod parse, LLM
   *  returned non-JSON, missing required fields, etc.). Surfaced so the
   *  service wrapper can log a useful "discover returned fewer than
   *  requested" signal. */
  readonly droppedCount: number;
}

export class RecipeAgent {
  constructor(private readonly deps: RecipeAgentDeps) {}

  /**
   * Discover N candidate recipes from the public web, scoped to
   * Allrecipes + RecipeTin Eats. Returns validated, vocabulary-cleaned,
   * head-noun-normalised extractions ready for caching + persistence.
   */
  async discover(input: RecipeDiscoverInput): Promise<RecipeAgentDiscoverResult> {
    const query = buildTavilyQuery(input);

    // F-P5: wrap the Tavily call so a network error, rate-limit, or auth
    // failure returns empty candidates rather than crashing the planWeek run.
    let tavilyResponse: TavilySearchResponse;
    try {
      tavilyResponse = await this.deps.tavily.search(query, {
        searchDepth: 'advanced',
        includeDomains: [...ALLOWED_DOMAINS],
        maxResults: input.count,
        includeRawContent: 'text',
      });
    } catch (err) {
      this.deps.logger.warn(
        {
          module: 'recipes',
          action: 'discover.tavily_failed',
          household_id: input.household_id,
          error: err instanceof Error ? err.message : String(err),
        },
        'Tavily search failed — returning empty candidates; planner will fall back to recipe.search',
      );
      return { candidates: [], sourceSites: [], droppedCount: input.count };
    }

    const results = tavilyResponse.results ?? [];
    const systemPrompt = renderRecipeAgentPrompt({
      cuisineTags: this.activeKeys('cuisine'),
      culturalTags: this.activeKeys('cultural'),
      dietaryFlags: this.activeKeys('dietary'),
      allergenFlags: this.activeKeys('allergen'),
      // F-P10: thread allergen exclusions into the prompt so the LLM is aware
      // of household restrictions when flagging allergen_flags.
      allergenExclusions: input.constraints.allergen_exclusions,
    });

    const candidates: RecipeCandidate[] = [];
    const sourceSites = new Set<string>();
    let droppedCount = 0;

    for (const r of results) {
      const sourceUrl = typeof r.url === 'string' ? r.url : null;
      const rawContent = typeof r.rawContent === 'string' ? r.rawContent : null;
      if (sourceUrl === null || rawContent === null || rawContent.length === 0) {
        droppedCount += 1;
        continue;
      }
      const sourceSite = detectSourceSite(sourceUrl);
      if (sourceSite === null) {
        // Belt + suspenders against Tavily ignoring includeDomains.
        this.deps.logger.warn(
          {
            module: 'recipes',
            action: 'discover.source_site_unknown',
            household_id: input.household_id,
            source_url: sourceUrl,
          },
          'tavily returned a result outside the allowed domains — dropping',
        );
        droppedCount += 1;
        continue;
      }

      const extraction = await this.extractOne({
        systemPrompt,
        sourceUrl,
        sourceSite,
        rawContent,
        householdId: input.household_id,
      });

      if (extraction === null) {
        droppedCount += 1;
        continue;
      }

      const cleaned = this.applyPostPasses(extraction, input.household_id);

      const candidateId = randomUUID();
      candidates.push({
        candidateId,
        extraction: cleaned,
        preview: previewFromExtraction(candidateId, cleaned),
      });
      sourceSites.add(sourceSite);
    }

    return {
      candidates,
      sourceSites: [...sourceSites],
      droppedCount,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private activeKeys(category: 'cuisine' | 'cultural' | 'dietary' | 'allergen'): string[] {
    const snapshot = this.deps.vocabulary.snapshot();
    switch (category) {
      case 'cuisine':
        return snapshot.cuisine_tags.filter((t) => t.is_active).map((t) => t.key);
      case 'cultural':
        return snapshot.cultural_tags.filter((t) => t.is_active).map((t) => t.key);
      case 'dietary':
        return snapshot.dietary_tags.filter((t) => t.is_active).map((t) => t.key);
      case 'allergen':
        return snapshot.allergen_tags.filter((t) => t.is_active).map((t) => t.key);
    }
  }

  private async extractOne(input: {
    systemPrompt: string;
    sourceUrl: string;
    sourceSite: 'allrecipes' | 'recipetineats';
    rawContent: string;
    householdId: string;
  }): Promise<RecipeAgentExtraction | null> {
    const userMessage = [
      `SOURCE_URL: ${input.sourceUrl}`,
      `SOURCE_SITE: ${input.sourceSite}`,
      '',
      'PAGE TEXT:',
      input.rawContent,
    ].join('\n');

    let raw: string;
    try {
      const completion = await this.deps.openai.chat.completions.create({
        model: LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        max_tokens: LLM_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      this.deps.logger.warn(
        {
          module: 'recipes',
          action: 'extraction.llm_failed',
          household_id: input.householdId,
          source_url: input.sourceUrl,
          error: err instanceof Error ? err.message : String(err),
        },
        'recipe agent LLM call failed — dropping candidate',
      );
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.deps.logger.warn(
        {
          module: 'recipes',
          action: 'extraction.invalid_json',
          household_id: input.householdId,
          source_url: input.sourceUrl,
        },
        'recipe agent emitted non-JSON output — dropping candidate',
      );
      return null;
    }

    const result = RecipeAgentExtractionSchema.safeParse(parsedJson);
    if (!result.success) {
      this.deps.logger.warn(
        {
          module: 'recipes',
          action: 'extraction.parse_failed',
          household_id: input.householdId,
          source_url: input.sourceUrl,
          issues: result.error.issues.slice(0, 5).map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        'recipe agent output failed schema validation — dropping candidate',
      );
      return null;
    }
    return result.data;
  }

  /**
   * Apply both post-passes (vocabulary drop + head-noun normaliser) to a
   * validated extraction. Returns a NEW extraction object — does not
   * mutate the input.
   */
  private applyPostPasses(
    extraction: RecipeAgentExtraction,
    householdId: string,
  ): RecipeAgentExtraction {
    const vocab = this.deps.vocabulary;
    const logger = this.deps.logger;

    const cuisineFiltered = vocab.filterActive('cuisine', extraction.cuisine_tags);
    const culturalFiltered = vocab.filterActive('cultural', extraction.cultural_tags);
    const dietaryFiltered = vocab.filterActive('dietary', extraction.dietary_flags);
    const allergenFiltered = vocab.filterActive('allergen', extraction.allergen_flags);

    for (const dropped of cuisineFiltered.dropped) {
      logger.info({
        module: 'recipes', action: 'vocabulary.drop',
        household_id: householdId, tag_type: 'cuisine', dropped_value: dropped,
      }, 'recipe agent emitted unknown cuisine tag');
    }
    for (const dropped of culturalFiltered.dropped) {
      logger.info({
        module: 'recipes', action: 'vocabulary.drop',
        household_id: householdId, tag_type: 'cultural', dropped_value: dropped,
      }, 'recipe agent emitted unknown cultural tag');
    }
    for (const dropped of dietaryFiltered.dropped) {
      logger.info({
        module: 'recipes', action: 'vocabulary.drop',
        household_id: householdId, tag_type: 'dietary', dropped_value: dropped,
      }, 'recipe agent emitted unknown dietary flag');
    }
    for (const dropped of allergenFiltered.dropped) {
      logger.info({
        module: 'recipes', action: 'vocabulary.drop',
        household_id: householdId, tag_type: 'allergen', dropped_value: dropped,
      }, 'recipe agent emitted unknown allergen flag');
    }

    return {
      ...extraction,
      cuisine_tags: cuisineFiltered.kept,
      cultural_tags: culturalFiltered.kept,
      dietary_flags: dietaryFiltered.kept,
      allergen_flags: allergenFiltered.kept,
      ingredients: extraction.ingredients.map(normaliseIngredientHeadNoun),
    };
  }
}

// ---------------------------------------------------------------------------
// Module-scope helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Build the Tavily query string from a discover input.
 *
 * F-P10: allergen_exclusions are appended as negative terms so Tavily
 * de-prioritises results containing those allergens before the LLM
 * extraction step — reduces the number of candidates allergy.check
 * will block, cutting unnecessary planner retry loops.
 *
 * F-P11: "school lunch" scoping term added so Tavily biases toward
 * quick-prep, kid-friendly dishes rather than elaborate dinner recipes.
 * The product is a school-lunch planner; we should never surface a
 * 3-hour Sunday roast as a weekday candidate.
 */
export function buildTavilyQuery(input: RecipeDiscoverInput): string {
  const parts: string[] = [input.intent.trim(), 'school lunch recipe'];
  if (input.constraints.cuisine_tags.length > 0) {
    parts.push(input.constraints.cuisine_tags[0]!.replace(/_/g, ' '));
  }
  // Soft exclusions — Tavily treats leading "-" as a negative signal.
  for (const allergen of input.constraints.allergen_exclusions) {
    parts.push(`-${allergen.replace(/_/g, ' ')}`);
  }
  return parts.join(' ');
}

/** Identify the source site from a URL. Returns null when the host is not
 *  one of the allowed domains. */
export function detectSourceSite(url: string): 'allrecipes' | 'recipetineats' | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'allrecipes.com' || host.endsWith('.allrecipes.com')) {
      return 'allrecipes';
    }
    if (host === 'recipetineats.com' || host.endsWith('.recipetineats.com')) {
      return 'recipetineats';
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Split a compound ingredient key into (base, modifier) when:
 *   1. The key has the form "{prefix}_{rest}" with an underscore, AND
 *   2. The prefix matches a known base food, AND
 *   3. The current modifier is null (we don't override an explicit modifier).
 *
 *   { key: 'chicken_thigh', modifier: null } → { key: 'chicken', modifier: 'thigh' }
 *   { key: 'chicken',       modifier: 'thigh' } → unchanged
 *   { key: 'taco_seasoning', modifier: null } → unchanged ('taco' is not a known base)
 */
export function normaliseIngredientHeadNoun(ing: RecipeIngredient): RecipeIngredient {
  if (ing.modifier !== null) return ing;
  if (!ing.key.includes('_')) return ing;
  const [prefix, ...rest] = ing.key.split('_');
  if (prefix === undefined || rest.length === 0) return ing;
  if (!KNOWN_BASE_PREFIXES.has(prefix)) return ing;
  const modifier = rest.join('_');
  return { ...ing, key: prefix, modifier };
}

/** Build the lightweight preview returned in the tool response. Preview
 *  fields match RecipeSearchOutput so the planner agent treats discover
 *  and search results uniformly. */
function previewFromExtraction(
  candidateId: string,
  extraction: RecipeAgentExtraction,
): RecipePreview {
  const primaryKey = extraction.ingredients[0]?.key ?? null;
  return {
    id: candidateId,
    name: extraction.name,
    primary_ingredient_key: primaryKey,
    cuisine_tags: extraction.cuisine_tags,
    allergen_flags: extraction.allergen_flags,
    dietary_flags: extraction.dietary_flags,
    prep_time_minutes: extraction.prep_time_minutes,
  };
}
