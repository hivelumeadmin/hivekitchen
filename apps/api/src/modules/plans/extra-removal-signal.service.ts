import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditService } from '../../audit/audit.service.js';
import type { ExtraRulesRepository } from '../children/extra-rules.repository.js';
import type { SignalsService } from '../signals/signals.service.js';

// Story 3.22 — passive bias from repeated Extra removals (FR116).
//
// When a parent swaps out the same Extra component_type BIAS_THRESHOLD times
// within WINDOW_DAYS, the component_type is silently added to that child's
// Extra bans. The planner sees the ban on its next prompt and stops
// proposing that type. Per the product spec there is NO parent confirmation
// or banner — bias is intentionally invisible to the user. Audit visibility
// for ops is provided via the plan.extra_bias_applied event.
//
// Threshold semantics: signals carry bias_applied = false until a bias write
// succeeds, at which point all unapplied signals in the matching window are
// flipped to bias_applied = true. This prevents the same removals from
// triggering the bias on every subsequent removal (which would re-add the
// type to bans on every swap, even after the duplicate-guard).
const BIAS_THRESHOLD = 3;
const WINDOW_DAYS = 30;

export interface ExtraRemovalSignalServiceDeps {
  client: SupabaseClient;
  extraRulesRepo: ExtraRulesRepository;
  auditService: AuditService;
  logger: FastifyBaseLogger;
  // Story 15-s2 — signals-log dual-write. NOTE: this service currently has no
  // production caller (the flat swapItem path was retired in 3-DM-C1;
  // plans.service.ts:477-489); the dual-write ships at the seam so the log is
  // complete when the re-wiring slice lands a caller.
  signalsService?: Pick<SignalsService, 'record'>;
}

export interface RecordRemovalInput {
  householdId: string;
  childId: string;
  componentType: string;
  planItemId: string;
  requestId: string;
}

export class ExtraRemovalSignalService {
  private readonly client: SupabaseClient;
  private readonly extraRulesRepo: ExtraRulesRepository;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;
  private readonly signalsService?: Pick<SignalsService, 'record'>;

  constructor(deps: ExtraRemovalSignalServiceDeps) {
    this.client = deps.client;
    this.extraRulesRepo = deps.extraRulesRepo;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
    this.signalsService = deps.signalsService;
  }

  // Called when a parent swaps out an Extra plan_item. Records the removal
  // signal and, if the rolling-window threshold is met, silently extends the
  // child's Extra bans. Errors are logged but never thrown — bias is
  // a soft signal and must not break the swap path.
  async recordRemoval(input: RecordRemovalInput): Promise<void> {
    const componentType = input.componentType.trim().toLowerCase();
    if (componentType === '') return;

    // Story 15-s2 — dual-write to the append-only signals log (record() never
    // throws). Written UNCONDITIONALLY, before the legacy insert: the signal
    // records that the parent removed the Extra — an event, not a store update
    // — so a legacy-insert failure must not lose it (log ⊇ stores; doctrine
    // resolved in the 15-s2 code review).
    await this.signalsService?.record({
      household_id: input.householdId,
      child_id: input.childId,
      subject_ref: { plan_item_id: input.planItemId ?? null },
      payload: { kind: 'extra_removal', component_type: componentType },
      occurred_at: new Date().toISOString(),
      source: 'app',
    });

    const { error: insertError } = await this.client
      .from('extra_removal_signals')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        component_type: componentType,
        plan_item_id: input.planItemId,
      });
    if (insertError) {
      this.logger.error(
        { err: insertError, child_id: input.childId, component_type: componentType },
        'extra-removal-signal: failed to insert signal — continuing',
      );
      return;
    }

    const windowStartIso = computeWindowStartIso(WINDOW_DAYS);
    const { count, error: countError } = await this.client
      .from('extra_removal_signals')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', input.householdId)
      .eq('child_id', input.childId)
      .eq('component_type', componentType)
      .eq('bias_applied', false)
      .gte('removed_at', windowStartIso);

    if (countError || count === null) {
      this.logger.error(
        { err: countError, child_id: input.childId, component_type: componentType },
        'extra-removal-signal: failed to count signals — continuing',
      );
      return;
    }

    if (count >= BIAS_THRESHOLD) {
      await this.applyBias({
        householdId: input.householdId,
        childId: input.childId,
        componentType,
        requestId: input.requestId,
        windowStartIso,
      });
    }
  }

  // Adds component_type to the child's Extra bans. Story 15-s5 moved these
  // from a JSONB array to child_extra_rules rows, so the append is a plain
  // INSERT guarded by the (child_id, rule, component_type) unique index: two
  // concurrent applyBias calls for *different* component types write different
  // rows and cannot overwrite each other, and a repeat of the same type is a
  // no-op. Marks all matching unapplied signals as bias_applied so the
  // threshold counter resets cleanly.
  private async applyBias(opts: {
    householdId: string;
    childId: string;
    componentType: string;
    requestId: string;
    windowStartIso: string;
  }): Promise<void> {
    let result;
    try {
      result = await this.extraRulesRepo.appendBanAtomic({
        childId: opts.childId,
        householdId: opts.householdId,
        componentType: opts.componentType,
      });
    } catch (err) {
      // Write failure (network, permission). Leave signals unapplied so the
      // next swap can retry.
      this.logger.error(
        { err, child_id: opts.childId, component_type: opts.componentType },
        'extra-removal-signal: extra-rules ban insert failed — bias not applied',
      );
      return;
    }

    if (result === null) {
      // Cross-household guard fired or the child no longer exists. Leave the
      // signals unapplied so a retry (e.g., on the next swap) can succeed.
      this.logger.warn(
        { child_id: opts.childId, household_id: opts.householdId },
        'extra-removal-signal: child not found for household — bias not applied',
      );
      return;
    }

    // Both 'appended' and 'already_banned' are terminal-success states for the
    // signal counter: flip the signals so future removals start a fresh window.
    await this.markSignalsApplied(opts);

    if (result.status === 'already_banned') {
      // No new ban was written — skip audit + info log to keep the audit log
      // signal clean (a no-op append is not a behavioral change for the planner).
      return;
    }

    try {
      await this.auditService.write({
        event_type: 'plan.extra_bias_applied',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          child_id: opts.childId,
          component_type: opts.componentType,
          action: 'added_to_bans',
        },
      });
    } catch (err) {
      this.logger.error(
        { err, child_id: opts.childId },
        'extra-removal-signal: audit write failed for plan.extra_bias_applied — bias is applied',
      );
    }

    this.logger.info(
      { child_id: opts.childId, component_type: opts.componentType },
      'extra bias applied: component_type added to the child Extra bans',
    );
  }

  private async markSignalsApplied(opts: {
    householdId: string;
    childId: string;
    componentType: string;
    windowStartIso: string;
  }): Promise<void> {
    const { error } = await this.client
      .from('extra_removal_signals')
      .update({ bias_applied: true })
      .eq('household_id', opts.householdId)
      .eq('child_id', opts.childId)
      .eq('component_type', opts.componentType)
      .eq('bias_applied', false)
      .gte('removed_at', opts.windowStartIso);
    if (error) {
      this.logger.error(
        { err: error, child_id: opts.childId, component_type: opts.componentType },
        'extra-removal-signal: failed to flip bias_applied — signals may double-trigger',
      );
    }
  }
}

// Pure helper exported for tests — keeps the date math deterministic and
// avoids leaking `new Date()` calls into assertions.
export function computeWindowStartIso(windowDays: number, now: Date = new Date()): string {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - windowDays);
  return start.toISOString();
}

export const EXTRA_REMOVAL_BIAS_THRESHOLD = BIAS_THRESHOLD;
export const EXTRA_REMOVAL_WINDOW_DAYS = WINDOW_DAYS;
