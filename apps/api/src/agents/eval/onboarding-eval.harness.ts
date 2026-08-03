import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import type { ChipConfig, ChipOption } from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
import type { TurnBody } from '@hivekitchen/types';
import { OnboardingAgent } from '../onboarding.agent.js';
import { OpenAIAdapter } from '../providers/openai.adapter.js';
import {
  OnboardingService,
  type OnboardingServiceDeps,
  type SubmitTextTurnResult,
  type OnboardingStateResult,
} from '../../modules/onboarding/onboarding.service.js';
import type {
  CurrentMoment,
  MomentState,
  RequiredSetStatus,
} from '../../modules/onboarding/onboarding-moment.repository.js';
import type { ThreadRow, TurnRow } from '../../modules/threads/thread.repository.js';

// ===========================================================================
// Story 2.7-s1 — Onboarding golden-set eval harness.
// ===========================================================================
// Deterministic, no-network driver for OnboardingService.submitTextTurn (the
// behaviour Epic 2.7 inverts in slices s6/s7). Mirrors the planner golden
// harness (3.5-s1): a fake LLM (here, a mocked OpenAI client) replays a
// scenario's recorded responses turn-by-turn so the harness exercises the REAL
// pieces that the inversion will touch:
//   - the REAL OnboardingAgent tool-call loop (dispatch + JSON-error recovery),
//   - the REAL OnboardingService FSM: [NEXT_MOMENT:] directive parsing, the
//     pre_start→m1_table bootstrap, kitchen-map re-anchoring, the M3/M4
//     chip-only auto-advance safety nets, the required-set gate, finalize,
//   - the REAL onboarding tool specs (Zod arg validation per tool),
// all wired against in-memory fakes for the DB-backed repos/services.
//
// THE DETERMINISM CONTRACT (critical — read before adding a scenario):
//   Onboarding turns produce non-deterministic conversational PROSE. A
//   byte-stable eval can ONLY assert STRUCTURED OUTCOMES:
//     1. moment transitions  — the current_moment sequence across turns,
//     2. slot fills          — the resulting Kitchen Map / moment-state (the
//        in-memory store contents: children, allergens, dietary/cuisine, bag
//        composition, starting-line favourites, the onboarding_moment_state),
//     3. tool calls fired    — each tool name + the args the model emitted
//        (their validity is corroborated by the slot fills they produce).
//   The harness NEVER asserts the assistant's wording. Later slices (s5 chip
//   templates, s7 prompt changes) will legitimately change prose; an eval that
//   pinned prose would produce false failures. To regenerate goldens, run the
//   scenario, capture `runScenario(...).outcome`, and diff-review it in the PR.
// ===========================================================================

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
// Fixed timestamp — no Date.now() anywhere in the harness (parity with the
// planner harness; keeps any time-derived value deterministic).
const FIXED_TS = '2026-01-01T00:00:00.000Z';
const HOUSEHOLD_SCOPE = '__household__';

// Deterministic id generator — counter-based, reset per scenario. Generated
// ids never appear in goldens (slot fills resolve child_id → child name), so
// the exact scheme is irrelevant to the assertions; it only has to be a
// schema-valid uuid the tool output schemas accept.
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
}

function makeLogger(): FastifyBaseLogger {
  const noop = (): undefined => undefined;
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'silent',
    child(): FastifyBaseLogger { return logger as unknown as FastifyBaseLogger; },
  };
  return logger as unknown as FastifyBaseLogger;
}

// ---- Scenario authoring shapes --------------------------------------------

/** One recorded LLM emission inside a turn's tool-call loop. Intermediate
 *  steps carry tool calls (finishReason 'tool_calls'); the final step carries
 *  prose with finishReason 'stop' so the agent loop returns. */
interface LlmStep {
  content?: string | null;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  finishReason?: 'stop' | 'tool_calls';
}

interface ScenarioTurn {
  /** The message string passed to submitTextTurn (free text or a
   *  `[Chips selected: ...]` header — exactly what the route would forward). */
  userInput: string;
  /** The model's emissions for THIS turn, replayed in order. */
  llmSteps: LlmStep[];
  /** Verdict the mocked isSummaryConfirmed classifier returns this turn.
   *  Defaults to 'no'. */
  summaryConfirmed?: 'yes' | 'no';
}

/** Pre-seeded store state for scenarios that model a resumed/reset interview
 *  whose moment-state row is missing but whose kitchen-map data exists (the
 *  re-anchoring safety net). */
interface ScenarioSeed {
  householdName?: string;
  children?: Array<{ name: string; ageBand: AgeBand }>;
  /** child-scoped allergens (drives child_allergen_count > 0). */
  childAllergens?: Array<{ childName: string; allergen: string }>;
  favorites?: string[];
}

interface M5ProjectionFixture {
  chips: ChipOption[];
  coldStartReason: string | null;
  /** isStage1Complete return. Defaults to true so the projection runs. */
  stage1Complete?: boolean;
}

export interface Scenario {
  id: string;
  description: string;
  seed?: ScenarioSeed;
  turns: ScenarioTurn[];
  /** When set, wires the CatalogProjectionService mock (AC4 — fixed M5
   *  fixture). */
  m5Projection?: M5ProjectionFixture;
  /** extractSummary stub result used by the finalize path. */
  extractSummary?: {
    cultural_templates: string[];
    palate_notes: string[];
    allergens_mentioned: string[];
    family_rhythms: string[];
  };
  /** Call finalizeTextOnboarding after the turns. */
  finalize?: boolean;
  /** Call getState after the turns (resume read). */
  resume?: boolean;
  /** Call resetState (then getState) after the turns. */
  reset?: boolean;
  /** Expected number of fire-and-forget catalog-seed enqueues (m2_safe exit).
   *  The enqueue payload carries a non-deterministic request_id, so the eval
   *  asserts the COUNT + household_id, never the payload verbatim. Default 0. */
  expectedCatalogSeedCount?: number;
}

type AgeBand = 'toddler' | 'child' | 'preteen' | 'teen';

// ---- Structured outcome (the golden record shape) -------------------------

interface CapturedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ScenarioOutcome {
  /** result.moment_key after each turn, in order. */
  momentSequence: Array<string | null>;
  /** Every tool call the agent fired, in dispatch order (name + emitted
   *  args). Validity is corroborated by the slot fills below. */
  toolCalls: CapturedToolCall[];
  /** The resulting Kitchen Map / moment-state — the slot fills. child_id is
   *  resolved to the child's name (or '__household__') so goldens are id-free
   *  and readable. */
  finalSlots: {
    household: {
      display_name: string | null;
      cultural_identifiers: string[];
      dietary_preferences: string[];
      declared_allergens: string[];
    };
    children: Array<{
      name: string;
      age_band: string;
      bag_composition_pattern: string | null;
      declared_allergens: string[];
      dietary_preferences: string[];
      cultural_identifiers: string[];
    }>;
    allergens: Array<{ scope: string; allergen: string }>;
    dietary: Array<{ scope: string; tag: string; enforcement: string }>;
    culturalPriors: Array<{ key: string; enforcement: string }>;
    foodPreferences: Array<{ scope: string; item: string; valence: string; enforcement: string }>;
    rules: Array<{ rule_type: string; custom_label: string | null; enforcement: string }>;
    favorites: string[];
  };
  /** Final persisted onboarding_moment_state (null if never written). */
  momentState: {
    current_moment: CurrentMoment;
    required_set_status: RequiredSetStatus;
    cold_start_triggered: boolean;
    cold_start_trigger_reason: string | null;
  } | null;
  /** Selected fields from the LAST turn's response (deterministic only). */
  lastTurn: {
    chip_config: ChipConfig | null;
    required_set_complete: boolean | null;
    missing_required_set: string[];
    cold_start_mode: boolean;
    is_complete: boolean;
  } | null;
  /** Present when scenario.finalize. */
  finalize?:
    | { ok: true; summary: Scenario['extractSummary'] }
    | { ok: false; error: string };
  /** Present when scenario.resume or scenario.reset. */
  state?: {
    status: OnboardingStateResult['status'];
    current_moment: string | null;
    turn_count: number;
  };
}

// ===========================================================================
// In-memory fakes
// ===========================================================================

interface Stores {
  household: {
    display_name: string | null;
    cultural_identifiers: string[];
    dietary_preferences: string[];
    declared_allergens: string[];
  };
  children: Map<string, {
    id: string;
    name: string;
    age_band: AgeBand;
    declared_allergens: string[];
    cultural_identifiers: string[];
    dietary_preferences: string[];
    bag_composition_pattern: string | null;
  }>;
  allergens: Array<{ child_id: string | null; allergen: string; source: string }>;
  dietary: Array<{ child_id: string | null; tag: string; enforcement: string; source: string }>;
  culturalPriors: Map<string, { id: string; key: string; label: string; enforcement: string }>;
  foodPreferences: Array<{ child_id: string | null; item: string; valence: string; enforcement: string; source: string }>;
  rules: Array<{ rule_type: string; custom_label: string | null; enforcement: string; source: string }>;
  favorites: Array<{ id: string; name: string }>;
  memory: Array<{ node_type: string; facet: string; subject_child_id: string | null }>;
  momentState: MomentState | null;
  threads: ThreadRow[];
  turns: TurnRow[];
}

function freshStores(): Stores {
  return {
    household: {
      display_name: null,
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    children: new Map(),
    allergens: [],
    dietary: [],
    culturalPriors: new Map(),
    foodPreferences: [],
    rules: [],
    favorites: [],
    memory: [],
    momentState: null,
    threads: [],
    turns: [],
  };
}

function childKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function resolveScope(stores: Stores, childId: string | null): string {
  if (childId === null) return HOUSEHOLD_SCOPE;
  for (const c of stores.children.values()) {
    if (c.id === childId) return c.name;
  }
  // A non-null child_id that resolves to no child is a real defect — never
  // normalize it to household scope, or the harness would silently mask a
  // mis-attributed allergen (the exact bug the scope assertions exist to catch).
  throw new Error(
    `resolveScope: child_id ${childId} does not resolve to any seeded child — a child-scoped row was attributed to a nonexistent child`,
  );
}

function seedStores(stores: Stores, seed: ScenarioSeed): void {
  if (seed.householdName !== undefined) {
    stores.household.display_name = seed.householdName;
  }
  for (const child of seed.children ?? []) {
    const id = nextId();
    stores.children.set(childKey(child.name), {
      id,
      name: child.name,
      age_band: child.ageBand,
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      bag_composition_pattern: null,
    });
  }
  for (const a of seed.childAllergens ?? []) {
    const child = stores.children.get(childKey(a.childName));
    if (child === undefined) {
      // Fail loud on an authoring typo rather than minting a phantom id that
      // would later silently collapse to household scope in the golden.
      throw new Error(
        `seedStores: childAllergens references unknown child "${a.childName}" — no matching seeded child`,
      );
    }
    stores.allergens.push({
      child_id: child.id,
      allergen: a.allergen,
      source: 'onboarding_declared',
    });
  }
  for (const item of seed.favorites ?? []) {
    stores.favorites.push({ id: nextId(), name: item });
  }
}

// A minimal but structurally complete VocabularyService stand-in. Only the
// methods the onboarding tools + renderVocabularyBlock call are implemented;
// validate* throw on unknown keys exactly like the real service so an invalid
// agent-emitted tag surfaces as a tool error (and a missing slot fill).
const KNOWN_ALLERGENS = new Set([
  'peanut', 'tree_nut', 'dairy', 'egg', 'soy', 'wheat', 'fish', 'shellfish', 'sesame',
]);
const ALLERGEN_ALIASES = new Map<string, string>([['groundnut', 'peanut'], ['milk', 'dairy']]);
const KNOWN_DIETARY = new Set([
  'halal', 'kosher', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free',
]);
const KNOWN_CULTURAL = new Set([
  'south_asian', 'east_african', 'caribbean', 'levantine', 'malayali',
]);
const KNOWN_CUISINE = new Set([
  'south_indian', 'north_indian', 'east_african', 'caribbean', 'levantine',
  'italian', 'mexican', 'japanese', 'chinese', 'mediterranean',
]);

function makeVocabularyFake(): OnboardingServiceDeps['vocabularyService'] {
  function validate(set: Set<string>, label: string, keys: readonly string[]): string[] {
    for (const k of keys) {
      if (!set.has(k)) throw new Error(`Unknown or inactive ${label} tag: ${k}`);
    }
    return [...new Set(keys)];
  }
  return {
    resolveAllergen: (input: string): string | undefined =>
      KNOWN_ALLERGENS.has(input) ? input : ALLERGEN_ALIASES.get(input),
    isActive: (category: string, key: string): boolean => {
      if (category === 'allergen') return KNOWN_ALLERGENS.has(key);
      if (category === 'dietary') return KNOWN_DIETARY.has(key);
      if (category === 'cultural') return KNOWN_CULTURAL.has(key);
      if (category === 'cuisine') return KNOWN_CUISINE.has(key);
      return false;
    },
    validateCultural: (keys: readonly string[]): string[] => validate(KNOWN_CULTURAL, 'cultural', keys),
    validateDietary: (keys: readonly string[]): string[] => validate(KNOWN_DIETARY, 'dietary', keys),
    validateCuisine: (keys: readonly string[]): string[] => validate(KNOWN_CUISINE, 'cuisine', keys),
    // Identity expansion — keeps slot fills equal to the tag the model emitted
    // (the implies graph is exercised by the vocabulary service's own tests).
    expandImpliesClosure: (keys: readonly string[]): string[] => [...new Set(keys)],
    snapshot: () => ({
      allergen_tags: [],
      dietary_tags: [],
      cultural_tags: [],
      cuisine_tags: [],
      loaded_at: FIXED_TS,
    }),
  } as unknown as OnboardingServiceDeps['vocabularyService'];
}

function makeKitchenMapFake(stores: Stores): OnboardingServiceDeps['kitchenMapService'] {
  return {
    get: async (): Promise<KitchenMap> => {
      const map = {
        household: {
          display_name: stores.household.display_name,
          tier: 'free',
          timezone: 'UTC',
          cultural_identifiers: stores.household.cultural_identifiers,
          dietary_preferences: stores.household.dietary_preferences,
          declared_allergens: stores.household.declared_allergens,
        },
        caregivers: [],
        children: [...stores.children.values()].map((c) => ({
          id: c.id,
          name: c.name,
          age_band: c.age_band,
          bag_composition_pattern: c.bag_composition_pattern,
          declared_allergens: c.declared_allergens,
          cultural_identifiers: c.cultural_identifiers,
          dietary_preferences: c.dietary_preferences,
          school_policies: [],
        })),
        cultural: { active: [], suggested: [...stores.culturalPriors.values()].map((p) => ({ key: p.key })) },
        memory: { nodes: stores.memory.map((n) => ({ node_type: n.node_type, facet: n.facet, prose_text: '', subject_child_id: n.subject_child_id })) },
        allergens: stores.allergens.map((a) => ({ child_id: a.child_id, allergen: a.allergen, source: a.source })),
        dietary: stores.dietary.map((d) => ({ child_id: d.child_id, tag: d.tag, enforcement: d.enforcement })),
        food_preferences: stores.foodPreferences.map((fp) => ({ child_id: fp.child_id, item: fp.item, valence: fp.valence, enforcement: fp.enforcement })),
        favorite_lunches: stores.favorites.map((f, i) => ({ item: f.name, position: i })),
        rules: stores.rules.map((r) => ({ rule_type: r.rule_type, custom_label: r.custom_label, enforcement: r.enforcement })),
        meta: { is_complete: false, required_set_complete: false },
      };
      return map as unknown as KitchenMap;
    },
  } as unknown as OnboardingServiceDeps['kitchenMapService'];
}

function makeThreadsFake(stores: Stores): OnboardingServiceDeps['threads'] {
  function activeThread(): ThreadRow | null {
    return stores.threads.find((t) => t.status === 'active' && t.type === 'onboarding') ?? null;
  }
  return {
    findActiveThreadByHousehold: async (): Promise<ThreadRow | null> => activeThread(),
    findClosedThreadByHousehold: async (): Promise<ThreadRow | null> =>
      stores.threads.find((t) => t.status === 'closed' && t.type === 'onboarding') ?? null,
    createThread: async (
      householdId: string,
      type: string,
      modality: 'text' | 'voice',
    ): Promise<ThreadRow> => {
      const row: ThreadRow = {
        id: THREAD_ID,
        household_id: householdId,
        type,
        status: 'active',
        modality,
        created_at: FIXED_TS,
      };
      stores.threads.push(row);
      return row;
    },
    listTurns: async (threadId: string): Promise<TurnRow[]> =>
      stores.turns.filter((t) => t.thread_id === threadId),
    appendTurnNext: async (params: {
      threadId: string;
      role: 'user' | 'lumi' | 'system';
      body: TurnBody;
      modality: 'text' | 'voice';
    }): Promise<TurnRow> => {
      const seq = stores.turns.filter((t) => t.thread_id === params.threadId).length + 1;
      const row: TurnRow = {
        id: nextId(),
        thread_id: params.threadId,
        server_seq: seq,
        role: params.role,
        body: params.body,
        modality: params.modality,
        created_at: FIXED_TS,
      };
      stores.turns.push(row);
      return row;
    },
    closeThread: async (threadId: string): Promise<void> => {
      const t = stores.threads.find((x) => x.id === threadId);
      if (t !== undefined) t.status = 'closed';
    },
  } as unknown as OnboardingServiceDeps['threads'];
}

function makeMomentRepoFake(
  stores: Stores,
  upserts: MomentState[],
): OnboardingServiceDeps['momentRepository'] {
  return {
    getState: async (): Promise<MomentState | null> => stores.momentState,
    countRequiredSetSources: async (): Promise<{
      household_name_set: boolean;
      child_count: number;
      child_allergen_count: number;
      favorite_lunch_count: number;
    }> => ({
      household_name_set:
        typeof stores.household.display_name === 'string' &&
        stores.household.display_name.trim().length > 0,
      child_count: stores.children.size,
      child_allergen_count: stores.allergens.filter((a) => a.child_id !== null).length,
      favorite_lunch_count: stores.favorites.length,
    }),
    upsertState: async (
      _householdId: string,
      update: {
        current_moment: CurrentMoment;
        required_set_status: RequiredSetStatus;
        cold_start_triggered?: boolean;
        cold_start_trigger_reason?: string | null;
      },
    ): Promise<void> => {
      const next: MomentState = {
        current_moment: update.current_moment,
        required_set_status: update.required_set_status,
        cold_start_triggered:
          update.cold_start_triggered ?? stores.momentState?.cold_start_triggered ?? false,
        cold_start_trigger_reason:
          update.cold_start_trigger_reason ??
          stores.momentState?.cold_start_trigger_reason ??
          null,
      };
      stores.momentState = next;
      upserts.push(next);
    },
  } as unknown as OnboardingServiceDeps['momentRepository'];
}

function makeChildrenServiceFake(stores: Stores): OnboardingServiceDeps['childrenService'] {
  return {
    upsertByName: async (input: {
      householdId: string;
      body: {
        name: string;
        age_band: AgeBand;
        declared_allergens?: string[];
        cultural_identifiers?: string[];
        dietary_preferences?: string[];
        bag_composition_pattern?: string | null;
      };
    }): Promise<{ child: { id: string; name: string }; was_existing: boolean }> => {
      const key = childKey(input.body.name);
      const existing = stores.children.get(key);
      if (existing !== undefined) {
        // PATCH merge — undefined preserves; explicit arrays/values overwrite.
        if (input.body.age_band !== undefined) existing.age_band = input.body.age_band;
        if (input.body.declared_allergens !== undefined) existing.declared_allergens = input.body.declared_allergens;
        if (input.body.cultural_identifiers !== undefined) existing.cultural_identifiers = input.body.cultural_identifiers;
        if (input.body.dietary_preferences !== undefined) existing.dietary_preferences = input.body.dietary_preferences;
        if (input.body.bag_composition_pattern !== undefined) {
          existing.bag_composition_pattern = input.body.bag_composition_pattern ?? null;
        }
        return { child: { id: existing.id, name: existing.name }, was_existing: true };
      }
      const id = nextId();
      stores.children.set(key, {
        id,
        name: input.body.name,
        age_band: input.body.age_band,
        declared_allergens: input.body.declared_allergens ?? [],
        cultural_identifiers: input.body.cultural_identifiers ?? [],
        dietary_preferences: input.body.dietary_preferences ?? [],
        bag_composition_pattern: input.body.bag_composition_pattern ?? null,
      });
      return { child: { id, name: input.body.name }, was_existing: false };
    },
    findChildIdByName: async (_householdId: string, name: string): Promise<string | null> =>
      stores.children.get(childKey(name))?.id ?? null,
    getChild: async (input: { householdId: string; childId: string }): Promise<{ id: string }> => {
      for (const c of stores.children.values()) {
        if (c.id === input.childId) return { id: c.id };
      }
      throw new Error('Child not found');
    },
  } as unknown as OnboardingServiceDeps['childrenService'];
}

function makeCulturalPriorRepoFake(stores: Stores): OnboardingServiceDeps['culturalPriorRepository'] {
  return {
    noteSuggested: async (
      _householdId: string,
      input: { key: string; label: string; enforcement: string },
    ): Promise<{ id: string; was_existing: boolean }> => {
      const existing = stores.culturalPriors.get(input.key);
      if (existing !== undefined) {
        existing.enforcement = input.enforcement;
        return { id: existing.id, was_existing: true };
      }
      const id = nextId();
      stores.culturalPriors.set(input.key, { id, key: input.key, label: input.label, enforcement: input.enforcement });
      return { id, was_existing: false };
    },
    findByHousehold: async (): Promise<Array<{ key: string }>> =>
      [...stores.culturalPriors.values()].map((p) => ({ key: p.key })),
  } as unknown as OnboardingServiceDeps['culturalPriorRepository'];
}

function makeHouseholdsServiceFake(stores: Stores): OnboardingServiceDeps['householdsService'] {
  return {
    setDisplayName: async (_householdId: string, name: string): Promise<void> => {
      stores.household.display_name = name;
    },
    patchProfile: async (
      _householdId: string,
      patch: {
        cultural_identifiers?: string[];
        dietary_preferences?: string[];
        declared_allergens?: string[];
      },
    ): Promise<{ id: string; cultural_identifiers: string[]; dietary_preferences: string[]; declared_allergens: string[] }> => {
      if (patch.cultural_identifiers !== undefined) stores.household.cultural_identifiers = patch.cultural_identifiers;
      if (patch.dietary_preferences !== undefined) stores.household.dietary_preferences = patch.dietary_preferences;
      if (patch.declared_allergens !== undefined) stores.household.declared_allergens = patch.declared_allergens;
      return {
        id: HOUSEHOLD_ID,
        cultural_identifiers: stores.household.cultural_identifiers,
        dietary_preferences: stores.household.dietary_preferences,
        declared_allergens: stores.household.declared_allergens,
      };
    },
    addAllergens: async (
      _householdId: string,
      add: string[],
      extra: { cultural_identifiers?: string[]; dietary_preferences?: string[] },
    ): Promise<{ id: string; cultural_identifiers: string[]; dietary_preferences: string[]; declared_allergens: string[] }> => {
      stores.household.declared_allergens = [...new Set([...stores.household.declared_allergens, ...add])];
      if (extra.cultural_identifiers !== undefined) stores.household.cultural_identifiers = extra.cultural_identifiers;
      if (extra.dietary_preferences !== undefined) stores.household.dietary_preferences = extra.dietary_preferences;
      return {
        id: HOUSEHOLD_ID,
        cultural_identifiers: stores.household.cultural_identifiers,
        dietary_preferences: stores.household.dietary_preferences,
        declared_allergens: stores.household.declared_allergens,
      };
    },
  } as unknown as OnboardingServiceDeps['householdsService'];
}

function makeMemoryServiceFake(stores: Stores): OnboardingServiceDeps['memoryService'] {
  return {
    noteFromAgent: async (input: {
      nodeType: string;
      facet: string;
      subjectChildId: string | null;
    }): Promise<{ node_id: string; created_at: string }> => {
      stores.memory.push({ node_type: input.nodeType, facet: input.facet, subject_child_id: input.subjectChildId });
      return { node_id: nextId(), created_at: FIXED_TS };
    },
    seedFromOnboarding: async (): Promise<{ nodeCount: number }> => ({ nodeCount: 0 }),
  } as unknown as OnboardingServiceDeps['memoryService'];
}

function makeChildAllergensRepoFake(stores: Stores): OnboardingServiceDeps['childAllergensRepository'] {
  return {
    declare: async (
      _householdId: string,
      childId: string,
      allergen: string,
      source: string,
    ): Promise<{ child_allergen_id: string; was_existing: boolean }> => {
      const dup = stores.allergens.some((a) => a.child_id === childId && a.allergen === allergen);
      if (!dup) stores.allergens.push({ child_id: childId, allergen, source });
      return { child_allergen_id: nextId(), was_existing: dup };
    },
  } as unknown as OnboardingServiceDeps['childAllergensRepository'];
}

function makeHouseholdAllergensRepoFake(stores: Stores): OnboardingServiceDeps['householdAllergensRepository'] {
  return {
    declareIfNew: async (input: {
      household_id: string;
      child_id: string | null;
      allergen: string;
      source: string;
    }): Promise<{ inserted: boolean }> => {
      const dup = stores.allergens.some((a) => a.child_id === input.child_id && a.allergen === input.allergen);
      if (!dup) stores.allergens.push({ child_id: input.child_id, allergen: input.allergen, source: input.source });
      return { inserted: !dup };
    },
    findByHouseholdId: async (): Promise<Array<{ allergen: string }>> =>
      stores.allergens.map((a) => ({ allergen: a.allergen })),
  } as unknown as OnboardingServiceDeps['householdAllergensRepository'];
}

function makeDietaryRepoFake(stores: Stores): OnboardingServiceDeps['dietaryPreferencesRepository'] {
  return {
    declare: async (
      _householdId: string,
      childId: string | null,
      tag: string,
      enforcement: string,
      source: string,
    ): Promise<{ dietary_id: string; was_existing: boolean }> => {
      const dup = stores.dietary.some((d) => d.child_id === childId && d.tag === tag);
      if (!dup) stores.dietary.push({ child_id: childId, tag, enforcement, source });
      return { dietary_id: nextId(), was_existing: dup };
    },
    findByHouseholdId: async (): Promise<Array<{ tag: string; enforcement: string }>> =>
      stores.dietary.map((d) => ({ tag: d.tag, enforcement: d.enforcement })),
  } as unknown as OnboardingServiceDeps['dietaryPreferencesRepository'];
}

function makeFoodPrefsRepoFake(stores: Stores): OnboardingServiceDeps['foodPreferencesRepository'] {
  return {
    declare: async (
      _householdId: string,
      childId: string | null,
      item: string,
      valence: string,
      enforcement: string,
      source: string,
    ): Promise<{ food_preference_id: string; was_existing: boolean }> => {
      stores.foodPreferences.push({ child_id: childId, item, valence, enforcement, source });
      return { food_preference_id: nextId(), was_existing: false };
    },
  } as unknown as OnboardingServiceDeps['foodPreferencesRepository'];
}

function makeRulesRepoFake(stores: Stores): OnboardingServiceDeps['householdRulesRepository'] {
  return {
    declare: async (
      _householdId: string,
      ruleType: string,
      customLabel: string | null,
      enforcement: string,
      source: string,
    ): Promise<{ household_rule_id: string; was_existing: boolean }> => {
      const dup = stores.rules.some((r) => r.rule_type === ruleType && r.custom_label === customLabel);
      if (!dup) stores.rules.push({ rule_type: ruleType, custom_label: customLabel, enforcement, source });
      return { household_rule_id: nextId(), was_existing: dup };
    },
  } as unknown as OnboardingServiceDeps['householdRulesRepository'];
}

function makeRecipesRepoFake(stores: Stores): OnboardingServiceDeps['recipesRepository'] {
  return {
    declareForHousehold: async (
      _householdId: string,
      item: string,
    ): Promise<{ recipeId: string; recipeWasInserted: boolean; usageWasExisting: boolean }> => {
      const existing = stores.favorites.find((f) => f.name.trim().toLocaleLowerCase() === item.trim().toLocaleLowerCase());
      if (existing !== undefined) {
        return { recipeId: existing.id, recipeWasInserted: false, usageWasExisting: true };
      }
      const id = nextId();
      stores.favorites.push({ id, name: item });
      return { recipeId: id, recipeWasInserted: true, usageWasExisting: false };
    },
    countDeclaredFavorites: async (): Promise<number> => stores.favorites.length,
    findById: async (id: string): Promise<{ canonical_name: string } | null> => {
      const f = stores.favorites.find((x) => x.id === id);
      return f !== undefined ? { canonical_name: f.name } : null;
    },
  } as unknown as OnboardingServiceDeps['recipesRepository'];
}

function makeCulturalPriorServiceFake(): OnboardingServiceDeps['culturalPriorService'] {
  return {
    inferFromSummary: async (): Promise<void> => undefined,
  } as unknown as OnboardingServiceDeps['culturalPriorService'];
}

function makeCatalogProjectionFake(
  fixture: M5ProjectionFixture | undefined,
): OnboardingServiceDeps['catalogProjection'] | undefined {
  if (fixture === undefined) return undefined;
  return {
    getM5Chips: async (): Promise<{ chips: ChipOption[]; coldStartReason: string | null }> => ({
      chips: fixture.chips,
      coldStartReason: fixture.coldStartReason,
    }),
    isStage1Complete: async (): Promise<boolean> => fixture.stage1Complete ?? true,
  } as unknown as OnboardingServiceDeps['catalogProjection'];
}

interface CatalogSeedQueueFake {
  calls: Array<{ jobName: string; payload: unknown }>;
  queue: OnboardingServiceDeps['catalogSeedQueue'];
}

function makeCatalogSeedQueueFake(): CatalogSeedQueueFake {
  const calls: Array<{ jobName: string; payload: unknown }> = [];
  const queue = {
    add: async (jobName: string, payload: unknown): Promise<void> => {
      calls.push({ jobName, payload });
    },
  } as unknown as OnboardingServiceDeps['catalogSeedQueue'];
  return { calls, queue };
}

// ===========================================================================
// Deterministic OpenAI mock
// ===========================================================================
// Dispatches by request shape: a request carrying `tools` is an
// OnboardingAgent tool-loop call → replay the next scenario step. Otherwise
// the request is one of the agent's classifier/extraction calls, identified by
// its system-prompt marker. The tool-loop queue is a flat list spanning all
// turns, consumed in order (FakeLLMProvider parity) — an underflow means the
// scenario provided too few steps for the loops the real agent ran.

function toOpenAIToolName(internal: string): string {
  return internal.replace(/\./g, '__');
}

class OpenAIMock {
  // Public so runScenario's step-consumption guard can assert every declared
  // LLM step was consumed (was private — flagged as the 2.7-s1 tsc baseline).
  cursor = 0;
  readonly consumed: LlmStep[] = [];
  currentSummaryVerdict: 'yes' | 'no' = 'no';

  constructor(
    private readonly steps: readonly LlmStep[],
    private readonly extractSummary: Scenario['extractSummary'],
  ) {}

  get client(): OpenAI {
    const create = async (req: {
      messages: Array<{ content?: string | null }>;
      tools?: unknown;
    }): Promise<unknown> => this.create(req);
    return { chat: { completions: { create } } } as unknown as OpenAI;
  }

  private create(req: { messages: Array<{ content?: string | null }>; tools?: unknown }): unknown {
    if (req.tools !== undefined) return this.toolLoopResponse();
    const sys = req.messages[0]?.content ?? '';
    if (sys.includes('Reply with exactly one word')) {
      return { choices: [{ message: { content: this.currentSummaryVerdict } }] };
    }
    if (sys.includes('Extract structured onboarding data')) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(
                this.extractSummary ?? {
                  cultural_templates: [],
                  palate_notes: [],
                  allergens_mentioned: [],
                  family_rhythms: [],
                },
              ),
            },
          },
        ],
      };
    }
    if (sys.includes('Infer cultural template priors')) {
      return { choices: [{ message: { content: JSON.stringify({ priors: [] }) } }] };
    }
    // The non-tool branches above route on production prompt-text substrings. If
    // none match, a prompt reword (e.g. s7) has drifted past these markers —
    // throw rather than return canned prose, which would silently feed the
    // default verdict/extraction downstream and surface as a confusing golden
    // mismatch instead of a clear "the mock no longer recognizes this prompt".
    throw new Error(
      `OpenAIMock: unrecognized non-tool request — system prompt did not match any known marker (prompt-marker drift?). First 120 chars: ${sys.slice(0, 120)}`,
    );
  }

  private toolLoopResponse(): unknown {
    const step = this.steps[this.cursor];
    if (step === undefined) {
      throw new Error(
        `OpenAIMock exhausted after ${String(this.cursor)} tool-loop steps — scenario provided too few LLM responses`,
      );
    }
    this.cursor += 1;
    this.consumed.push(step);
    const toolCalls = step.toolCalls ?? [];
    const finishReason = step.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop');
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: step.content ?? null,
            tool_calls:
              toolCalls.length > 0
                ? toolCalls.map((tc, i) => ({
                    id: `call_${String(this.cursor)}_${String(i)}`,
                    type: 'function' as const,
                    function: {
                      name: toOpenAIToolName(tc.name),
                      arguments: JSON.stringify(tc.args),
                    },
                  }))
                : undefined,
          },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    };
  }
}

// ===========================================================================
// Runner
// ===========================================================================

export interface RunResult {
  outcome: ScenarioOutcome;
  /** Catalog-seed enqueue calls captured at the m2_safe exit. */
  catalogSeedCalls: Array<{ jobName: string; payload: unknown }>;
}

export async function runScenario(scenario: Scenario): Promise<RunResult> {
  idCounter = 0;
  const stores = freshStores();
  if (scenario.seed !== undefined) seedStores(stores, scenario.seed);

  const upserts: MomentState[] = [];
  const allSteps: LlmStep[] = scenario.turns.flatMap((t) => t.llmSteps);
  const mock = new OpenAIMock(allSteps, scenario.extractSummary);
  // Slice 2.7-s4 — the agent talks to the LLMProvider seam; wrapping the
  // OpenAI-shaped mock in the real OpenAIAdapter keeps the scenario scripting at
  // the chat.completions.create boundary intact while exercising the production
  // adapter (tier resolution, strict-tool serialization, name encoding).
  const agent = new OnboardingAgent(new OpenAIAdapter(mock.client));
  const seedQueue = makeCatalogSeedQueueFake();

  const deps: OnboardingServiceDeps = {
    threads: makeThreadsFake(stores),
    agent,
    culturalPriorService: makeCulturalPriorServiceFake(),
    logger: makeLogger(),
    memoryService: makeMemoryServiceFake(stores),
    childrenService: makeChildrenServiceFake(stores),
    culturalPriorRepository: makeCulturalPriorRepoFake(stores),
    householdsService: makeHouseholdsServiceFake(stores),
    kitchenMapService: makeKitchenMapFake(stores),
    vocabularyService: makeVocabularyFake(),
    agentToolsEnabled: true,
    momentRepository: makeMomentRepoFake(stores, upserts),
    childAllergensRepository: makeChildAllergensRepoFake(stores),
    dietaryPreferencesRepository: makeDietaryRepoFake(stores),
    foodPreferencesRepository: makeFoodPrefsRepoFake(stores),
    householdRulesRepository: makeRulesRepoFake(stores),
    recipesRepository: makeRecipesRepoFake(stores),
    catalogSeedQueue: seedQueue.queue,
    catalogProjection: makeCatalogProjectionFake(scenario.m5Projection),
    householdAllergensRepository: makeHouseholdAllergensRepoFake(stores),
  };

  const service = new OnboardingService(deps);

  const momentSequence: Array<string | null> = [];
  let lastResult: SubmitTextTurnResult | null = null;
  for (const turn of scenario.turns) {
    mock.currentSummaryVerdict = turn.summaryConfirmed ?? 'no';
    const result = await service.submitTextTurn({
      userId: USER_ID,
      householdId: HOUSEHOLD_ID,
      message: turn.userInput,
    });
    momentSequence.push(result.moment_key);
    lastResult = result;
  }

  // Guard: every declared LLM step must be consumed. Excess steps indicate a
  // scenario authoring error (step allocated to the wrong turn).
  if (mock.cursor !== allSteps.length) {
    throw new Error(
      `Scenario "${scenario.id}": ${String(allSteps.length)} LLM steps declared but only ${String(mock.cursor)} consumed — check step allocation per turn`,
    );
  }

  // toolCalls captured from the consumed steps, in dispatch order.
  const toolCalls: CapturedToolCall[] = mock.consumed.flatMap((step) =>
    (step.toolCalls ?? []).map((tc) => ({ tool: tc.name, args: tc.args })),
  );

  const outcome: ScenarioOutcome = {
    momentSequence,
    toolCalls,
    finalSlots: buildFinalSlots(stores),
    momentState:
      stores.momentState === null
        ? null
        : {
            current_moment: stores.momentState.current_moment,
            required_set_status: stores.momentState.required_set_status,
            cold_start_triggered: stores.momentState.cold_start_triggered,
            cold_start_trigger_reason: stores.momentState.cold_start_trigger_reason,
          },
    lastTurn:
      lastResult === null
        ? null
        : {
            chip_config: lastResult.chip_config,
            required_set_complete: lastResult.required_set_complete,
            missing_required_set: lastResult.missing_required_set,
            cold_start_mode: lastResult.cold_start_mode,
            is_complete: lastResult.is_complete,
          },
  };

  if (scenario.finalize === true) {
    try {
      const fin = await service.finalizeTextOnboarding({ userId: USER_ID, householdId: HOUSEHOLD_ID });
      outcome.finalize = { ok: true, summary: fin.summary };
    } catch (err) {
      outcome.finalize = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (scenario.reset === true) {
    await service.resetState(HOUSEHOLD_ID);
  }
  if (scenario.resume === true || scenario.reset === true) {
    const state = await service.getState(HOUSEHOLD_ID);
    outcome.state = {
      status: state.status,
      current_moment: state.current_moment ?? null,
      turn_count: state.turns?.length ?? 0,
    };
  }

  return { outcome, catalogSeedCalls: seedQueue.calls };
}

function buildFinalSlots(stores: Stores): ScenarioOutcome['finalSlots'] {
  return {
    household: {
      display_name: stores.household.display_name,
      cultural_identifiers: stores.household.cultural_identifiers,
      dietary_preferences: stores.household.dietary_preferences,
      declared_allergens: stores.household.declared_allergens,
    },
    children: [...stores.children.values()].map((c) => ({
      name: c.name,
      age_band: c.age_band,
      bag_composition_pattern: c.bag_composition_pattern,
      declared_allergens: c.declared_allergens,
      dietary_preferences: c.dietary_preferences,
      cultural_identifiers: c.cultural_identifiers,
    })),
    allergens: stores.allergens.map((a) => ({ scope: resolveScope(stores, a.child_id), allergen: a.allergen })),
    dietary: stores.dietary.map((d) => ({ scope: resolveScope(stores, d.child_id), tag: d.tag, enforcement: d.enforcement })),
    culturalPriors: [...stores.culturalPriors.values()].map((p) => ({ key: p.key, enforcement: p.enforcement })),
    foodPreferences: stores.foodPreferences.map((fp) => ({
      scope: resolveScope(stores, fp.child_id),
      item: fp.item,
      valence: fp.valence,
      enforcement: fp.enforcement,
    })),
    rules: stores.rules.map((r) => ({ rule_type: r.rule_type, custom_label: r.custom_label, enforcement: r.enforcement })),
    favorites: stores.favorites.map((f) => f.name),
  };
}

export { HOUSEHOLD_ID };
