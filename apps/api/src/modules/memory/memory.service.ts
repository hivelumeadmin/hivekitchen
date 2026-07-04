import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  NodeType,
  SourceType,
  MemoryNoteOutput,
  MemoryRecallInput,
  MemoryRecallOutput,
} from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { MemoryNodeRow, MemoryProvenanceRow, MemoryRepository } from './memory.repository.js';

export interface MemoryServiceDeps {
  repository: MemoryRepository;
  logger: FastifyBaseLogger;
  audit?: AuditService;
}

export interface OnboardingSeedSummary {
  cultural_templates?: string[];
  palate_notes?: string[];
  allergens_mentioned?: string[];
  family_rhythms?: string[];
}

export interface SeedFromOnboardingInput {
  householdId: string;
  userId: string;
  threadId: string;
  summaryTurnId: string;
  summary: OnboardingSeedSummary;
}

export interface NoteFromAgentInput {
  householdId: string;
  nodeType: NodeType;
  facet: string;
  proseText: string;
  subjectChildId: string | null;
  confidence: number;
  sourceType?: SourceType; // defaults to 'tool'; 5-S7 passes 'turn'
  sourceRef?: Record<string, unknown>;
}

interface SeedNodeSpec {
  node_type: NodeType;
  facet: string;
  prose_text: string;
}

const FACET_MAX = 200;
const PROSE_MAX = 2000;

const truncate = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max));

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';

const ONBOARDING_CONFIDENCE = 0.8;

export class MemoryService {
  private readonly repository: MemoryRepository;
  private readonly logger: FastifyBaseLogger;
  private readonly audit?: AuditService;

  constructor(deps: MemoryServiceDeps) {
    this.repository = deps.repository;
    this.logger = deps.logger;
    this.audit = deps.audit;
  }

  async seedFromOnboarding(input: SeedFromOnboardingInput): Promise<{ nodeCount: number }> {
    const nodes = this.buildNodeSpecs(input.summary);
    if (nodes.length === 0) {
      return { nodeCount: 0 };
    }

    const sourceRef = { thread_id: input.threadId, turn_id: input.summaryTurnId };

    let nodeCount = 0;
    for (const spec of nodes) {
      let nodeId: string;
      try {
        const node = await this.repository.insertNode({
          household_id: input.householdId,
          node_type: spec.node_type,
          facet: spec.facet,
          prose_text: spec.prose_text,
          subject_child_id: null,
        });
        nodeId = node.id;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        this.logger.warn(
          {
            err,
            module: 'memory',
            action: 'memory.seed_node_insert_failed',
            household_id: input.householdId,
            node_type: spec.node_type,
          },
          'memory node insert failed during onboarding seed — skipping spec',
        );
        continue;
      }

      try {
        await this.repository.insertProvenance({
          memory_node_id: nodeId,
          source_type: 'onboarding',
          source_ref: sourceRef,
          captured_by: input.userId,
          confidence: ONBOARDING_CONFIDENCE,
        });
      } catch (err) {
        // Partial seeding is acceptable per Story 2.13 (Epic 7 reconciles
        // orphaned nodes during the forget job).
        this.logger.warn(
          {
            err,
            module: 'memory',
            action: 'memory.seed_provenance_insert_failed',
            household_id: input.householdId,
            memory_node_id: nodeId,
          },
          'memory provenance insert failed during onboarding seed — node retained without provenance',
        );
      }
      nodeCount += 1;
    }

    if (this.audit && nodeCount > 0) {
      try {
        await this.audit.write({
          event_type: 'memory.seeded',
          household_id: input.householdId,
          user_id: input.userId,
          request_id: randomUUID(),
          metadata: {
            node_count: nodeCount,
            source_type: 'onboarding',
            thread_id: input.threadId,
          },
        });
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'memory',
            action: 'memory.audit_write_failed',
            household_id: input.householdId,
          },
          'memory.seeded audit write failed — best-effort, continuing',
        );
      }
    }

    return { nodeCount };
  }

  // Story 7-S1 — UI read path for the Visible Memory page (active nodes only).
  async findActive(householdId: string): Promise<MemoryNodeRow[]> {
    return this.repository.findActiveNodes(householdId);
  }

  // Story 7-S2 — provenance for a single node scoped to the caller's household.
  // Returns null when the node is not found or belongs to a different household.
  async getProvenance(nodeId: string, householdId: string): Promise<MemoryProvenanceRow[] | null> {
    const node = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
    if (!node) return null;
    return this.repository.findProvenanceByNodeId(nodeId);
  }

  // Story 7-S3 — edit a memory sentence scoped to the caller's household.
  // Returns null when the node is absent or cross-household (route → 404).
  // Provenance + audit are best-effort: the prose update is the committed
  // effect, metadata writes must not fail the edit (matches seedFromOnboarding).
  async editProse(
    nodeId: string,
    householdId: string,
    userId: string,
    proseText: string,
    reason: 'parent_edit',
  ): Promise<MemoryNodeRow | null> {
    const existing = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
    if (!existing) return null;
    if (existing.soft_forget_at !== null) return null; // D3 close — tombstoned node → 404

    const updated = await this.repository.updateNodeProse(nodeId, householdId, proseText);
    if (!updated) return null;

    try {
      await this.repository.insertProvenance({
        memory_node_id: nodeId,
        source_type: 'user_edit',
        source_ref: { reason },
        captured_by: userId,
        confidence: 1.0,
      });
    } catch (err) {
      this.logger.warn(
        { err, module: 'memory', action: 'memory.edit_provenance_insert_failed', memory_node_id: nodeId },
        'user_edit provenance insert failed — prose updated, provenance skipped',
      );
    }

    if (this.audit) {
      try {
        await this.audit.write({
          event_type: 'memory.updated',
          household_id: householdId,
          user_id: userId,
          request_id: randomUUID(),
          metadata: { node_id: nodeId, node_type: updated.node_type, reason },
        });
      } catch (err) {
        this.logger.warn(
          { err, module: 'memory', action: 'memory.audit_write_failed', memory_node_id: nodeId },
          'memory.updated audit write failed — best-effort, continuing',
        );
      }
    }

    return updated;
  }

  // Story 7-S4 — soft-forget a memory sentence scoped to the caller's household.
  // Returns null when the node is absent, cross-household, OR already
  // soft-forgotten (all → route 404). Audit is best-effort: a failure does
  // NOT fail the forget (matches seedFromOnboarding + editProse patterns).
  async softForget(
    nodeId: string,
    householdId: string,
    userId: string,
    reason: string | null,
  ): Promise<MemoryNodeRow | null> {
    const existing = await this.repository.findNodeByIdForHousehold(nodeId, householdId);
    if (!existing) return null;
    if (existing.soft_forget_at !== null) return null; // already forgotten → 404

    const softForgetAt = new Date().toISOString();
    const updated = await this.repository.softForgetNode(nodeId, householdId, softForgetAt, reason);
    if (!updated) return null;

    if (this.audit) {
      try {
        await this.audit.write({
          event_type: 'memory.forgotten',
          household_id: householdId,
          user_id: userId,
          request_id: randomUUID(),
          metadata: {
            node_id: nodeId,
            node_type: updated.node_type,
            reason: reason ?? null,
          },
        });
      } catch (err) {
        this.logger.warn(
          { err, module: 'memory', action: 'memory.audit_write_failed', memory_node_id: nodeId },
          'memory.forgotten audit write failed — best-effort, continuing',
        );
      }
    }

    return updated;
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallOutput> {
    const rows = await this.repository.findNodes({
      household_id: input.household_id,
      facets: input.facets,
      limit: input.limit,
    });
    return {
      nodes: rows.map((n) => ({
        node_id: n.id,
        node_type: n.node_type,
        facet: n.facet,
        prose_text: n.prose_text,
        subject_child_id: n.subject_child_id,
        // memory_nodes does not currently store per-node confidence; provenance
        // does. The planner's recall view treats unsourced reads as fully
        // confident — provenance-aware confidence is a later refinement.
        confidence: 1.0,
      })),
    };
  }

  async noteFromAgent(input: NoteFromAgentInput): Promise<MemoryNoteOutput> {
    const node = await this.repository.insertNode({
      household_id: input.householdId,
      node_type: input.nodeType,
      facet: truncate(input.facet, FACET_MAX),
      prose_text: truncate(input.proseText, PROSE_MAX),
      subject_child_id: input.subjectChildId,
    });
    await this.repository.insertProvenance({
      memory_node_id: node.id,
      source_type: input.sourceType ?? 'tool',
      source_ref: input.sourceRef ?? {},
      captured_by: null,
      confidence: input.confidence,
    });
    return { node_id: node.id, created_at: node.created_at };
  }

  private buildNodeSpecs(summary: OnboardingSeedSummary): SeedNodeSpec[] {
    const out: SeedNodeSpec[] = [];
    const seen = new Set<string>();

    for (const allergen of summary.allergens_mentioned ?? []) {
      const a = allergen.trim();
      if (a.length === 0) continue;
      const facet = truncate(a, FACET_MAX);
      const key = `allergy:${facet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node_type: 'other', facet, prose_text: `Declared allergy: ${a}` });
    }

    for (const template of summary.cultural_templates ?? []) {
      const t = template.trim();
      if (t.length === 0) continue;
      const facet = truncate(t, FACET_MAX);
      const key = `cultural_rhythm:${facet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node_type: 'other', facet, prose_text: `Cultural identity: ${t}` });
    }

    for (const note of summary.palate_notes ?? []) {
      const n = note.trim();
      if (n.length === 0) continue;
      const facet = truncate(n, FACET_MAX);
      const key = `preference:${facet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node_type: 'other', facet, prose_text: n });
    }

    for (const rhythm of summary.family_rhythms ?? []) {
      const r = rhythm.trim();
      if (r.length === 0) continue;
      const facet = truncate(r, FACET_MAX);
      const key = `rhythm:${facet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node_type: 'rhythm', facet, prose_text: r });
    }

    return out;
  }
}
