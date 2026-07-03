import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { PLAN_INTENT, PlanIntentResultSchema } from '@hivekitchen/contracts';
import type { PlanIntent } from '@hivekitchen/contracts';
import type { LLMProvider } from './providers/llm-provider.interface.js';
import type { ToolSpec } from './tools.manifest.js';
import { stripNulls } from './strict-schema-utils.js';

// Epic 13-s9 / routing-spec §4-6 — the stateless intent classifier for
// conversational plan editing. One cheap ('mini'-tier) forced-tool call turns a
// free-text utterance into a structured {intent, slots}. It does NOT touch the
// DB or mutate anything — the deterministic dispatcher (dispatchIntent) executes
// the result. This is the planner analog of Epic 2.7's stateless turn fn.
//
// PLAN_INTENT / PlanIntentResultSchema live in packages/contracts (plan-intent.ts)
// since the chip-tap bypass POSTs a pre-built PlanIntentResult — it is a wire
// shape. Re-exported here so agent-layer consumers keep one import site.

export { PLAN_INTENT };
export type { PlanIntent };

export const PlanIntentResult = PlanIntentResultSchema;
export type PlanIntentResult = z.infer<typeof PlanIntentResultSchema>;

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
  '- For safety_write set allergen to the canonical allergen name (e.g. "peanut", "milk").',
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
