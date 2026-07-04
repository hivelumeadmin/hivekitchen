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
  MemoryRecallInputSchema,
  MemoryRecallOutputSchema,
  GetMemoryResponseSchema,
  GetProvenanceResponseSchema,
  EditMemoryRequestSchema,
  EditMemoryResponseSchema,
  ForgetMemoryRequestSchema,
  ForgetMemoryResponseSchema,
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
  it('accepts the 3 valid node types (narrowed by migration 20260904000300)', () => {
    for (const t of ['rhythm', 'child_obsession', 'other'] as const) {
      expect(NodeTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects the 4 types deprecated by migration 20260904000300', () => {
    for (const t of ['preference', 'cultural_rhythm', 'allergy', 'school_policy']) {
      expect(NodeTypeSchema.safeParse(t).success).toBe(false);
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
      node_type: 'other',
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
      node_type: 'other',
      facet: 'x',
      prose_text: 'y',
      subject_child_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects facet over 200 chars', () => {
    const r = MemoryNoteInputSchema.safeParse({
      household_id: UUID1,
      node_type: 'other',
      facet: 'x'.repeat(201),
      prose_text: 'y',
      subject_child_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    const base = {
      household_id: UUID1,
      node_type: 'other' as const,
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

describe('MemoryRecallInputSchema', () => {
  it('applies limit default when omitted', () => {
    const r = MemoryRecallInputSchema.safeParse({ household_id: UUID1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(20);
  });

  it('accepts optional facets', () => {
    const r = MemoryRecallInputSchema.safeParse({
      household_id: UUID1,
      facets: ['preference', 'rhythm'],
      limit: 10,
    });
    expect(r.success).toBe(true);
  });

  it('rejects limit above 50', () => {
    const r = MemoryRecallInputSchema.safeParse({ household_id: UUID1, limit: 51 });
    expect(r.success).toBe(false);
  });
});

describe('MemoryRecallOutputSchema', () => {
  it('round-trips a node with subject_child_id null', () => {
    const r = MemoryRecallOutputSchema.safeParse({
      nodes: [
        {
          node_id: UUID1,
          node_type: 'other',
          facet: 'avoids spicy',
          prose_text: 'Child avoids spicy peppers.',
          subject_child_id: null,
          confidence: 0.9,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown node_type', () => {
    const r = MemoryRecallOutputSchema.safeParse({
      nodes: [
        {
          node_id: UUID1,
          node_type: 'mystery',
          facet: 'x',
          prose_text: 'y',
          subject_child_id: null,
          confidence: 0.9,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('MemoryNodeSchema and MemoryProvenanceSchema', () => {
  it('round-trips a fully-specified node row', () => {
    const r = MemoryNodeSchema.safeParse({
      id: UUID1,
      household_id: UUID2,
      node_type: 'other',
      facet: 'peanut',
      subject_child_id: null,
      prose_text: 'Declared allergy: peanut',
      soft_forget_at: null,
      forget_reason: null,
      hard_forgotten: false,
      created_at: DT,
      updated_at: DT,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a node with a non-null forget_reason', () => {
    const r = MemoryNodeSchema.safeParse({
      id: UUID1,
      household_id: UUID2,
      node_type: 'other',
      facet: 'peanut',
      subject_child_id: null,
      prose_text: 'Declared allergy: peanut',
      soft_forget_at: DT,
      forget_reason: 'no longer relevant',
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

describe('GetMemoryResponseSchema', () => {
  const node = {
    id: UUID1,
    household_id: UUID2,
    node_type: 'other' as const,
    facet: 'peanut',
    subject_child_id: null,
    prose_text: 'Declared allergy: peanut',
    soft_forget_at: null,
    forget_reason: null,
    hard_forgotten: false,
    created_at: DT,
    updated_at: DT,
  };

  it('parses a valid payload with an empty nodes array', () => {
    expect(GetMemoryResponseSchema.safeParse({ nodes: [] }).success).toBe(true);
  });

  it('parses a valid payload with one node', () => {
    expect(GetMemoryResponseSchema.safeParse({ nodes: [node] }).success).toBe(true);
  });

  it('rejects a payload missing the nodes field', () => {
    expect(GetMemoryResponseSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a node with an unknown node_type', () => {
    const r = GetMemoryResponseSchema.safeParse({
      nodes: [{ ...node, node_type: 'mystery' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('GetProvenanceResponseSchema', () => {
  const provenance = {
    id: UUID1,
    memory_node_id: UUID2,
    source_type: 'turn' as const,
    source_ref: { thread_id: UUID1 },
    captured_at: DT,
    captured_by: UUID2,
    confidence: 0.87,
    superseded_by: null,
  };

  it('parses a valid payload with an empty provenance array', () => {
    expect(GetProvenanceResponseSchema.safeParse({ provenance: [] }).success).toBe(true);
  });

  it('parses a valid payload with one provenance record', () => {
    expect(GetProvenanceResponseSchema.safeParse({ provenance: [provenance] }).success).toBe(true);
  });

  it('rejects a payload missing the provenance field', () => {
    expect(GetProvenanceResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('EditMemoryRequestSchema', () => {
  it('accepts a valid edit request', () => {
    expect(
      EditMemoryRequestSchema.safeParse({ prose_text: 'x', reason: 'parent_edit' }).success,
    ).toBe(true);
  });

  it('rejects an empty prose_text', () => {
    expect(
      EditMemoryRequestSchema.safeParse({ prose_text: '', reason: 'parent_edit' }).success,
    ).toBe(false);
  });

  it('rejects a prose_text over 2000 chars', () => {
    expect(
      EditMemoryRequestSchema.safeParse({ prose_text: 'x'.repeat(2001), reason: 'parent_edit' })
        .success,
    ).toBe(false);
  });

  it('rejects a reason other than parent_edit', () => {
    expect(EditMemoryRequestSchema.safeParse({ prose_text: 'x', reason: 'other' }).success).toBe(
      false,
    );
  });
});

describe('EditMemoryResponseSchema', () => {
  const node = {
    id: UUID1,
    household_id: UUID2,
    node_type: 'other' as const,
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    forget_reason: null,
    hard_forgotten: false,
    created_at: DT,
    updated_at: DT,
  };

  it('parses a payload wrapping a valid MemoryNode', () => {
    expect(EditMemoryResponseSchema.safeParse({ node }).success).toBe(true);
  });

  it('rejects a payload missing the node field', () => {
    expect(EditMemoryResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('ForgetMemoryRequestSchema', () => {
  it('accepts an empty body (no reason)', () => {
    expect(ForgetMemoryRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a reason', () => {
    expect(ForgetMemoryRequestSchema.safeParse({ reason: 'no longer relevant' }).success).toBe(true);
  });

  it('rejects a reason over 500 chars', () => {
    expect(ForgetMemoryRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('ForgetMemoryResponseSchema', () => {
  const node = {
    id: UUID1,
    household_id: UUID2,
    node_type: 'other' as const,
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: DT,
    forget_reason: 'too spicy',
    hard_forgotten: false,
    created_at: DT,
    updated_at: DT,
  };

  it('parses a payload wrapping a valid MemoryNode', () => {
    expect(ForgetMemoryResponseSchema.safeParse({ node }).success).toBe(true);
  });

  it('rejects a payload missing the node field', () => {
    expect(ForgetMemoryResponseSchema.safeParse({}).success).toBe(false);
  });
});
