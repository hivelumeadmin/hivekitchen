import type { SupabaseClient } from '@supabase/supabase-js';

// L0 = preference (relational, no opt-in needed). Applied silently.
// L1 = rhythm / cultural_rhythm (inferred priors). Soft signal — preferred,
// not required. Both surface as natural-language strings for the planner
// prompt; no schema parsing on the LLM side.
export interface MemoryContextForPlanning {
  l0Preferences: string[];
  l1MethodPriors: string[];
  culturalObligations: string[];
}

interface MemoryNodeRow {
  node_type: 'preference' | 'rhythm' | 'cultural_rhythm';
  prose_text: string;
}

const MEMORY_COLUMNS = 'node_type, prose_text';
const PLANNING_NODE_TYPES = ['preference', 'rhythm', 'cultural_rhythm'] as const;

export class MemoryContextService {
  constructor(private readonly client: SupabaseClient) {}

  async getContextForPlanning(householdId: string): Promise<MemoryContextForPlanning> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select(MEMORY_COLUMNS)
      .eq('household_id', householdId)
      .eq('hard_forgotten', false)
      .is('soft_forget_at', null)
      .in('node_type', PLANNING_NODE_TYPES);

    if (error) throw error;

    const l0Preferences: string[] = [];
    const l1MethodPriors: string[] = [];
    const culturalObligations: string[] = [];

    for (const node of (data as MemoryNodeRow[] | null) ?? []) {
      if (node.node_type === 'preference') {
        l0Preferences.push(node.prose_text);
      } else if (node.node_type === 'cultural_rhythm') {
        culturalObligations.push(node.prose_text);
      } else {
        l1MethodPriors.push(node.prose_text);
      }
    }

    return { l0Preferences, l1MethodPriors, culturalObligations };
  }
}
