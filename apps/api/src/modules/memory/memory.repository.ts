import { BaseRepository } from '../../repository/base.repository.js';
import type { NodeType, SourceType } from '@hivekitchen/types';

export interface MemoryNodeRow {
  id: string;
  household_id: string;
  node_type: NodeType;
  facet: string;
  subject_child_id: string | null;
  prose_text: string;
  soft_forget_at: string | null;
  hard_forgotten: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryProvenanceRow {
  id: string;
  memory_node_id: string;
  source_type: SourceType;
  source_ref: Record<string, unknown>;
  captured_at: string;
  captured_by: string | null;
  confidence: number;
  superseded_by: string | null;
}

export interface InsertNodeInput {
  household_id: string;
  node_type: NodeType;
  facet: string;
  prose_text: string;
  subject_child_id: string | null;
}

export interface InsertProvenanceInput {
  memory_node_id: string;
  source_type: SourceType;
  source_ref: Record<string, unknown>;
  captured_by: string | null;
  confidence: number;
}

const NODE_COLUMNS =
  'id, household_id, node_type, facet, subject_child_id, prose_text, soft_forget_at, hard_forgotten, created_at, updated_at';

const PROVENANCE_COLUMNS =
  'id, memory_node_id, source_type, source_ref, captured_at, captured_by, confidence, superseded_by';

export class MemoryRepository extends BaseRepository {
  async insertNode(input: InsertNodeInput): Promise<MemoryNodeRow> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .insert(input)
      .select(NODE_COLUMNS)
      .single();
    if (error) throw error;
    if (!data) throw new Error('insertNode returned no data');
    return data as MemoryNodeRow;
  }

  async insertProvenance(input: InsertProvenanceInput): Promise<MemoryProvenanceRow> {
    const { data, error } = await this.client
      .from('memory_provenance')
      .insert(input)
      .select(PROVENANCE_COLUMNS)
      .single();
    if (error) throw error;
    if (!data) throw new Error('insertProvenance returned no data');
    return data as MemoryProvenanceRow;
  }

  async findNodes(opts: {
    household_id: string;
    facets?: string[];
    limit: number;
  }): Promise<MemoryNodeRow[]> {
    let query = this.client
      .from('memory_nodes')
      .select(NODE_COLUMNS)
      .eq('household_id', opts.household_id)
      // Exclude hard-forgotten nodes — soft-forgotten ones still surface so the
      // planner can reason about explicit user signals; the forget job promotes
      // them to hard-forgotten when retention expires.
      .eq('hard_forgotten', false)
      .order('created_at', { ascending: false })
      .limit(opts.limit);

    if (opts.facets && opts.facets.length > 0) {
      query = query.in('facet', opts.facets);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MemoryNodeRow[];
  }
}
