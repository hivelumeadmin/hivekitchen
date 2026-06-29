import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import type { LLMProvider } from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';
import { stripNulls } from './strict-schema-utils.js';

// Epic 13-s9 / routing-spec §4-6 — the stateless intent classifier for
// conversational plan editing. One cheap ('mini'-tier) forced-tool call turns a
// free-text utterance into a structured {intent, slots}. It does NOT touch the
// DB or mutate anything — the deterministic dispatcher (dispatchIntent) executes
// the result. This is the planner analog of Epic 2.7's stateless turn fn.
//
// PLAN_INTENT / PlanIntentResult live in the agent layer (not packages/contracts,
// which is API request/response shapes only). Promote when a /v1 dispatch
// endpoint exists.

export const PLAN_INTENT = {
  // T0 — deterministic downstream (no further LLM)
  INSPECT: 'inspect', // "show me Tuesday"
  EXPLAIN: 'explain', // "why this main?"
  COMMIT: 'commit', // "confirm the week"
  AFFIRM: 'affirm', // "looks great"
  SWAP_SLOT: 'swap_slot', // "swap Tuesday's main" -> CatalogRepo.pickRecipe
  EXCLUDE_FILTER: 'exclude_filter', // "no fish this week" -> pick with constraint
  VARY_SLOT: 'vary_slot', // "less spicy" -> plan_slot_variations write
  SAFETY_WRITE: 'safety_write', // "add a peanut allergy" -> household_allergens write
  // T2 — expensive agentic path
  ADD_DISH: 'add_dish', // net-new dish not in catalog
  RECOMPOSE: 'recompose', // "redo the whole week"
  COMPOSE_NEXT: 'compose_next', // "draft next week"
  // T1 — cheap reply only
  FALLBACK: 'fallback',
} as const;

export type PlanIntent = (typeof PLAN_INTENT)[keyof typeof PLAN_INTENT];

const INTENT_VALUES = Object.values(PLAN_INTENT) as [PlanIntent, ...PlanIntent[]];

// Flat args (simpler + fewer strict-mode pitfalls than a nested `slots` object).
// Slot fields are `.optional()`; the strict adapter emits them as
// `anyOf:[T,null]`, the model returns explicit nulls, and stripNulls drops them
// before parse.
export const PlanIntentResult = z.object({
  intent: z.enum(INTENT_VALUES),
  confidence: z.number().min(0).max(1),
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri']).optional(),
  slotKind: z.enum(['main', 'snack', 'extra']).optional(),
  childId: z.string().optional(), // resolved from context ("Maya" -> id)
  constraint: z.string().optional(), // normalized: "exclude:fish" | "time:down"
  variation: z.string().optional(), // normalized: "spice:down" | "portion:down"
  dishQuery: z.string().optional(), // for add_dish
  scope: z.enum(['slot', 'day', 'week']).optional(),
});

export type PlanIntentResult = z.infer<typeof PlanIntentResult>;

const ROUTE_TOOL_NAME = 'plan.route';

// The classifier tool. The adapter hardens this under forcedToolName (strict,
// all-required, optionals->nullable). `fn` is never executed — routeIntent reads
// the tool-call arguments directly — but ToolSpec requires it.
const ROUTE_TOOL: ToolSpec = {
  name: ROUTE_TOOL_NAME,
  description:
    'Classify the user utterance about their weekly plan into one structured intent + slots.',
  inputSchema: PlanIntentResult as unknown as ZodTypeAny,
  outputSchema: z.object({}) as unknown as ZodTypeAny,
  maxLatencyMs: 5000,
  fn: (input: unknown) => Promise.resolve(input),
};

// Light context the classifier uses to resolve day/child references. The caller
// passes only what's cheap to render — never the full plan tree.
export interface PlanContextLite {
  weekLabel?: string; // e.g. "Mon 29 Jun – Fri 3 Jul"
  days?: ReadonlyArray<{ day: string; mainTitle?: string }>;
  children?: ReadonlyArray<{ id: string; name: string }>;
}

const ROUTER_SYSTEM = [
  'You are the intent router for a weekly school-lunch planner. Classify the parent\'s',
  'message into exactly ONE intent and fill the relevant slots. Do not converse.',
  '',
  'Intents:',
  '- inspect: look at a day/slot ("show me Tuesday")',
  '- explain: why a choice was made ("why this main?")',
  '- commit: confirm/accept the week',
  '- affirm: acknowledgement with no action ("looks great", "thanks")',
  '- swap_slot: replace a dish in a slot ("swap Tuesday\'s main", "Maya\'s bored of wraps")',
  '- exclude_filter: a week/day constraint that re-selects ("no fish this week", "quicker mornings")',
  '- vary_slot: a per-child adjustment with no dish change ("less spicy", "smaller portion")',
  '- safety_write: declare/remove an allergy ("add a peanut allergy")',
  '- add_dish: request a specific NEW dish by name ("can we do bibimbap")',
  '- recompose: redo the whole week',
  '- compose_next: draft next week',
  '- fallback: unclear or off-topic',
  '',
  'Slot rules:',
  '- Resolve a named child to childId using the context; if unresolved, leave childId absent.',
  '- Resolve a weekday to day (mon..fri) from the context.',
  '- For exclude_filter set constraint normalized: "exclude:<thing>" or "time:down".',
  '- For vary_slot set variation normalized: "spice:down" | "spice:up" | "portion:down" | "portion:up" | "texture:soft".',
  '- For add_dish set dishQuery to the requested dish name.',
  '- Set confidence in [0,1] reflecting your certainty.',
].join('\n');

function renderContext(ctx: PlanContextLite | undefined): string {
  if (!ctx) return '';
  const parts: string[] = ['\n\nContext:'];
  if (ctx.weekLabel) parts.push(`Week: ${ctx.weekLabel}`);
  if (ctx.children?.length) {
    parts.push('Children: ' + ctx.children.map((c) => `${c.name}=${c.id}`).join(', '));
  }
  if (ctx.days?.length) {
    parts.push(
      'Days: ' +
        ctx.days.map((d) => `${d.day}${d.mainTitle ? ` (${d.mainTitle})` : ''}`).join('; '),
    );
  }
  return parts.join('\n');
}

/**
 * Classify one utterance. Stateless, single 'mini'-tier forced-tool call. The
 * forced tool guarantees a schema-valid call on strict-capable providers; on a
 * (defensive) empty/invalid result, returns a low-confidence fallback rather
 * than throwing, so a dispatcher can route it to a cheap clarifying reply.
 */
export async function routePlanIntent(
  utterance: string,
  ctx: PlanContextLite | undefined,
  provider: LLMProvider,
): Promise<PlanIntentResult> {
  const res = await provider.complete(utterance, [ROUTE_TOOL], {
    tier: 'mini',
    forcedToolName: ROUTE_TOOL_NAME,
    systemPrompt: ROUTER_SYSTEM + renderContext(ctx),
  });

  const call = res.toolCalls[0];
  if (!call) {
    return { intent: PLAN_INTENT.FALLBACK, confidence: 0 };
  }

  const parsed = PlanIntentResult.safeParse(stripNulls(call.arguments));
  if (!parsed.success) {
    return { intent: PLAN_INTENT.FALLBACK, confidence: 0 };
  }
  return parsed.data;
}
