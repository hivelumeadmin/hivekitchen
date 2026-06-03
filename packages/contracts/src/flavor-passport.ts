import { z } from 'zod';

// Slice 4-S12 — FlavorPassport: a child's accumulated flavor journey, rendered
// as a vertical timeline of stamp cards (one per positively-rated recipe).
// Reads over existing tables only (child_preferences + recipes + recipe_steps);
// no migration. `not-really` signals are deliberately excluded upstream — the
// passport is a treasure of what the child enjoyed, never a scoreboard.

export const FlavorPassportStampSchema = z.object({
  recipe_id: z.string().uuid(),
  recipe_name: z.string(), // recipes.canonical_name
  slot_kind: z.enum(['main', 'snack', 'extra']),
  signal_type: z.enum(['loved', 'ok']),
  signal_date: z.string(), // 'YYYY-MM-DD' — date rated
  cuisine_tags: z.array(z.string()), // recipes.cuisine_tags
  method_caption: z.string().nullable(), // first recipe_steps row text; null if no steps
  child_voice_quote: z.string().nullable(), // always null in this slice; reserved for future voice
});

// empty = 0 stamps, developing = 1–8, established = 9+.
export const FlavorPassportStateSchema = z.enum(['empty', 'developing', 'established']);

export const FlavorPassportResponseSchema = z.object({
  child_id: z.string().uuid(),
  state: FlavorPassportStateSchema,
  stamps: z.array(FlavorPassportStampSchema),
  available_filters: z
    .object({
      cuisines: z.array(z.string()),
      slot_kinds: z.array(z.enum(['main', 'snack', 'extra'])),
    })
    .optional(), // only present when state = 'established'
});

export type FlavorPassportStamp = z.infer<typeof FlavorPassportStampSchema>;
export type FlavorPassportState = z.infer<typeof FlavorPassportStateSchema>;
export type FlavorPassportResponse = z.infer<typeof FlavorPassportResponseSchema>;
