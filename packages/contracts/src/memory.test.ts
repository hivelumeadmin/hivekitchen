import { describe, it, expect } from 'vitest';
import {
  ForgetRequest,
  ForgetCompletedEvent,
  NodeTypeSchema,
  SourceTypeSchema,
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
  MemoryNodeSchema,
  MemoryProvenanceSchema,
} from './memory.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';
const DT = '2026-04-23T00:00:00Z';

describe('ForgetRequest', () => {
  it('parses valid soft forget request', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'soft' });
    expect(r.success).toBe(true);
  });

  it('parses with optional reason', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'soft', reason: 'parent requested' });
    expect(r.success).toBe(true);
  });

  it('rejects hard mode (Phase 1 gate)', () => {
    const r = ForgetRequest.safeParse({ node_id: UUID1, mode: 'hard' });
    expect(r.success).toBe(false);
  });

  it('rejects missing mode', () => {
    expect(ForgetRequest.safeParse({ node_id: UUID1 }).success).toBe(false);
  });

  it('rejects invalid node_id', () => {
    expect(ForgetRequest.safeParse({ node_id: 'not-uuid', mode: 'soft' }).success).toBe(false);
  });
});

describe('ForgetCompletedEvent', () => {
  it('parses valid event', () => {
    const r = ForgetCompletedEvent.safeParse({
      type: 'memory.forget.completed',
      node_id: UUID1,
      mode: 'soft',
      completed_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing completed_at', () => {
    expect(ForgetCompletedEvent.safeParse({
      type: 'memory.forget.completed',
      node_id: UUID1,
      mode: 'soft',
    }).success).toBe(false);
  });

  it('rejects invalid type literal', () => {
    expect(ForgetCompletedEvent.safeParse({
      type: 'memory.forget.hard',
      node_id: UUID1,
      mode: 'soft',
      completed_at: DT,
    }).success).toBe(false);
  });
});

describe('NodeTypeSchema', () => {
  it('accepts every documented node type', () => {
    for (const t of [
      'preference',
      'rhythm',
      'cultural_rhythm',
      'allergy',
      'child_obsession',
      'school_policy',
      'other',
    ] as const) {
      expect(NodeTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(NodeTypeSchema.safeParse('mystery').success).toBe(false);
    expect(NodeTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('SourceTypeSchema', () => {
  it('accepts every documented source type', () => {
    for (const s of [
      'onboarding',
      'turn',
      'tool',
      'user_edit',
      'plan_outcome',
      'import',
    ] as const) {
      expect(SourceTypeSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(SourceTypeSchema.safeParse('manual').success).toBe(false);
  });
});

describe('MemoryNoteInputSchema', () => {
  it('round-trips a fully-specified valid input', () => {
    const r = MemoryNoteInputSchema.safeParse({
      household_id: UUID1,
      node_type: 'preference',
      facet: 'avoids spicy food',
      prose_text: 'Child avoids spicy peppers and chili oil',
      subject_child_id: UUID2,
      confidence: 0.9,
    });
    expect(r.success).toBe(true);
  });

  it('applies confidence default when omitted', () => {
    const r = MemoryNoteInputSchema.safeParse({
      household_id: UUID1,
      node_type: 'rhythm',
      facet: 'thursday is leftover night',
      prose_text: 'Family eats leftovers Thursdays.',
      subject_child_id: null,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.confidence).toBe(0.75);
    }
  });

  it('rejects missing required household_id', () => {
    const r = MemoryNoteInputSchema.safeParse({
      node_type: 'preference',
      facet: 'x',
      prose_text: 'y',
      subject_child_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects facet over 200 chars', () => {
    const r = MemoryNoteInputSchema.safeParse({
      household_id: UUID1,
      node_type: 'preference',
      facet: 'x'.repeat(201),
      prose_text: 'y',
      subject_child_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    const base = {
      household_id: UUID1,
      node_type: 'preference' as const,
      facet: 'a',
      prose_text: 'b',
      subject_child_id: null,
    };
    expect(MemoryNoteInputSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
    expect(MemoryNoteInputSchema.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
  });
});

describe('MemoryNoteOutputSchema', () => {
  it('round-trips a valid output', () => {
    const r = MemoryNoteOutputSchema.safeParse({ node_id: UUID1, created_at: DT });
    expect(r.success).toBe(true);
  });

  it('rejects missing created_at', () => {
    expect(MemoryNoteOutputSchema.safeParse({ node_id: UUID1 }).success).toBe(false);
  });

  it('rejects invalid node_id', () => {
    expect(MemoryNoteOutputSchema.safeParse({ node_id: 'x', created_at: DT }).success).toBe(false);
  });
});

describe('MemoryNodeSchema and MemoryProvenanceSchema', () => {
  it('round-trips a fully-specified node row', () => {
    const r = MemoryNodeSchema.safeParse({
      id: UUID1,
      household_id: UUID2,
      node_type: 'allergy',
      facet: 'peanut',
      subject_child_id: null,
      prose_text: 'Declared allergy: peanut',
      soft_forget_at: null,
      hard_forgotten: false,
      created_at: DT,
      updated_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('round-trips a fully-specified provenance row', () => {
    const r = MemoryProvenanceSchema.safeParse({
      id: UUID1,
      memory_node_id: UUID2,
      source_type: 'onboarding',
      source_ref: { thread_id: UUID3, turn_id: UUID3 },
      captured_at: DT,
      captured_by: UUID3,
      confidence: 0.8,
      superseded_by: null,
    });
    expect(r.success).toBe(true);
  });
});
