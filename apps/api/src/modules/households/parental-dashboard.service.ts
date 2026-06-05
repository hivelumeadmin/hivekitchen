import type { ParentalDashboardResponse, MemorySourceCounts } from '@hivekitchen/types';
import type { ChildrenRepository } from '../children/children.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import type { ComplianceRepository } from '../compliance/compliance.repository.js';

// Slice doc 7-S8 + 7-S7 demo path both cite "Voice retention (90d default)".
// No per-household retention column exists yet; this surfaces the documented
// system-wide default. When per-household voice-retention settings ship, read
// the stored value here instead of the constant.
const VOICE_TRANSCRIPT_RETENTION_DAYS = 90;
const RECENT_VPC_LIMIT = 5;

function emptyCounts(): MemorySourceCounts {
  return { onboarding: 0, turn: 0, tool: 0, user_edit: 0, plan_outcome: 0, import: 0 };
}

export interface ParentalDashboardDeps {
  childrenRepository: ChildrenRepository;
  memoryRepository: MemoryRepository;
  culturalPriorRepository: CulturalPriorRepository;
  complianceRepository: ComplianceRepository;
}

export class ParentalDashboardService {
  constructor(private readonly deps: ParentalDashboardDeps) {}

  async getDashboard(householdId: string): Promise<ParentalDashboardResponse> {
    const [children, priors, provenanceSources, recentConsents] = await Promise.all([
      this.deps.childrenRepository.findByHouseholdId(householdId),
      this.deps.culturalPriorRepository.findByHousehold(householdId),
      this.deps.memoryRepository.findActiveProvenanceSourcesByHousehold(householdId),
      this.deps.complianceRepository.findRecentConsentsByHousehold(householdId, RECENT_VPC_LIMIT),
    ]);

    // Bucket provenance records by subject_child_id (null → household-general).
    // We count provenance RECORDS, not nodes: an edited node carries both an
    // 'onboarding' and a 'user_edit' provenance row, so it contributes +1 to
    // each bucket. This is intentional — each provenance row is a distinct
    // collection event. Do not "fix" this into node-counting.
    const countsByChild = new Map<string, MemorySourceCounts>();
    const generalCounts = emptyCounts();
    for (const { subject_child_id, source_type } of provenanceSources) {
      let bucket: MemorySourceCounts;
      if (subject_child_id === null) {
        bucket = generalCounts;
      } else {
        let existing = countsByChild.get(subject_child_id);
        if (!existing) {
          existing = emptyCounts();
          countsByChild.set(subject_child_id, existing);
        }
        bucket = existing;
      }
      bucket[source_type] += 1;
    }

    return {
      household: {
        cultural_priors: priors
          .filter((p) => p.state !== 'forgotten')
          .map((p) => ({ key: p.key, label: p.label, tier: p.tier, state: p.state })),
        voice_retention_days: VOICE_TRANSCRIPT_RETENTION_DAYS,
        recent_vpc_events: recentConsents.map((c) => ({
          mechanism: c.mechanism,
          document_version: c.document_version,
          signed_at: c.signed_at,
        })),
        general_memory_node_counts: generalCounts,
      },
      children: children.map((c) => ({
        child_id: c.id,
        name: c.name,
        age_band: c.age_band,
        declared_allergens: c.declared_allergens,
        dietary_preferences: c.dietary_preferences,
        memory_node_counts: countsByChild.get(c.id) ?? emptyCounts(),
      })),
    };
  }
}
