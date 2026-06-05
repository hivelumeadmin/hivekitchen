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
  forget_reason: string | null;
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
  'id, household_id, node_type, facet, subject_child_id, prose_text, soft_forget_at, forget_reason, hard_forgotten, created_at, updated_at';

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
      // Exclude hard-forgotten AND soft-forgotten nodes from planner recall.
      // A parent explicitly asking to forget a node means the planner must not
      // use it. Hard-forgotten nodes are also excluded (they may not even exist
      // in the DB post-7-S5 promotion job).
      .eq('hard_forgotten', false)
      .is('soft_forget_at', null)
      .order('created_at', { ascending: false })
      .limit(opts.limit);

    if (opts.facets && opts.facets.length > 0) {
      query = query.in('facet', opts.facets);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MemoryNodeRow[];
  }

  // Story 7-S1 — read path for the Visible Memory page. Returns all
  // non-hard-forgotten nodes (active AND soft-forgotten). Soft-forgotten nodes
  // render with a tombstone view on the client (7-S4). Unlike findNodes()
  // (planner recall), this does NOT filter soft_forget_at — the UI needs
  // both states to show the correct affordance.
  async findActiveNodes(householdId: string): Promise<MemoryNodeRow[]> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select(NODE_COLUMNS)
      .eq('household_id', householdId)
      .eq('hard_forgotten', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as MemoryNodeRow[];
  }

  // Story 7-S2 — ownership-scoped node lookup. Returns null when the node
  // doesn't exist OR belongs to a different household (prevents info leakage).
  async findNodeByIdForHousehold(nodeId: string, householdId: string): Promise<MemoryNodeRow | null> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select(NODE_COLUMNS)
      .eq('id', nodeId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as MemoryNodeRow | null;
  }

  // Story 7-S2 — ordered provenance records for a node, newest first.
  async findProvenanceByNodeId(nodeId: string): Promise<MemoryProvenanceRow[]> {
    const { data, error } = await this.client
      .from('memory_provenance')
      .select(PROVENANCE_COLUMNS)
      .eq('memory_node_id', nodeId)
      .order('captured_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MemoryProvenanceRow[];
  }

  // Story 7-S3 — household-scoped prose edit. The household_id filter is
  // defense-in-depth on top of the service's pre-check; the updated_at column
  // is bumped by the memory_nodes_updated_at trigger.
  // Story 7-S5 review (P1) — the soft_forget_at IS NULL filter closes the D3
  // TOCTOU: if a node is soft-forgotten between editProse's pre-check and this
  // update, the row no longer matches and we return null (service → route 404)
  // instead of writing prose onto a tombstoned node. Mirrors softForgetNode.
  async updateNodeProse(
    nodeId: string,
    householdId: string,
    proseText: string,
  ): Promise<MemoryNodeRow | null> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .update({ prose_text: proseText })
      .eq('id', nodeId)
      .eq('household_id', householdId)
      .is('soft_forget_at', null)
      .select(NODE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as MemoryNodeRow | null;
  }

  // Story 7-S4 — household-scoped soft-forget. The IS NULL guard makes this
  // idempotent: if already soft-forgotten the update matches zero rows and
  // returns null (service → route → 404).
  async softForgetNode(
    nodeId: string,
    householdId: string,
    softForgetAt: string,
    reason: string | null,
  ): Promise<MemoryNodeRow | null> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .update({ soft_forget_at: softForgetAt, forget_reason: reason })
      .eq('id', nodeId)
      .eq('household_id', householdId)
      .is('soft_forget_at', null)
      .select(NODE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as MemoryNodeRow | null;
  }

  // Story 7-S5 — nightly hard-delete of expired soft-forgotten nodes.
  // Deletes all nodes where soft_forget_at IS NOT NULL AND < cutoffAt.
  // memory_provenance cascades automatically (ON DELETE CASCADE).
  // Returns deleted rows for tombstone audit writing.
  async hardDeleteSoftForgotten(
    cutoffAt: string,
  ): Promise<Array<{ id: string; household_id: string; node_type: NodeType }>> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .delete()
      .not('soft_forget_at', 'is', null)
      .lt('soft_forget_at', cutoffAt)
      .select('id, household_id, node_type');
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; household_id: string; node_type: NodeType }>;
  }

  // Story 7-S7 — bulk soft-forget all child-associated memory nodes.
  // Scoped to subject_child_id + household_id; the IS NULL guard is idempotent
  // (already soft-forgotten nodes are not double-stamped). Stamps
  // forget_reason='annual_reset' to mirror the per-node softForgetNode (7-S4)
  // so bulk-reset nodes stay distinguishable in audit queries.
  // Returns the count of rows that were updated.
  async softForgetChildNodes(
    childId: string,
    householdId: string,
    softForgetAt: string,
  ): Promise<number> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .update({ soft_forget_at: softForgetAt, forget_reason: 'annual_reset' })
      .eq('subject_child_id', childId)
      .eq('household_id', householdId)
      .is('soft_forget_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }

  // Story 7-S8 — flat list of (subject_child_id, source_type) for every
  // provenance record attached to an ACTIVE node (not hard-forgotten, not
  // soft-forgotten). The service buckets these into per-child + household-general
  // counts. PostgREST embedded select keeps this one round-trip; at beta scale
  // (< ~100 nodes/household, 1–2 provenance each) no pagination is needed —
  // matches the Epic-7 single-batch doctrine (see softForgetChildNodes, 7-S5 job).
  async findActiveProvenanceSourcesByHousehold(
    householdId: string,
  ): Promise<Array<{ subject_child_id: string | null; source_type: SourceType }>> {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('subject_child_id, memory_provenance(source_type)')
      .eq('household_id', householdId)
      .eq('hard_forgotten', false)
      .is('soft_forget_at', null);
    if (error) throw error;
    type Row = {
      subject_child_id: string | null;
      memory_provenance: Array<{ source_type: SourceType }> | null;
    };
    const out: Array<{ subject_child_id: string | null; source_type: SourceType }> = [];
    for (const row of (data as Row[] | null) ?? []) {
      for (const p of row.memory_provenance ?? []) {
        out.push({ subject_child_id: row.subject_child_id, source_type: p.source_type });
      }
    }
    return out;
  }
}
