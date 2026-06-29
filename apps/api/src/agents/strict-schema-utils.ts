// Shared helper for OpenAI strict-mode tool calling. Under strict mode every
// property is `required`, and originally-optional fields are emitted as
// `anyOf:[<schema>, null]` — so the model returns explicit `null`s for absent
// values. Those nulls must be stripped before Zod `.parse()` so `.optional()`
// fields validate as absent (see memory `strict-tool-schema-nullable-rule`).
//
// NOTE: `onboarding.agent.ts` carries a private, identical copy (predates this
// module). Consolidating it onto this export is a deferred, separate cleanup.
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}
