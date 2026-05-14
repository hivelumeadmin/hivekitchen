import { z } from 'zod';
import { AgeBandSchema } from './children.js';

// ===========================================================================
// Slice C — Onboarding agent tool I/O
// ===========================================================================
// Three tools the OnboardingAgent invokes during the text-mode interview
// to build the kitchen map progressively:
//
//   child.upsert   — create/update a child row by case-insensitive name
//   cultural.note  — register a cultural prior with state='suggested'
//   memory.note    — write a memory node + provenance
//
// Tag arrays in these schemas are loosely constrained ("array of short
// strings") — strict vocabulary validation lives in VocabularyService at
// the handler boundary so the agent gets a clear error message when it
// emits an unknown tag, rather than a Zod refusal-to-parse.
//
// The agent receives the vocabulary snapshot as part of its system prompt
// (slice A0.5), so well-behaved tool calls should already be valid.
// ===========================================================================

// ---- Shared --------------------------------------------------------------

const TagArraySchema = z.array(z.string().min(1).max(64)).max(50);

// ---- child.upsert --------------------------------------------------------

export const ChildUpsertInputSchema = z.object({
  /**
   * Display name. Used as the idempotency key (case-insensitive match
   * within household). The agent should always use the name the parent
   * spoke — not a guessed-canonical form.
   */
  name: z.string().trim().min(1).max(100),

  /** From AddChildBodySchema. Mirrors the children.age_band column. */
  age_band: AgeBandSchema,

  /** Optional — short note about the child's school policy as the agent
   *  understood it. Persisted to children.school_policy_notes. */
  school_policy_notes: z.string().trim().max(500).nullish(),

  /** Allergen tag keys. Service validates against allergen_tags. */
  declared_allergens: TagArraySchema.default([]),

  /** Cultural tag keys. Service validates against cultural_tags. */
  cultural_identifiers: TagArraySchema.default([]),

  /** Dietary tag keys. Service validates against dietary_tags; the implies-
   *  closure is expanded server-side, the agent emits the narrowest tag. */
  dietary_preferences: TagArraySchema.default([]),
});

export const ChildUpsertOutputSchema = z.object({
  child_id: z.string().uuid(),
  /** Matches the resolved canonical name (the value stored after dedup). */
  name: z.string(),
  /** True when an existing child row was updated, false when a new row was
   *  inserted. Useful for distinguishing INSERT vs UPDATE in audit logs. */
  was_existing: z.boolean(),
});

// ---- cultural.note -------------------------------------------------------

// Mirrors cultural_priors row constraints; the service writes with
// state='suggested' regardless of agent intent — ratification is a
// separate user action (slice 2-s25).
export const CulturalNoteInputSchema = z.object({
  /** From cultural_tags vocabulary. Service validates is_active=true. */
  key: z.string().min(1).max(64),

  /** Human-readable label the agent saw on the cultural_tags row.
   *  Service may override with the canonical display_name. */
  label: z.string().min(1).max(128),

  /** 0–100. How confident the agent is the household identifies with
   *  this template. */
  confidence: z.number().int().min(0).max(100),

  /** 0–100. How often signals for this template appeared in the
   *  conversation. NOT zero-sum across templates. */
  presence: z.number().int().min(0).max(100),
});

export const CulturalNoteOutputSchema = z.object({
  prior_id: z.string().uuid(),
  /** True when an existing row was updated, false when newly inserted. */
  was_existing: z.boolean(),
});

// ---- memory.note ---------------------------------------------------------

// Mirrors memory_nodes.node_type enum from migration 20260601000000.
export const MemoryNoteFromOnboardingNodeTypeSchema = z.enum([
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
  'other',
]);

export const MemoryNoteFromOnboardingInputSchema = z.object({
  node_type: MemoryNoteFromOnboardingNodeTypeSchema,
  /** Short facet label (≤200 chars). E.g. 'palate', 'family_rhythm'. */
  facet: z.string().trim().min(1).max(200),
  /** The note itself (≤2000 chars). Plain prose the agent extracted from
   *  the conversation, written in third person about the family. */
  prose_text: z.string().trim().min(1).max(2000),
  /** When the note is about a specific child (e.g. allergy, obsession),
   *  the child_id returned by a prior child.upsert call. Null/omitted for
   *  household-wide rhythms. */
  subject_child_id: z.string().uuid().nullish(),
  /** 0.0–1.0. Defaults to 0.8 at the service layer when omitted. */
  confidence: z.number().min(0).max(1).nullish(),
});

export const MemoryNoteFromOnboardingOutputSchema = z.object({
  node_id: z.string().uuid(),
  created_at: z.string().datetime(),
});
