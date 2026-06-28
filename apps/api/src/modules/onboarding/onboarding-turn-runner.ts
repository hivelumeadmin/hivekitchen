import type { FastifyBaseLogger } from 'fastify';
import type { KitchenMap, VocabularySnapshot } from '@hivekitchen/types';
import {
  m2AllergenLabel,
  m3ChipLabel,
  m4BagLabel,
  m2AckTemplate,
  m3AckTemplate,
  m4AckTemplate,
  isM3DietaryKey,
  isM3CuisineKey,
} from './onboarding-chips.js';
import { UpstreamError } from '../../common/errors.js';
import type {
  OnboardingAgent,
  LlmMessage,
  OnboardingAgentUsage,
  OnboardingToolCallSummary,
} from '../../agents/onboarding.agent.js';
import { createOnboardingToolSpecs } from '../../agents/tools/onboarding.tools.js';
import type { ToolSpec } from '../../agents/tools.manifest.js';
import type { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import type { ChildrenService } from '../children/children.service.js';
import type { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import type { DietaryPreferencesRepository } from '../dietary-preferences/dietary-preferences.repository.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { HouseholdRulesRepository } from '../household-rules/household-rules.repository.js';
import type { HouseholdsService } from '../households/households.service.js';
import type { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { VocabularyService } from '../vocabulary/vocabulary.service.js';
import type { CurrentMoment, MomentState } from './onboarding-moment.repository.js';

// ===========================================================================
// Slice 2.7-s7 — OnboardingTurnRunner
// ===========================================================================
// The "stateless turn function" half of an onboarding text turn (AC1/AC3),
// lifted out of the OnboardingService god method. Given the assembled history
// and the pre-turn state, it: assembles the prompt blocks → calls the provider
// (or applies a deterministic zero-call chip turn) → executes tools → reports
// the model's prose, the tool effects, token usage, and the three rendered
// blocks (for the trace). It owns NO control flow — the OnboardingController
// decides the next moment from the slot state the service derives afterwards.
//
// Mirrors the planner's orchestrator/turn separation (3.5-s4/s5): assembly and
// the single model round-trip live here; the FSM and side-effects stay in the
// service.
// ===========================================================================

const TEXT_MODALITY = 'text' as const;

export interface OnboardingTurnRunnerDeps {
  agent: OnboardingAgent;
  logger: FastifyBaseLogger;
  agentToolsEnabled: boolean;
  childrenService?: ChildrenService;
  culturalPriorRepository?: CulturalPriorRepository;
  householdsService?: HouseholdsService;
  kitchenMapService?: KitchenMapService;
  vocabularyService?: VocabularyService;
  memoryService?: MemoryService;
  childAllergensRepository?: ChildAllergensRepository;
  householdAllergensRepository?: HouseholdAllergensRepository;
  dietaryPreferencesRepository?: DietaryPreferencesRepository;
  foodPreferencesRepository?: FoodPreferencesRepository;
  householdRulesRepository?: HouseholdRulesRepository;
  recipesRepository?: RecipesRepository;
}

export interface RunTurnInput {
  householdId: string;
  userId: string;
  threadId: string;
  /** The assembled LLM history (incl. the synthetic greeting + this user turn). */
  agentInput: LlmMessage[];
  /** Chip keys parsed from the user message (empty for free text). */
  submittedChipKeys: string[];
  /** Free text remaining after stripping the chip header (empty on a pure-chip turn). */
  chipFreeText: string;
  /** The moment the turn STARTED in (drives pure-chip eligibility). */
  preTurnMoment: CurrentMoment;
  /** Pre-turn moment-state row (rendered into the prompt's state block). */
  preTurnMomentState: MomentState | null;
}

export interface RunTurnResult {
  /** Lumi's raw prose (the service sanitises before persisting). */
  lumiText: string;
  toolCallsSummary?: OnboardingToolCallSummary[];
  /** Undefined on the zero-call (pure-chip) path. */
  agentUsage?: OnboardingAgentUsage;
  /** Household display_name read from the Kitchen Map at turn time (null pre-name). */
  householdDisplayName: string | null;
  /** A dietary.declare / cuisine.declare tool RESULT asked for enforcement ratification. */
  ratificationRequested: boolean;
  /** The three rendered system-prompt blocks (for ONBOARDING_TRACE_DIR). */
  blocks: {
    kitchenMap?: string;
    momentState?: string;
    vocabulary?: string;
  };
}

// M5 chip keys are recipe UUIDs; everything else is a short slug. Used to keep
// UUID chip turns off the deterministic zero-call path (they need name lookup).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OnboardingTurnRunner {
  constructor(private readonly deps: OnboardingTurnRunnerDeps) {}

  /**
   * True when all tool-loop deps are present and the env flag is on. When false
   * the runner uses the legacy single-shot agent path (no tools, no blocks).
   */
  private get toolLoopAvailable(): boolean {
    const d = this.deps;
    return (
      d.agentToolsEnabled &&
      d.childrenService !== undefined &&
      d.culturalPriorRepository !== undefined &&
      d.householdsService !== undefined &&
      d.kitchenMapService !== undefined &&
      d.vocabularyService !== undefined &&
      d.memoryService !== undefined &&
      d.childAllergensRepository !== undefined &&
      d.householdAllergensRepository !== undefined &&
      d.dietaryPreferencesRepository !== undefined &&
      d.foodPreferencesRepository !== undefined &&
      d.householdRulesRepository !== undefined &&
      d.recipesRepository !== undefined
    );
  }

  async run(input: RunTurnInput): Promise<RunTurnResult> {
    const d = this.deps;
    const logger = d.logger;

    // Slice 2.7-s5 — pure-chip zero-call detection. When the parent answers a
    // chip moment (M2/M3/M4) entirely by tapping chips — no free text — the
    // chip keys map deterministically to tool calls and the turn makes ZERO
    // conversational LLM calls (AC2). A chip+free-text turn, an M5 (UUID) chip
    // turn, or any other moment still routes through the model.
    const isPureChipTurn =
      this.toolLoopAvailable &&
      input.submittedChipKeys.length > 0 &&
      input.chipFreeText === '' &&
      !input.submittedChipKeys.some((k) => UUID_RE.test(k)) &&
      (input.preTurnMoment === 'm2_safe' ||
        input.preTurnMoment === 'm3_taste' ||
        input.preTurnMoment === 'm4_bag');

    logger.info(
      {
        module: 'onboarding',
        action: 'onboarding.tool_loop_check',
        household_id: input.householdId,
        tool_loop_available: this.toolLoopAvailable,
        agent_tools_enabled: d.agentToolsEnabled,
      },
      'onboarding tool loop check',
    );

    let lumiText: string;
    let toolCallsSummary: OnboardingToolCallSummary[] | undefined;
    let agentUsage: OnboardingAgentUsage | undefined;
    let householdDisplayName: string | null = null;
    const blocks: RunTurnResult['blocks'] = {};

    try {
      if (
        this.toolLoopAvailable &&
        d.childrenService !== undefined &&
        d.culturalPriorRepository !== undefined &&
        d.householdsService !== undefined &&
        d.kitchenMapService !== undefined &&
        d.vocabularyService !== undefined &&
        d.memoryService !== undefined &&
        d.childAllergensRepository !== undefined &&
        d.householdAllergensRepository !== undefined &&
        d.dietaryPreferencesRepository !== undefined &&
        d.foodPreferencesRepository !== undefined &&
        d.householdRulesRepository !== undefined &&
        d.recipesRepository !== undefined
      ) {
        const map = await d.kitchenMapService.get(input.householdId);
        householdDisplayName = map.household.display_name ?? null;
        const toolSpecs = createOnboardingToolSpecs(
          { householdId: input.householdId, userId: input.userId, logger },
          {
            childrenService: d.childrenService,
            culturalPriorRepository: d.culturalPriorRepository,
            householdsService: d.householdsService,
            memoryService: d.memoryService,
            vocabularyService: d.vocabularyService,
            childAllergensRepository: d.childAllergensRepository,
            householdAllergensRepository: d.householdAllergensRepository,
            dietaryPreferencesRepository: d.dietaryPreferencesRepository,
            foodPreferencesRepository: d.foodPreferencesRepository,
            householdRulesRepository: d.householdRulesRepository,
            recipesRepository: d.recipesRepository,
          },
        );
        if (isPureChipTurn) {
          // Zero-call path: apply the chip selections deterministically; no
          // conversational LLM call (agentUsage stays undefined). The moment
          // advances afterwards from slot state in the controller (2.7-s7).
          const applied = await this.applyPureChipTurn(
            input.preTurnMoment,
            input.submittedChipKeys,
            map,
            toolSpecs,
          );
          lumiText = applied.ackText;
          toolCallsSummary = applied.toolCallsSummary;
        } else {
          // Slice 2.7-s3 — render once, reuse for both the prompt and the trace.
          blocks.kitchenMap = renderKitchenMapBlock(map);
          blocks.momentState = renderMomentStateBlock(input.preTurnMomentState);
          blocks.vocabulary = renderVocabularyBlock(d.vocabularyService);
          const reply = await d.agent.respond(input.agentInput, {
            modality: TEXT_MODALITY,
            tools: toolSpecs,
            kitchenMapBlock: blocks.kitchenMap,
            momentStateBlock: blocks.momentState,
            vocabularyBlock: blocks.vocabulary,
          });
          lumiText = reply.text;
          toolCallsSummary = reply.toolCallsSummary;
          agentUsage = reply.usage;
        }
      } else {
        const reply = await d.agent.respond(input.agentInput, { modality: TEXT_MODALITY });
        lumiText = reply.text;
        toolCallsSummary = reply.toolCallsSummary;
        agentUsage = reply.usage;
      }
    } catch (err) {
      // R2-P7 — never echo the upstream error into the response detail; log raw
      // server-side and surface a generic 502.
      logger.error(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.agent_failed',
          household_id: input.householdId,
          thread_id: input.threadId,
        },
        'OnboardingAgent.respond failed during text turn',
      );
      throw new UpstreamError('Onboarding agent unavailable');
    }

    // Slice B — surface agent token usage + prompt-cache effectiveness.
    if (agentUsage !== undefined) {
      logger.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn_usage',
          household_id: input.householdId,
          thread_id: input.threadId,
          prompt_tokens: agentUsage.promptTokens,
          completion_tokens: agentUsage.completionTokens,
          cached_prompt_tokens: agentUsage.cachedPromptTokens,
          iterations: agentUsage.iterations,
          cache_hit_ratio:
            agentUsage.promptTokens > 0
              ? Number((agentUsage.cachedPromptTokens / agentUsage.promptTokens).toFixed(3))
              : 0,
        },
        'onboarding agent token usage',
      );
    }

    if (toolCallsSummary !== undefined && toolCallsSummary.length > 0) {
      logger.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn_tools',
          household_id: input.householdId,
          thread_id: input.threadId,
          tool_count: toolCallsSummary.length,
          tools_used: toolCallsSummary.map((t) => t.tool),
          tool_errors: toolCallsSummary.filter((t) => t.error).length,
        },
        'onboarding agent used tools during turn',
      );
    }

    // Slice 2.7-s5 — M3 enforcement ratification is signalled by the structured
    // `ratification_requested` field on a dietary.declare / cuisine.declare tool
    // RESULT (no prose sentinel). The service renders the chip from this flag.
    const ratificationRequested = (toolCallsSummary ?? []).some(
      (t) =>
        !t.error &&
        typeof t.result === 'object' &&
        t.result !== null &&
        (t.result as { ratification_requested?: unknown }).ratification_requested === true,
    );

    return {
      lumiText,
      toolCallsSummary,
      agentUsage,
      householdDisplayName,
      ratificationRequested,
      blocks,
    };
  }

  // Slice 2.7-s5 — apply a pure-chip turn deterministically (zero conversational
  // LLM calls). Maps the tapped chip keys to tool calls against the already-built
  // per-turn tool specs and fills a per-moment acknowledgment template (Option A).
  // Tool errors are captured (never thrown) so one bad write does not fail the
  // turn — mirrors the agent tool-loop's error handling.
  private async applyPureChipTurn(
    moment: CurrentMoment,
    chipKeys: string[],
    map: KitchenMap,
    toolSpecs: ToolSpec[],
  ): Promise<{ ackText: string; toolCallsSummary: OnboardingToolCallSummary[] }> {
    const summary: OnboardingToolCallSummary[] = [];
    const specByName = new Map(toolSpecs.map((s) => [s.name, s]));
    const callTool = async (name: string, args: Record<string, unknown>): Promise<void> => {
      const spec = specByName.get(name);
      if (spec === undefined) {
        summary.push({ tool: name, error: true, args, result: { error: `Unknown tool: ${name}` } });
        return;
      }
      try {
        const result = await spec.fn(args);
        summary.push({ tool: name, error: false, args, result });
      } catch (err) {
        summary.push({
          tool: name,
          error: true,
          args,
          result: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    };

    if (moment === 'm2_safe') {
      // Chip allergens with no free-text child attribution are HOUSEHOLD-WIDE
      // (fire allergen.declare with no child scope). 'none' fires no tool.
      const allergenKeys = chipKeys.filter((k) => k !== 'none' && k !== 'no_known_allergens');
      for (const k of allergenKeys) {
        await callTool('allergen.declare', { allergen: k });
      }
      // Labels from successful results only — never claim to have noted an
      // allergen whose write failed (P1, 2.7-s5 CR).
      const labels = summary
        .filter((s) => !s.error && s.tool === 'allergen.declare')
        .map((s) => m2AllergenLabel((s.args as { allergen: string }).allergen));
      return { ackText: m2AckTemplate(labels), toolCallsSummary: summary };
    }

    if (moment === 'm3_taste') {
      if (chipKeys.includes('skip')) {
        return { ackText: m3AckTemplate([]), toolCallsSummary: summary };
      }
      for (const k of chipKeys) {
        if (isM3DietaryKey(k)) {
          // No language signal on a bare chip tap → 'default' enforcement, no
          // ratification (the elevation chip only fires off free-text strength).
          await callTool('dietary.declare', { tag: k, enforcement: 'default' });
        } else if (isM3CuisineKey(k)) {
          await callTool('cuisine.declare', {
            key: k,
            label: m3ChipLabel(k),
            confidence: 80,
            presence: 70,
          });
        }
        // Unknown M3 chip keys are ignored defensively (drift test guards this).
      }
      const labels = summary
        .filter((s) => !s.error)
        .map((s) => {
          const args = s.args as { tag?: string; key?: string };
          return m3ChipLabel(args.tag ?? args.key ?? '');
        })
        .filter((l) => l !== '');
      return { ackText: m3AckTemplate(labels), toolCallsSummary: summary };
    }

    // m4_bag — single-select bag pattern applied to every declared child.
    const pattern = chipKeys[0] ?? '';
    for (const child of map.children) {
      await callTool('child.upsert', {
        name: child.name,
        age_band: child.age_band,
        bag_composition_pattern: pattern,
      });
    }
    return { ackText: m4AckTemplate(m4BagLabel(pattern)), toolCallsSummary: summary };
  }
}

// ---------------------------------------------------------------------------
// System-prompt block renderers (moved here from onboarding.service.ts in s7)
// ---------------------------------------------------------------------------
// The tool-loop path injects three blocks into the system prompt:
//   - kitchenMapBlock: the household's current projection (avoid re-asking),
//   - momentStateBlock: current_moment + required_set_status,
//   - vocabularyBlock: the active tag vocabulary.
// All are placed at cache-friendly positions so OpenAI's auto-prefix caching
// stays warm within a household conversation.
// ---------------------------------------------------------------------------

function renderKitchenMapBlock(map: KitchenMap): string {
  const trimmed = {
    household: {
      display_name: map.household.display_name,
      tier: map.household.tier,
      timezone: map.household.timezone,
      cultural_identifiers: map.household.cultural_identifiers,
      dietary_preferences: map.household.dietary_preferences,
      declared_allergens: map.household.declared_allergens,
    },
    caregivers: map.caregivers.map((c) => ({
      role: c.role,
      display_name: c.display_name,
      cultural_language: c.cultural_language,
    })),
    children: map.children.map((c) => ({
      id: c.id,
      name: c.name,
      age_band: c.age_band,
      bag_composition_pattern: c.bag_composition_pattern,
      declared_allergens: c.declared_allergens,
      cultural_identifiers: c.cultural_identifiers,
      dietary_preferences: c.dietary_preferences,
      school_policies: c.school_policies,
    })),
    cultural: {
      active: map.cultural.active.map((p) => p.key),
      suggested: map.cultural.suggested.map((p) => p.key),
    },
    memory_notes: map.memory.nodes.map((n) => ({
      type: n.node_type,
      facet: n.facet,
      text: n.prose_text,
      child_id: n.subject_child_id,
    })),
    allergens: map.allergens.map((a) => ({
      child_id: a.child_id,
      allergen: a.allergen,
      source: a.source,
    })),
    dietary: map.dietary.map((d) => ({
      child_id: d.child_id,
      tag: d.tag,
      enforcement: d.enforcement,
    })),
    food_preferences: map.food_preferences.map((fp) => ({
      child_id: fp.child_id,
      item: fp.item,
      valence: fp.valence,
      enforcement: fp.enforcement,
    })),
    favorite_lunches: map.favorite_lunches.map((fl) => ({
      item: fl.item,
      position: fl.position,
    })),
    rules: map.rules.map((r) => ({
      rule_type: r.rule_type,
      custom_label: r.custom_label,
      enforcement: r.enforcement,
    })),
    meta: {
      is_complete: map.meta.is_complete,
      required_set_complete: map.meta.required_set_complete,
    },
  };
  return '```json\n' + JSON.stringify(trimmed, null, 2) + '\n```';
}

// Slice 2.5-s4 — render the moment-state block injected on every text turn.
// Exported because onboarding.service.test.ts asserts its shape directly.
export function renderMomentStateBlock(state: MomentState | null): string {
  if (state === null) {
    return `CURRENT ONBOARDING STATE
current_moment: pre_start
required_set:
  m1_household_name: false
  m1_child_declared: false
  m2_allergen_response: false
  m5_favorite_count: 0
  m5_complete: false
required_set_complete: false
cold_start_triggered: false`;
  }
  const rss = state.required_set_status;
  const complete =
    rss.m1_household_name &&
    rss.m1_child_declared &&
    rss.m2_allergen_response &&
    rss.m5_complete;
  const coldStartReasonLine = state.cold_start_triggered
    ? `\ncold_start_trigger_reason: ${state.cold_start_trigger_reason ?? 'unknown'}`
    : '';
  return `CURRENT ONBOARDING STATE
current_moment: ${state.current_moment}
required_set:
  m1_household_name: ${rss.m1_household_name}
  m1_child_declared: ${rss.m1_child_declared}
  m2_allergen_response: ${rss.m2_allergen_response}
  m5_favorite_count: ${rss.m5_favorite_count}
  m5_complete: ${rss.m5_complete}
required_set_complete: ${complete}
cold_start_triggered: ${state.cold_start_triggered}${coldStartReasonLine}`;
}

function renderVocabularyBlock(vocab: VocabularyService): string {
  const snap: VocabularySnapshot = vocab.snapshot();
  const lines: string[] = [];

  lines.push('Allergens (use as declared_allergens values):');
  for (const a of snap.allergen_tags.filter((t) => t.is_active)) {
    const aliases = a.alias_keys.length > 0 ? ` (aliases: ${a.alias_keys.join(', ')})` : '';
    lines.push(`  ${a.key}${aliases}`);
  }

  lines.push('\nDietary tags (use as dietary_preferences values):');
  for (const d of snap.dietary_tags.filter((t) => t.is_active)) {
    const implies = d.implies.length > 0 ? ` (implies: ${d.implies.join(', ')})` : '';
    lines.push(`  ${d.key}${implies}`);
  }

  lines.push('\nCultural tags (use as cultural_identifiers values or cultural.note keys):');
  for (const c of snap.cultural_tags.filter((t) => t.is_active)) {
    const template = c.is_template ? ' [template]' : '';
    lines.push(`  ${c.key}${template}`);
  }

  return lines.join('\n');
}
