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
import type {
  ClearedAllergyEntry,
  PlanDayRow,
  PlanItemRow,
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

  constructor(deps: BriefStateComposerDeps) {
    this.plansRepo = deps.plansRepository;
    this.briefStateRepo = deps.briefStateRepository;
    this.childrenRepo = deps.childrenRepository;
    this.lunchLinkSessionRepo = deps.lunchLinkSessionRepository;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  async refresh(
    householdId: string,
    weekId: string,
    requestId: string,
    opts: { userInitiated?: boolean } = {},
  ): Promise<void> {
    try {
      // Only guardrail-cleared plans populate the projection (presentation-bind
      // contract). findCurrentByHousehold filters guardrail_cleared_at IS NOT NULL,
      // so a pre-clearance plan returns null and the composer no-ops.
      const plan = await this.plansRepo.findCurrentByHousehold({
        householdId,
        weekId,
      });
      if (!plan) {
        this.logger.debug(
          { household_id: householdId, week_id: weekId },
          'brief_state refresh skipped — no cleared plan found for this week',
        );
        return;
      }

      // Story 3.12 — read previous brief_state BEFORE overwriting; needed to
      // compute scaffolding_diff. findByHousehold is also called inside
      // briefStateRepo.upsert() for the revision guard. The previous-brief read
      // is independent of plan.id/children/items, so parallelize all three.
      const [previousBrief, items, children] = await Promise.all([
        this.briefStateRepo.findByHousehold(householdId),
        this.plansRepo.findItemsByPlanId(plan.id),
        this.childrenRepo.findByHouseholdId(householdId),
      ]);
      const previousTileSummaries = previousBrief?.plan_tile_summaries ?? null;

      // Story 3.28 — overlay lunch link suppression state per tile day.
      // Story 4-S4 — overlay per-child ratings; both reads parallelize.
      const [suppressionByDay, ratingsMap] = await Promise.all([
        this.buildSuppressionMap(plan),
        this.buildRatingsMap(plan),
      ]);

      // moment_headline / lumi_note / memory_prose remain '' until the
      // planner agent (Story 3.7) and memory prose composer (Story 5.11) are
      // wired. Empty strings are the correct initial state.
      const upsertInput: BriefStateUpsertInput = {
        household_id: householdId,
        plan_id: plan.id,
        moment_headline: '',
        lumi_note: '',
        memory_prose: '',
        plan_tile_summaries: this.buildTileSummaries(items, suppressionByDay, ratingsMap),
        cleared_allergies: this.buildClearedAllergies(items, children),
        scaffolding_diff: this.buildScaffoldingDiff(
          previousTileSummaries,
          items,
          opts.userInitiated ?? false,
        ),
        generated_at: new Date().toISOString(),
        plan_revision: plan.revision,
      };

      await this.briefStateRepo.upsert(upsertInput);

      this.logger.info(
        { household_id: householdId, plan_id: plan.id, revision: plan.revision },
        'brief_state projection refreshed',
      );
    } catch (err) {
      this.logger.error(
        { household_id: householdId, week_id: weekId, err },
        'brief_state projection refresh failed',
      );
      try {
        await this.auditService.write({
          event_type: 'brief.projection.failure',
          household_id: householdId,
          request_id: requestId,
          metadata: {
            week_id: weekId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch (auditErr) {
        this.logger.error(
          { household_id: householdId, auditErr },
          'audit write failed for brief.projection.failure',
        );
      }
    }
  }

  // plan_items has one row per child × day × slot. Group rows by school day,
  // skipping any non-school day, and emit days in canonical Mon→Sat order.
  // Days with zero items are omitted (school holidays, school-only days a
  // child does not attend, etc.).
  private buildTileSummaries(
    items: PlanItemRow[],
    suppressionByDay: Map<string, string[]>,
    ratingsMap: Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>,
  ): PlanTileSummary[] {
    const byDay = new Map<
      SchoolDay,
      { items: PlanTileSummary['items']; pausedCount: number }
    >();

    for (const item of items) {
      if (!SCHOOL_DAYS.includes(item.day as SchoolDay)) continue;
      const day = item.day as SchoolDay;
      const entry = byDay.get(day) ?? { items: [], pausedCount: 0 };
      entry.items.push({
        plan_item_id: item.id,   // Story 3.12: DB row id for PATCH URL
        child_id: item.child_id,
        slot: item.slot,
        ingredients: item.ingredients,
        ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
        ...(item.item_id != null ? { item_id: item.item_id } : {}),
      });
      if (item.paused_at != null) entry.pausedCount++;
      byDay.set(day, entry);
    }

    return SCHOOL_DAYS.filter((day) => byDay.has(day)).map((day) => {
      const entry = byDay.get(day)!;
      return {
        day,
        items: entry.items,
        // paused:true only when every item in the day is paused (full sick day).
        // Partial-child pause (one child sick, another not) is deferred.
        paused:
          entry.items.length > 0 && entry.pausedCount === entry.items.length,
        // Story 3.28: child UUIDs whose lunch_link_session is suppressed on this day.
        lunch_link_suppressed_children: suppressionByDay.get(day) ?? [],
        // Story 4-S4: Record<child_id, rating> for children who rated this day.
        child_ratings: Object.fromEntries(ratingsMap.get(day) ?? new Map()),
      };
    });
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

  // Story 3.12 — detects ingredient-level changes between the previous
  // brief_state tile summaries and the current plan items. Returns non-null
  // ONLY for system-initiated (Lumi-authored) scaffolding mutations.
  // User-initiated swaps always return null — the parent knows what they
  // changed; surfacing it in QuietDiff would be redundant noise (UX-DR19).
  //
  // "Scaffolding-level" = same constraint profile (slot, child), different
  // ingredients. Safety/allergen changes are blocked by the guardrail before
  // reaching the composer.
  private buildScaffoldingDiff(
    previousTileSummaries: PlanTileSummary[] | null,
    currentItems: PlanItemRow[],
    userInitiated: boolean,
  ): ScaffoldingDiff | null {
    if (userInitiated) return null;
    if (!previousTileSummaries || previousTileSummaries.length === 0) return null;

    // suppressionByDay + ratingsMap are irrelevant for ingredient diff — pass empties.
    const currentSummaries = this.buildTileSummaries(
      currentItems,
      new Map<string, string[]>(),
      new Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>(),
    );

    // Index both sides by `(day, child_id, slot)` so we can enumerate the union
    // and detect additions (curr-only) and removals (prev-only) in addition to
    // updates — silent additions/removals would otherwise reach the user with
    // no QuietDiff banner, violating UX-DR19.
    type Key = string;
    type SlotEntry = { day: SchoolDay; slot: string; ingredients: string[] };
    const indexBy = (summaries: PlanTileSummary[]): Map<Key, SlotEntry> => {
      const out = new Map<Key, SlotEntry>();
      for (const s of summaries) {
        for (const it of s.items) {
          out.set(`${s.day}|${it.child_id}|${it.slot}`, {
            day: s.day,
            slot: it.slot,
            ingredients: it.ingredients,
          });
        }
      }
      return out;
    };
    const prevIndex = indexBy(previousTileSummaries);
    const currIndex = indexBy(currentSummaries);

    // Normalize ingredients so cosmetic differences (case, surrounding
    // whitespace) don't trigger spurious diffs (`'Rice'` vs `'rice'`).
    const norm = (s: string): string => s.trim().toLowerCase();
    const normSet = (xs: string[]): Set<string> => new Set(xs.map(norm));

    // Aggregate by `(day, slot)` pair so two children sharing Monday's main
    // appear once in the explanation, not twice.
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
        const prevSet = normSet(prev.ingredients);
        const currSet = normSet(curr.ingredients);
        const changed =
          curr.ingredients.some((i) => !prevSet.has(norm(i))) ||
          prev.ingredients.some((i) => !currSet.has(norm(i)));
        if (changed) {
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

    // ScaffoldingDiffSchema bounds: summary ≤ 200, explanation ≤ 500. Clamp
    // both so a high-change household never exceeds the contract limits.
    const summary =
      changedPairs.size === 1
        ? clamp(phrases[0]!, 200)
        : clamp(`${String(changedPairs.size)} changes this week`, 200);

    const explanation =
      changedPairs.size > 1 ? clamp(phrases.join('; '), 500) : undefined;

    return { summary, explanation };
  }

  // Emits one entry per (child_id, allergen) pair where the child has at least
  // one declared allergen AND appears at least once in this plan's items.
  // Stable order: children in repo (DB) order, allergens in the order the
  // parent declared them at child-add time.
  //
  // PROXY INVARIANT: this method derives "cleared" structurally — child in
  // plan + has declared allergen — rather than reading the guardrail verdict
  // directly. This is valid because findCurrentByHousehold (line 59) already
  // filters on guardrail_cleared_at IS NOT NULL: a plan only reaches this
  // composer after the agent's allergen guardrail tool has checked every item
  // and swapped any that failed. If a child appears in the committed plan,
  // their allergens were cleared by the guardrail during generation.
  //
  // This proxy should be replaced when guardrail verdict storage lands
  // (planned story: "guardrail verdict persistence per plan item"). That story
  // will store explicit per-(child, allergen, item) verdicts during agent tool
  // execution, and this method will read those stored verdicts instead of
  // deriving cleared status from structural presence alone.
  private buildClearedAllergies(
    items: PlanItemRow[],
    children: DecryptedChildRow[],
  ): ClearedAllergyEntry[] {
    const planChildIds = new Set(items.map((item) => item.child_id));
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
    weekId: string,
    requestId: string,
    opts: { userInitiated?: boolean } = {},
  ): Promise<void> {
    try {
      const plan = await this.plansRepo.findCurrentByHousehold({
        householdId,
        weekId,
      });
      if (!plan) {
        this.logger.debug(
          { household_id: householdId, week_id: weekId },
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
      const previousTileSummaries = previousBrief?.plan_tile_summaries ?? null;

      const upsertInput: BriefStateUpsertInput = {
        household_id: householdId,
        plan_id: plan.id,
        moment_headline: '',
        lumi_note: '',
        memory_prose: '',
        plan_tile_summaries: this.buildTileSummariesTree(
          tree,
          suppressionByDay,
          ratingsMap,
        ),
        cleared_allergies: this.buildClearedAllergiesTree(tree, children),
        scaffolding_diff: this.buildScaffoldingDiffTree(
          previousTileSummaries,
          tree,
          opts.userInitiated ?? false,
        ),
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
        { household_id: householdId, week_id: weekId, err },
        'brief_state tree projection refresh failed',
      );
      try {
        await this.auditService.write({
          event_type: 'brief.projection.failure',
          household_id: householdId,
          request_id: requestId,
          metadata: {
            week_id: weekId,
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
        for (const variation of slotNode.variations) {
          const item: TileItem = {
            plan_item_id: variation.id,
            child_id: variation.child_id,
            slot: slotNode.slot.slot_kind,
            ingredients: [],
            ...(tileRecipeId != null ? { recipe_id: tileRecipeId } : {}),
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
