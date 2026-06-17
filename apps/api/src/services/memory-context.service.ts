import type { SupabaseClient } from '@supabase/supabase-js';

// Migration 20260904000300 narrowed node_type to 3 values.
// Old 'preference' and 'cultural_rhythm' nodes were remapped to 'other';
// they now appear in l0Preferences. l1MethodPriors covers 'rhythm'.
// culturalObligations is kept for interface compatibility but will be empty
// until a dedicated cultural enum value is reintroduced.
export interface MemoryContextForPlanning {
  l0Preferences: string[];
  l1MethodPriors: string[];
  culturalObligations: string[];
}

interface MemoryNodeRow {
  node_type: 'rhythm' | 'child_obsession' | 'other';
  prose_text: string;
}

const MEMORY_COLUMNS = 'node_type, prose_text';
const PLANNING_NODE_TYPES = ['rhythm', 'child_obsession', 'other'] as const;

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

    for (const node of (data as MemoryNodeRow[] | null) ?? []) {
      if (node.node_type === 'rhythm') {
        l1MethodPriors.push(node.prose_text);
      } else {
        l0Preferences.push(node.prose_text);
      }
    }

    return { l0Preferences, l1MethodPriors, culturalObligations: [] };
  }
}
