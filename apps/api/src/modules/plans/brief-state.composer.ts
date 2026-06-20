import type { FastifyBaseLogger } from 'fastify';
import type { PlansRepository } from './plans.repository.js';
import type {
  BriefStateRepository,
  BriefStateUpsertInput,
} from './brief-state.repository.js';
import type {
  ChildrenRepository,
  DecryptedChildRow,
} from '../children/children.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { LunchLinkSessionRepository } from './lunch-link-session.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type { SnackSkuRepository } from '../recipe/snack-sku.repository.js';
import type {
  ClearedAllergyEntry,
  PlanDayRow,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PlanTileSummary,
  ScaffoldingDiff,
  Weekday,
} from '@hivekitchen/types';

export interface BriefStateComposerDeps {
  plansRepository: PlansRepository;
  briefStateRepository: BriefStateRepository;
  childrenRepository: ChildrenRepository;
  // Story 3.28: optional so existing tests that don't wire lunch link remain valid.
  lunchLinkSessionRepository?: LunchLinkSessionRepository;
  auditService: AuditService;
  logger: FastifyBaseLogger;
  // Slice 5-S8: optional so existing tests that construct the composer without a
  // memory repo remain valid. When absent, buildLearningMomentCallout returns null.
  memoryRepository?: MemoryRepository;
  // Story 3-S40 (AC6): optional so existing tests remain valid. When absent,
  // snack-SKU tiles carry snack_sku_id but no resolved display name.
  snackSkuRepository?: SnackSkuRepository;
}

const SCHOOL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type SchoolDay = (typeof SCHOOL_DAYS)[number];

// Tier B projection writer (architecture §1.5). Refreshes brief_state on
// plan.updated / memory.updated / thread.turn. Story 3.6 wires only the
// plan.updated trigger (PlansService.commit()); memory.updated and thread.turn
// land in Stories 5.11 and Epic 5 respectively — that is why this composer is
// exposed as a Fastify decorator (briefStateComposer) rather than coupled to
// the plans module.
//
// Critical: refresh() MUST NOT throw. The triggering event always succeeds
// regardless of projection write outcome. All errors are caught, logged, and
// audited as brief.projection.failure.
export class BriefStateComposer {
  private readonly plansRepo: PlansRepository;
  private readonly briefStateRepo: BriefStateRepository;
  private readonly childrenRepo: ChildrenRepository;
  private readonly lunchLinkSessionRepo: LunchLinkSessionRepository | undefined;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;
  private readonly memoryRepository: MemoryRepository | undefined;
  private readonly snackSkuRepository: SnackSkuRepository | undefined;

  constructor(deps: BriefStateComposerDeps) {
    this.plansRepo = deps.plansRepository;
    this.briefStateRepo = deps.briefStateRepository;
    this.childrenRepo = deps.childrenRepository;
    this.lunchLinkSessionRepo = deps.lunchLinkSessionRepository;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
    this.memoryRepository = deps.memoryRepository;
    this.snackSkuRepository = deps.snackSkuRepository;
  }

  // Slice 5-S8 — evaluate the "I noticed" threshold. Returns a callout when ≥3
  // turn-sourced memory nodes exist for the household within the 7-day window
  // AND the suppress window (set by a prior dismiss) has elapsed. Returns null
  // otherwise — including when no memory repository is wired (e.g. in tests).
  private async buildLearningMomentCallout(
    householdId: string,
    suppressedUntil: string | null,
  ): Promise<{ prose: string; node_ids: string[]; surfaced_at: string } | null> {
    if (!this.memoryRepository) return null; // not wired in tests
    if (suppressedUntil && new Date(suppressedUntil) > new Date()) return null; // AC#6

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nodes = await this.memoryRepository.findRecentTurnSourcedNodes(householdId, since);

    if (nodes.length < 3) return null; // AC#8 — threshold not met

    // Build prose from the most-recently-created node (first in desc-order result).
    const best = nodes[0]!;
    const prose = `I've noticed ${best.prose_text} — want me to keep that in mind?`.slice(0, 400);
    const nodeIds = nodes.slice(0, 5).map((n) => n.id);

    return { prose, node_ids: nodeIds, surfaced_at: new Date().toISOString() };
  }

  // Slice 5-S8 — respond to a surfaced learning moment. Patches ONLY the callout
  // fields in the existing brief_state row (no full refreshTree, which would
  // re-evaluate and potentially immediately re-surface the callout). Idempotent:
  // a no-op when there is no active callout. On 'dismiss', sets a 7-day suppress
  // window; 'confirm' / 'tell_more' carry the existing window forward (AC#3–#5).
  async respondToLearningMoment(
    householdId: string,
    action: 'confirm' | 'tell_more' | 'dismiss',
    requestId: string,
  ): Promise<void> {
    const current = await this.briefStateRepo.findByHousehold(householdId);
    if (!current || !current.payload.learning_moment_callout) {
      return; // no callout to respond to — idempotent no-op
    }

    const suppressedUntil =
      action === 'dismiss'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : current.payload.learning_moment_suppressed_until;

    await this.briefStateRepo.upsert({
      household_id: householdId,
      plan_id: current.plan_id,
      moment_headline: current.moment_headline,
      lumi_note: current.lumi_note,
      memory_prose: current.memory_prose,
      payload: {
        ...current.payload,
        learning_moment_callout: null,
        learning_moment_suppressed_until: suppressedUntil ?? null,
      },
      generated_at: current.generated_at,
      plan_revision: current.plan_revision,
    });

    const auditEventType =
      action === 'confirm'
        ? 'memory.learning_moment_confirmed'
        : action === 'dismiss'
          ? 'memory.learning_moment_dismissed'
          : 'memory.learning_moment_tell_more';

    try {
      await this.auditService.write({
        event_type: auditEventType,
        household_id: householdId,
        request_id: requestId,
        metadata: { action },
      });
    } catch (auditErr) {
      this.logger.warn(
        { auditErr, household_id: householdId },
        'audit write failed for learning moment respond — non-fatal',
      );
    }
  }


  // Story 4-S4 — one DB query per brief refresh. Same shape as
  // buildSuppressionMap but returns Map<day, Map<child_id, rating>>. Empty map
  // when week_of is absent or lunchLinkSessionRepo is not wired.
  private async buildRatingsMap(
    plan: PlanRow,
  ): Promise<Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>> {
    const weekOf = plan.week_of;
    if (!this.lunchLinkSessionRepo || !weekOf) {
      return new Map();
    }

    const monday = new Date(weekOf + 'T00:00:00Z');
    const saturday = new Date(monday);
    saturday.setUTCDate(monday.getUTCDate() + 5);
    const dateTo = saturday.toISOString().split('T')[0]!;

    const ratingsByDate = await this.lunchLinkSessionRepo.findRatingsInRange(
      plan.household_id,
      weekOf,
      dateTo,
    );

    const dayOffsets: Array<[SchoolDay, number]> = [
      ['monday', 0],
      ['tuesday', 1],
      ['wednesday', 2],
      ['thursday', 3],
      ['friday', 4],
      ['saturday', 5],
    ];

    return new Map(
      dayOffsets.map(([day, offset]) => {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + offset);
        const dateStr = d.toISOString().split('T')[0]!;
        return [day, ratingsByDate.get(dateStr) ?? new Map()];
      }),
    );
  }

  // Story 3.28 / D1-C — one DB query per brief refresh. Derives the calendar
  // date for each tile day from plan.week_of (the Monday of the plan week),
  // then returns a Map<day, childIds[]> for use in buildTileSummaries. Returns
  // an empty map when week_of is absent or lunchLinkSessionRepo is not wired.
  private async buildSuppressionMap(plan: PlanRow): Promise<Map<string, string[]>> {
    const weekOf = plan.week_of;
    if (!this.lunchLinkSessionRepo || !weekOf) {
      return new Map();
    }

    // Date arithmetic in UTC to avoid DST surprises.
    const monday = new Date(weekOf + 'T00:00:00Z');
    const saturday = new Date(monday);
    saturday.setUTCDate(monday.getUTCDate() + 5);
    const dateTo = saturday.toISOString().split('T')[0]!;

    const suppressedByDate = await this.lunchLinkSessionRepo.findSuppressedChildrenInRange(
      plan.household_id,
      weekOf,
      dateTo,
    );

    const dayOffsets: Array<[SchoolDay, number]> = [
      ['monday', 0],
      ['tuesday', 1],
      ['wednesday', 2],
      ['thursday', 3],
      ['friday', 4],
      ['saturday', 5],
    ];

    return new Map(
      dayOffsets.map(([day, offset]) => {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + offset);
        const dateStr = d.toISOString().split('T')[0]!;
        return [day, suppressedByDate.get(dateStr) ?? []];
      }),
    );
  }

  // ==========================================================================
  // Story 3-DM-C1 — Tree-shape composition (Phase 4).
  //
  // refreshTree() implements canonical §9.1's 8-read pattern: plan +
  // main_assignments + plan_days + plan_slots + plan_slot_variations +
  // children + suppression + ratings. Composes an in-memory tree, walks it
  // to produce the same brief_state output shape as the flat refresh(),
  // upserts in one call.
  //
  // Coexists with the flat refresh() during the cutover window. Phase 9
  // swaps the seven call sites (lunch-link.routes, day-overrides.service x2,
  // plans.service x4) from refresh() → refreshTree() and deletes the flat
  // path.
  //
  // Output-shape note: the per-tile `ingredients` field is emitted as an
  // empty array in the tree path. The canonical tile owns no ingredients —
  // they live on the recipe (via main_assignment → recipes, or slot.recipe_id
  // directly). Frontend lookup of recipe ingredients is a separate read in
  // the canonical model. This intentional shape difference is the seam where
  // D1's BriefStatePayloadSchema cleanup picks up.
  // ==========================================================================

  async refreshTree(
    householdId: string,
    weekOf: string,
    requestId: string,
    opts: { userInitiated?: boolean; planReasoning?: string | null } = {},
  ): Promise<void> {
    try {
      const plan = await this.plansRepo.findCurrentByHousehold({
        householdId,
        weekOf,
      });
      if (!plan) {
        this.logger.debug(
          { household_id: householdId, week_of: weekOf },
          'brief_state refreshTree skipped — no cleared plan found for this week',
        );
        return;
      }

      // §9.1 step 2 — 7-way parallel read. The previous-brief read joins as an
      // 8th parallel leg so scaffolding-diff has its baseline ready by the
      // time the tree is composed.
      const [
        previousBrief,
        mainAssignments,
        days,
        children,
        suppressionByDay,
        ratingsMap,
      ] = await Promise.all([
        this.briefStateRepo.findByHousehold(householdId),
        this.plansRepo.findMainAssignmentsByPlanId(plan.id),
        this.plansRepo.findDaysByPlanId(plan.id),
        this.childrenRepo.findByHouseholdId(householdId),
        this.buildSuppressionMap(plan),
        this.buildRatingsMap(plan),
      ]);

      // slots + variations depend on day ids — fan out after days resolves.
      // Two reads, parallelized.
      const dayIds = days.map((d) => d.id);
      const slots = await this.plansRepo.findSlotsByDayIds(dayIds);
      const slotIds = slots.map((s) => s.id);
      const variations = await this.plansRepo.findVariationsBySlotIds(slotIds);

      const tree = composePlanTree({ days, mainAssignments, slots, variations });
      const previousTileSummaries = previousBrief?.payload?.tile_summaries ?? null;

      // Story 3-S40 (AC6) — resolve snack-SKU display names for the tile dish
      // line. Snack-SKU slots have no recipe_id, so they never get a name from
      // the recipe-name projection; batch-read snack_skus.name here. No-op when
      // the repository isn't wired (existing tests) or no snack slots exist.
      const snackSkuIds = [
        ...new Set(
          slots
            .map((s) => (s as { snack_sku_id?: string | null }).snack_sku_id)
            .filter((id): id is string => id != null),
        ),
      ];
      const snackSkuNames =
        this.snackSkuRepository && snackSkuIds.length > 0
          ? await this.snackSkuRepository.findNamesByIds(snackSkuIds)
          : new Map<string, string>();

      // Slice 5-S8 — "I noticed" learning-moment callout. Read the suppress
      // window from the previous payload, then evaluate the turn-sourced
      // threshold. Sequential (after the parallel block) because it needs
      // previousBrief; returns null early for households with no candidates.
      const suppressedUntil =
        previousBrief?.payload?.learning_moment_suppressed_until ?? null;
      const learningMomentCallout = await this.buildLearningMomentCallout(
        householdId,
        suppressedUntil,
      );

      const upsertInput: BriefStateUpsertInput = {
        household_id: householdId,
        plan_id: plan.id,
        moment_headline: '',
        lumi_note: '',
        memory_prose: '',
        payload: {
          tile_summaries: this.buildTileSummariesTree(
            tree,
            suppressionByDay,
            ratingsMap,
            snackSkuNames,
          ),
          cleared_allergies: this.buildClearedAllergiesTree(tree, children),
          scaffolding_diff: this.buildScaffoldingDiffTree(
            previousTileSummaries,
            tree,
            opts.userInitiated ?? false,
          ),
          // Story 3-DM-D1 — carry forward the plan_state mirror from the
          // previous payload so a brief refresh does NOT silently clear a
          // degraded state that was set between commits. The mirror is cleared
          // only via PlansRepository.clearDegradedPlanState (sovereignty-mode
          // selection); the composer never re-evaluates degradation.
          plan_state: previousBrief?.payload?.plan_state ?? null,
          plan_state_set_at: previousBrief?.payload?.plan_state_set_at ?? null,
          plan_state_message: previousBrief?.payload?.plan_state_message ?? null,
          // Slice 5-S8 — learning moment callout + carried-forward suppress window.
          learning_moment_callout: learningMomentCallout,
          learning_moment_suppressed_until: suppressedUntil,
          // Slice 5-S9 — set plan reasoning from commit opts, else carry forward
          // from the previous payload (swap/variation/pause refreshes never zero it).
          // null = explicit clear (new commit with no reasoning); undefined = carry forward.
          plan_reasoning:
            opts.planReasoning !== undefined
              ? (opts.planReasoning ?? null)
              : (previousBrief?.payload?.plan_reasoning ?? null),
        },
        generated_at: new Date().toISOString(),
        plan_revision: plan.revision,
      };

      await this.briefStateRepo.upsert(upsertInput);

      this.logger.info(
        { household_id: householdId, plan_id: plan.id, revision: plan.revision },
        'brief_state projection refreshed via tree-shape composer',
      );
    } catch (err) {
      this.logger.error(
        { household_id: householdId, week_of: weekOf, err },
        'brief_state tree projection refresh failed',
      );
      try {
        await this.auditService.write({
          event_type: 'brief.projection.failure',
          household_id: householdId,
          request_id: requestId,
          metadata: {
            week_of: weekOf,
            error: err instanceof Error ? err.message : String(err),
            path: 'refreshTree',
          },
        });
      } catch (auditErr) {
        this.logger.error(
          { household_id: householdId, auditErr },
          'audit write failed for brief.projection.failure (refreshTree)',
        );
      }
    }
  }

  // Walks the composed tree and emits the same PlanTileSummary[] shape as the
  // flat buildTileSummaries. The per-tile `ingredients` field is intentionally
  // an empty array in tree mode (see class-level note above). Per-tile
  // `paused` reflects either the day-level pause OR every variation paused.
  private buildTileSummariesTree(
    tree: PlanTree,
    suppressionByDay: Map<string, string[]>,
    ratingsMap: Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>,
    snackSkuNames: ReadonlyMap<string, string> = new Map(),
  ): PlanTileSummary[] {
    const out: PlanTileSummary[] = [];
    for (const dayNode of tree.days) {
      if (!SCHOOL_DAYS.includes(dayNode.day as SchoolDay)) continue;

      type TileItem = PlanTileSummary['items'][number];
      const tileItems: TileItem[] = [];
      let pausedCount = 0;
      let totalCount = 0;

      for (const slotNode of dayNode.slots) {
        // Resolve recipe FK for the tile: main slots dereference via M-grouping.
        const tileRecipeId =
          slotNode.slot.slot_kind === 'main'
            ? slotNode.mainAssignment?.recipe_id ?? null
            : slotNode.slot.recipe_id;

        if (slotNode.variations.length === 0) {
          // Slot has no variations — emit a single tile item with no
          // child_id placeholder. This branch is defensive; legal tree
          // composition produces at least one variation per slot.
          continue;
        }
        // Story 3-S40 — snack-SKU slots carry snack_sku_id instead of recipe_id.
        const tileSnackSkuId = (slotNode.slot as { snack_sku_id?: string | null }).snack_sku_id ?? null;
        // AC6 — resolve the SKU's display name for the tile dish line.
        const tileSnackName =
          tileSnackSkuId != null ? snackSkuNames.get(tileSnackSkuId) ?? null : null;

        for (const variation of slotNode.variations) {
          const item: TileItem = {
            plan_item_id: variation.id,
            child_id: variation.child_id,
            slot: slotNode.slot.slot_kind,
            ingredients: [],
            ...(tileRecipeId != null ? { recipe_id: tileRecipeId } : {}),
            ...(tileSnackSkuId != null ? { snack_sku_id: tileSnackSkuId } : {}),
            ...(tileSnackName != null ? { name: tileSnackName } : {}),
          };
          tileItems.push(item);
          totalCount++;
          if (
            dayNode.day_row.paused_at != null ||
            slotNode.slot.paused_at != null ||
            variation.paused_at != null
          ) {
            pausedCount++;
          }
        }
      }

      if (tileItems.length === 0) continue;

      out.push({
        day: dayNode.day as SchoolDay,
        items: tileItems,
        paused: totalCount > 0 && pausedCount === totalCount,
        lunch_link_suppressed_children:
          suppressionByDay.get(dayNode.day) ?? [],
        child_ratings: Object.fromEntries(ratingsMap.get(dayNode.day) ?? new Map()),
      });
    }
    return SCHOOL_DAYS.filter((d) => out.find((t) => t.day === d)).map(
      (d) => out.find((t) => t.day === d)!,
    );
  }

  // Same semantics as buildClearedAllergies: per-(child, allergen) entries
  // for children who appear at least once in the plan's variations and have
  // at least one declared allergen.
  private buildClearedAllergiesTree(
    tree: PlanTree,
    children: DecryptedChildRow[],
  ): ClearedAllergyEntry[] {
    const planChildIds = new Set<string>();
    for (const dayNode of tree.days) {
      for (const slotNode of dayNode.slots) {
        for (const variation of slotNode.variations) {
          planChildIds.add(variation.child_id);
        }
      }
    }
    const entries: ClearedAllergyEntry[] = [];
    for (const child of children) {
      if (!planChildIds.has(child.id)) continue;
      if (child.declared_allergens.length === 0) continue;
      for (const allergen of child.declared_allergens) {
        entries.push({
          child_id: child.id,
          child_name: child.name,
          allergen,
        });
      }
    }
    return entries;
  }

  // Tree-mode scaffolding diff. Reuses the same (day, child, slot) pair
  // index as the flat path so the QuietDiff phrases stay consistent.
  // Ingredient comparison in tree mode uses recipe_id swaps as the trigger
  // (because per-tile ingredients are empty in tree mode); the flat path's
  // per-string diff retires when D1's BriefStatePayloadSchema lands.
  private buildScaffoldingDiffTree(
    previousTileSummaries: PlanTileSummary[] | null,
    tree: PlanTree,
    userInitiated: boolean,
  ): ScaffoldingDiff | null {
    if (userInitiated) return null;
    if (!previousTileSummaries || previousTileSummaries.length === 0) return null;

    // Reuse the tree-builder with empty suppression / ratings to produce
    // the current shape. Then index both sides by (day, child, slot).
    const currentSummaries = this.buildTileSummariesTree(
      tree,
      new Map<string, string[]>(),
      new Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>(),
    );

    type Key = string;
    type SlotEntry = { day: SchoolDay; slot: string; recipe_id: string | undefined };
    const indexBy = (summaries: PlanTileSummary[]): Map<Key, SlotEntry> => {
      const out = new Map<Key, SlotEntry>();
      for (const s of summaries) {
        for (const it of s.items) {
          out.set(`${s.day}|${it.child_id}|${it.slot}`, {
            day: s.day,
            slot: it.slot,
            recipe_id: it.recipe_id,
          });
        }
      }
      return out;
    };
    const prevIndex = indexBy(previousTileSummaries);
    const currIndex = indexBy(currentSummaries);

    const updatedPairs = new Set<string>();
    const addedPairs = new Set<string>();
    const removedPairs = new Set<string>();
    const phraseBy = new Map<string, string>();

    const allKeys = new Set<Key>([...prevIndex.keys(), ...currIndex.keys()]);
    for (const key of allKeys) {
      const prev = prevIndex.get(key);
      const curr = currIndex.get(key);
      const entry = prev ?? curr!;
      const day = entry.day.charAt(0).toUpperCase() + entry.day.slice(1);
      const pairKey = `${entry.day}|${entry.slot}`;
      if (prev && curr) {
        if (prev.recipe_id !== curr.recipe_id) {
          updatedPairs.add(pairKey);
          phraseBy.set(pairKey, `${day}'s ${entry.slot} updated`);
        }
      } else if (curr && !prev) {
        addedPairs.add(pairKey);
        phraseBy.set(pairKey, `${day}'s ${entry.slot} added`);
      } else if (prev && !curr) {
        removedPairs.add(pairKey);
        phraseBy.set(pairKey, `${day}'s ${entry.slot} removed`);
      }
    }

    const changedPairs = new Set<string>([
      ...updatedPairs,
      ...addedPairs,
      ...removedPairs,
    ]);
    if (changedPairs.size === 0) return null;

    const phrases = [...changedPairs].map((p) => phraseBy.get(p)!);
    const clamp = (raw: string, max: number): string =>
      raw.length > max ? raw.slice(0, max - 1) + '…' : raw;

    const summary =
      changedPairs.size === 1
        ? clamp(phrases[0]!, 200)
        : clamp(`${String(changedPairs.size)} changes this week`, 200);

    const explanation =
      changedPairs.size > 1 ? clamp(phrases.join('; '), 500) : undefined;

    return { summary, explanation };
  }
}

// ===========================================================================
// Story 3-DM-C1 Phase 4 — pure tree-composition helper. Exported for testing.
//
// Given the four parallel reads from §9.1, build an in-memory tree:
//   PlanTree
//     ├── days[]: PlanTreeDay
//     │     ├── day_row: PlanDayRow
//     │     └── slots[]: PlanTreeSlot
//     │           ├── slot: PlanSlotRow
//     │           ├── mainAssignment?: PlanMainAssignmentRow   (only when slot_kind=main)
//     │           └── variations[]: PlanSlotVariationRow
//     └── mainAssignmentsBySequence: Map<sequence, PlanMainAssignmentRow>
//
// Days are sorted Mon→Sat (DB order is alphabetic which puts 'friday' before
// 'monday'). Slots inside each day are sorted main → snack → extra for
// stable iteration.
// ===========================================================================

export interface PlanTreeSlot {
  slot: PlanSlotRow;
  mainAssignment: PlanMainAssignmentRow | undefined;
  variations: PlanSlotVariationRow[];
}

export interface PlanTreeDay {
  day: Weekday;
  day_row: PlanDayRow;
  slots: PlanTreeSlot[];
}

export interface PlanTree {
  days: PlanTreeDay[];
  mainAssignmentsBySequence: Map<number, PlanMainAssignmentRow>;
  mainAssignmentsById: Map<string, PlanMainAssignmentRow>;
}

const WEEKDAY_ORDER: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const SLOT_KIND_ORDER: Record<string, number> = {
  main: 1,
  snack: 2,
  extra: 3,
};

export function composePlanTree(input: {
  days: PlanDayRow[];
  mainAssignments: PlanMainAssignmentRow[];
  slots: PlanSlotRow[];
  variations: PlanSlotVariationRow[];
}): PlanTree {
  const mainAssignmentsBySequence = new Map<number, PlanMainAssignmentRow>();
  const mainAssignmentsById = new Map<string, PlanMainAssignmentRow>();
  for (const ma of input.mainAssignments) {
    mainAssignmentsBySequence.set(ma.sequence, ma);
    mainAssignmentsById.set(ma.id, ma);
  }

  const slotsByDay = new Map<string, PlanSlotRow[]>();
  for (const slot of input.slots) {
    const arr = slotsByDay.get(slot.plan_day_id) ?? [];
    arr.push(slot);
    slotsByDay.set(slot.plan_day_id, arr);
  }

  const variationsBySlot = new Map<string, PlanSlotVariationRow[]>();
  for (const variation of input.variations) {
    const arr = variationsBySlot.get(variation.plan_slot_id) ?? [];
    arr.push(variation);
    variationsBySlot.set(variation.plan_slot_id, arr);
  }

  const days: PlanTreeDay[] = input.days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER[a.day] - WEEKDAY_ORDER[b.day])
    .map((dayRow) => {
      const daySlots = slotsByDay.get(dayRow.id) ?? [];
      const sortedSlots = daySlots
        .slice()
        .sort(
          (a, b) =>
            (SLOT_KIND_ORDER[a.slot_kind] ?? 99) -
            (SLOT_KIND_ORDER[b.slot_kind] ?? 99),
        );
      const slots: PlanTreeSlot[] = sortedSlots.map((slot) => ({
        slot,
        mainAssignment:
          slot.main_assignment_id !== null
            ? mainAssignmentsById.get(slot.main_assignment_id)
            : undefined,
        variations: variationsBySlot.get(slot.id) ?? [],
      }));
      return { day: dayRow.day, day_row: dayRow, slots };
    });

  return { days, mainAssignmentsBySequence, mainAssignmentsById };
}
