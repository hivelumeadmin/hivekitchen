import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditWriteInput } from '../../audit/audit.types.js';
import { authenticateHook } from '../../middleware/authenticate.hook.js';
import { isDomainError } from '../../common/errors.js';
import { childrenRoutes } from './children.routes.js';
import { PlansRepository } from '../plans/plans.repository.js';
import { PlanAdjustmentService } from '../plans/plan-adjustment.service.js';
import type { LunchLinkSessionRepository } from '../plans/lunch-link-session.repository.js';

const SAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

// Story 3-DM-B2 — encrypted JSONB columns (declared_allergens,
// cultural_identifiers, dietary_preferences) dropped from `children`; data
// now lives in household_allergens / household_cultural_identifiers /
// dietary_preferences (child_id=NULL for the household-scoped tags).
// Story 3-DM-B1 — bag_composition jsonb + allergen_rule_version dropped;
// 3 new variation-driving enums + promoted bag_composition_pattern enum take
// their place.
interface ChildRowDb {
  id: string;
  household_id: string;
  name: string;
  age_band: 'toddler' | 'child' | 'preteen' | 'teen';
  school_policy_notes: string | null;
  appetite_level: 'light' | 'normal' | 'heavy';
  texture_needs: 'soft' | 'mixed' | 'normal';
  spice_tolerance: 'mild' | 'regular' | 'spicy';
  bag_composition_pattern:
    | 'main_only'
    | 'main_plus_snack'
    | 'main_plus_extra'
    | 'main_plus_snack_plus_extra';
  extra_rules: { pins: string[]; bans: string[] };
  // Story 7-S7 — annual flavor-journey reset cooldown timestamp (NULL = never).
  flavor_journey_reset_at?: string | null;
  created_at: string;
  updated_at: string;
}

// Story 3.16 — school_policies + plans rows for the policy-update routes.
interface SchoolPolicyRowDb {
  id: string;
  child_id: string;
  policy_type: string;
  policy_description: string | null;
  slot_scope: 'bag_wide' | 'main' | 'snack' | 'extra';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PlanRowForPropagation {
  id: string;
  household_id: string;
  week_id: string;
  week_of: string;
  revision: number;
  guardrail_cleared_at: string | null;
}

// Story 3.28 — in-memory store for lunch_link_sessions mock repository.
interface LunchLinkSession {
  suppressed_at: string | null;
  suppressed_by_user_id: string | null;
}

// Story 3-DM-B2 — `household_allergens` is the canonical single-source store.
// child_id is nullable: NULL = household-wide row, non-NULL = per-child.
interface HouseholdAllergenRowDb {
  id: string;
  household_id: string;
  child_id: string | null;
  // NOOP-prefixed ciphertext of the allergen plaintext.
  allergen: string;
  allergen_hash: string;
  source: string;
  created_at: string;
  updated_at: string;
}

interface HouseholdCulturalIdentifierRowDb {
  household_id: string;
  cultural_tag: string;
  enforcement: 'non_negotiable' | 'strong' | 'default' | 'soft' | 'just_for_context';
  source: string;
}

interface DietaryPreferenceRowDb {
  id: string;
  household_id: string;
  child_id: string | null;
  tag: string;
  enforcement: 'non_negotiable' | 'strong' | 'default' | 'soft' | 'just_for_context';
  source: string;
}

interface MockDbState {
  children: ChildRowDb[];
  ackedUserIds: Set<string>;
  insertSpy?: (row: ChildRowDb) => void;
  // Story 3.16
  schoolPolicies: SchoolPolicyRowDb[];
  plans: PlanRowForPropagation[];
  // Story 3.28
  lunchLinkSessions: Map<string, LunchLinkSession>;  // key: `${childId}:${date}`
  // Story 3-DM-B2 — single-source allergen storage (per-child + household
  // wide in one table). Mock for the renamed PostgREST table.
  householdAllergens: HouseholdAllergenRowDb[];
  householdCulturalIdentifiers: HouseholdCulturalIdentifierRowDb[];
  dietaryPreferences: DietaryPreferenceRowDb[];
  // Slice 4-S12 — child_preferences rows (with embedded recipes) for the
  // FlavorPassport endpoint.
  childPreferences: unknown[];
}

// In-memory Supabase mock — children + users (for parental_notice gate).
// Lets the real ChildrenRepository + ChildrenService + ComplianceService run
// end-to-end with NOOP encryption. The point is to confirm route wiring,
// audit context, RBAC, and the encryption boundary in one harness.
function buildMockSupabase(state: MockDbState) {
  return {
    from(table: string) {
      if (table === 'children') return childrenTable(state);
      if (table === 'users') return usersTable(state);
      if (table === 'households') return householdsTable();
      if (table === 'vpc_consents') return vpcConsentsNoop();
      if (table === 'school_policies') return schoolPoliciesTable(state);
      if (table === 'plans') return plansTable(state);
      if (table === 'household_allergens') return householdAllergensTable(state);
      if (table === 'household_cultural_identifiers')
        return householdCulturalIdentifiersTable(state);
      if (table === 'dietary_preferences') return dietaryPreferencesTable(state);
      if (table === 'child_preferences') return childPreferencesTable(state);
      if (table === 'memory_nodes') return memoryNodesTable();
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(_fnName: string) {
      return Promise.resolve({ data: [], error: null });
    },
  };
}

// In-memory supabase for school_policies. Implements only the fluent-chain
// shapes the SchoolPoliciesRepository actually calls.
function schoolPoliciesTable(state: MockDbState) {
  return {
    upsert(row: {
      child_id: string;
      policy_type: string;
      policy_description: string | null;
      slot_scope: SchoolPolicyRowDb['slot_scope'];
      is_active: boolean;
    }) {
      const idx = state.schoolPolicies.findIndex(
        (p) => p.child_id === row.child_id && p.policy_type === row.policy_type,
      );
      const now = '2026-05-05T11:00:00.000Z';
      let stored: SchoolPolicyRowDb;
      if (idx === -1) {
        stored = {
          id: randomUUID(),
          child_id: row.child_id,
          policy_type: row.policy_type,
          policy_description: row.policy_description,
          slot_scope: row.slot_scope,
          is_active: row.is_active,
          created_at: now,
          updated_at: now,
        };
        state.schoolPolicies.push(stored);
      } else {
        stored = {
          ...state.schoolPolicies[idx]!,
          policy_description: row.policy_description,
          slot_scope: row.slot_scope,
          is_active: row.is_active,
          updated_at: now,
        };
        state.schoolPolicies[idx] = stored;
      }
      return {
        select() {
          return {
            single: vi.fn().mockResolvedValue({ data: stored, error: null }),
          };
        },
      };
    },
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order() {
          // mock ignores ordering — list is already deterministic by insertion
          return Promise.resolve({
            data: state.schoolPolicies.filter(
              (p) =>
                p.child_id === filters.child_id &&
                (filters.is_active === undefined || p.is_active === filters.is_active),
            ),
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

// In-memory supabase for plans. Only supports the .findActiveFuturePlanIds()
// query: select('id, week_id, week_of, revision').eq('household_id').gte('week_of').not('guardrail_cleared_at','is',null).
function plansTable(state: MockDbState) {
  return {
    select() {
      const filters: Record<string, unknown> = {};
      let weekOfMin: string | undefined;
      let requireClearedNotNull = false;
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        gte(column: string, value: string) {
          if (column === 'week_of') weekOfMin = value;
          return chain;
        },
        not(column: string) {
          if (column === 'guardrail_cleared_at') requireClearedNotNull = true;
          return Promise.resolve({
            data: state.plans
              .filter((p) => p.household_id === filters.household_id)
              .filter((p) => weekOfMin === undefined || p.week_of >= weekOfMin)
              .filter((p) => !requireClearedNotNull || p.guardrail_cleared_at !== null)
              .map((p) => ({
                id: p.id,
                week_id: p.week_id,
                week_of: p.week_of,
                revision: p.revision,
              })),
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

function childrenTable(state: MockDbState) {
  return {
    insert(row: Omit<
      ChildRowDb,
      'id' | 'appetite_level' | 'texture_needs' | 'spice_tolerance' | 'bag_composition_pattern' | 'extra_rules' | 'created_at' | 'updated_at'
    >) {
      return {
        select() {
          return {
            single: vi.fn().mockImplementation(async () => {
              const stored: ChildRowDb = {
                id: randomUUID(),
                household_id: row.household_id,
                name: row.name,
                age_band: row.age_band,
                school_policy_notes: row.school_policy_notes,
                // Story 3-DM-B1 — DB defaults for the new enum columns.
                appetite_level: 'normal',
                texture_needs: 'normal',
                spice_tolerance: 'mild',
                bag_composition_pattern: 'main_plus_snack_plus_extra',
                extra_rules: { pins: [], bans: [] },
                created_at: '2026-04-28T10:00:00.000Z',
                updated_at: '2026-04-28T10:00:00.000Z',
              };
              state.children.push(stored);
              state.insertSpy?.(stored);
              return { data: stored, error: null };
            }),
          };
        },
      };
    },
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const row = state.children.find(
            (c) => c.id === filters.id && c.household_id === filters.household_id,
          );
          return { data: row ?? null, error: null };
        }),
      };
      return chain;
    },
    update(patch: Partial<ChildRowDb>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        select() {
          return {
            maybeSingle: vi.fn().mockImplementation(async () => {
              const idx = state.children.findIndex(
                (c) => c.id === filters.id && c.household_id === filters.household_id,
              );
              if (idx === -1) return { data: null, error: null };
              state.children[idx] = { ...state.children[idx]!, ...patch };
              return { data: state.children[idx], error: null };
            }),
          };
        },
      };
      return chain;
    },
  };
}

function usersTable(state: MockDbState) {
  return {
    select() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const userId = filters.id as string | undefined;
          if (!userId) return { data: null, error: null };
          const acked = state.ackedUserIds.has(userId);
          return {
            data: {
              parental_notice_acknowledged_at: acked ? '2026-04-28T09:00:00.000Z' : null,
              parental_notice_acknowledged_version: acked ? 'v1' : null,
            },
            error: null,
          };
        }),
      };
      return chain;
    },
  };
}

function householdsTable() {
  // KEK is null in tests → repository never reads encrypted_dek and never
  // updates the row. A no-op shape suffices.
  return {
    select() {
      return {
        eq() {
          return {
            maybeSingle: async () => ({ data: { encrypted_dek: null }, error: null }),
          };
        },
      };
    },
    update() {
      return { eq: async () => ({ error: null }) };
    },
  };
}

function vpcConsentsNoop() {
  return {
    select() {
      return {
        eq: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      };
    },
  };
}

interface BuildAppOpts {
  state: MockDbState;
  capturedAudit?: { value: AuditWriteInput | undefined };
  // Story 3.16 — capture queue.add() calls for assertion.
  queueAddSpy?: ReturnType<typeof vi.fn>;
  // Story 3.16 — capture explicit auditService.write() calls (the school-
  // policy routes write through fastify.auditService directly, not via
  // request.auditContext like the older bag-composition route).
  auditWriteSpy?: ReturnType<typeof vi.fn>;
}

async function buildTestApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const env = { NODE_ENV: 'development' as const, JWT_SECRET };
  app.decorate('env', env as unknown as FastifyInstance['env']);
  app.decorate(
    'supabase',
    buildMockSupabase(opts.state) as unknown as FastifyInstance['supabase'],
  );

  // Story 3.16 — minimum viable bullmq + auditService decorators so the
  // children-routes plugin can construct SchoolPoliciesService.
  const queueAdd = opts.queueAddSpy ?? vi.fn().mockResolvedValue({ id: 'mock-job' });
  app.decorate('bullmq', {
    getQueue: vi.fn().mockReturnValue({ add: queueAdd }),
    getWorker: vi.fn(),
  } as unknown as FastifyInstance['bullmq']);
  const auditWrite = opts.auditWriteSpy ?? vi.fn().mockResolvedValue(undefined);
  app.decorate('auditService', {
    write: auditWrite,
  } as unknown as FastifyInstance['auditService']);

  // Story 3.17 — childrenRoutes consumes planAdjustmentService via the
  // decorator (instead of constructing its own plans plumbing). Use the real
  // service so the integration test exercises the dispatcher end-to-end and
  // queueAddSpy still observes the regen fanout.
  const planAdjustmentDeps = {
    plansRepository: new PlansRepository(
      buildMockSupabase(opts.state) as unknown as FastifyInstance['supabase'],
    ),
    regenQueue: { add: queueAdd } as unknown as ConstructorParameters<
      typeof PlanAdjustmentService
    >[0]['regenQueue'],
    auditService: { write: auditWrite } as unknown as FastifyInstance['auditService'],
    logger: app.log,
  };
  app.decorate(
    'planAdjustmentService',
    new PlanAdjustmentService(planAdjustmentDeps) as unknown as FastifyInstance['planAdjustmentService'],
  );

  // Story 3.28 — childrenRoutes checks for this decorator at registration time.
  app.decorate(
    'lunchLinkSessionRepository',
    buildMockLunchLinkRepo(opts.state) as unknown as FastifyInstance['lunchLinkSessionRepository'],
  );

  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '15m' } });
  await app.register(authenticateHook);

  if (opts.capturedAudit) {
    app.addHook('onResponse', async (request) => {
      opts.capturedAudit!.value = request.auditContext;
    });
  }

  app.setErrorHandler((err, request, reply) => {
    if (isDomainError(err)) {
      void reply.status(err.status).type('application/problem+json').send({
        type: err.type,
        status: err.status,
        title: err.title,
        detail: err.detail,
        instance: request.id,
      });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
        instance: request.id,
      });
      return;
    }
    const obj = err as { validation?: unknown; cause?: unknown };
    if (obj.cause instanceof ZodError) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        detail: obj.cause.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
        instance: request.id,
      });
      return;
    }
    if (Array.isArray(obj.validation) && obj.validation.length > 0) {
      void reply.status(400).type('application/problem+json').send({
        type: '/errors/validation',
        status: 400,
        title: 'Validation failed',
        instance: request.id,
      });
      return;
    }
    void reply.status(500).send({ type: '/errors/internal', status: 500 });
  });

  await app.register(childrenRoutes);
  await app.ready();
  return app;
}

function emptyState(opts: {
  acked?: string[];
  insertSpy?: (row: ChildRowDb) => void;
  plans?: PlanRowForPropagation[];
  schoolPolicies?: SchoolPolicyRowDb[];
} = {}): MockDbState {
  return {
    children: [],
    ackedUserIds: new Set(opts.acked ?? []),
    insertSpy: opts.insertSpy,
    plans: opts.plans ?? [],
    schoolPolicies: opts.schoolPolicies ?? [],
    lunchLinkSessions: new Map(),
    householdAllergens: [],
    householdCulturalIdentifiers: [],
    dietaryPreferences: [],
    childPreferences: [],
  };
}

// Slice 4-S12 — minimal child_preferences mock for the FlavorPassport endpoint.
// FlavorPassportRepository calls .select(embed).eq('child_id').eq('household_id')
// .in('signal_type', [...]) and awaits the result.
function childPreferencesTable(state: MockDbState) {
  return {
    select() {
      const chain = {
        eq() {
          return chain;
        },
        in() {
          return Promise.resolve({ data: state.childPreferences, error: null });
        },
      };
      return chain;
    },
    // Story 7-S7 — deleteByChild: .delete().eq().eq().select('recipe_id').
    delete() {
      const chain = {
        eq() {
          return chain;
        },
        select() {
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
}

// Story 7-S7 — memory_nodes mock for the reset cascade. The route's
// FlavorJourneyResetService bulk soft-forgets via
// .update().eq().eq().is().select('id').
function memoryNodesTable() {
  return {
    update() {
      const chain = {
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        select() {
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
}

// Story 3-DM-B2 — mock for the consolidated household_allergens table.
// child_id is nullable (NULL = household-wide). PostgREST shapes exercised by
// HouseholdAllergensRepository:
//   - upsert({...}, { onConflict: 'household_id,child_id,allergen_hash',
//                     ignoreDuplicates: true }).select(...).maybeSingle()
//   - select(cols).eq('household_id', id)
//   - delete().eq('household_id', id).eq('child_id', childId)
function householdAllergensTable(state: MockDbState) {
  return {
    upsert(
      payload: {
        household_id: string;
        child_id: string | null;
        allergen: string;
        allergen_hash: string;
        source: string;
        updated_at?: string;
      },
      opts: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      return {
        select(_cols: string) {
          return {
            maybeSingle: async () => {
              const existing = state.householdAllergens.find(
                (a) =>
                  a.household_id === payload.household_id &&
                  a.child_id === payload.child_id &&
                  a.allergen_hash === payload.allergen_hash,
              );
              if (existing) {
                if (opts.ignoreDuplicates === true) {
                  return { data: null, error: null };
                }
                existing.updated_at = payload.updated_at ?? new Date().toISOString();
                existing.source = payload.source;
                return { data: { id: existing.id }, error: null };
              }
              const now = payload.updated_at ?? new Date().toISOString();
              const stored: HouseholdAllergenRowDb = {
                id: randomUUID(),
                household_id: payload.household_id,
                child_id: payload.child_id,
                allergen: payload.allergen,
                allergen_hash: payload.allergen_hash,
                source: payload.source,
                created_at: now,
                updated_at: now,
              };
              state.householdAllergens.push(stored);
              return { data: { id: stored.id }, error: null };
            },
          };
        },
      };
    },
    select(_cols: string) {
      return {
        eq(_col: string, householdId: string) {
          const rows = state.householdAllergens
            .filter((a) => a.household_id === householdId)
            .map((a) => ({
              household_id: a.household_id,
              child_id: a.child_id,
              allergen: a.allergen,
              source: a.source,
            }));
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
    delete() {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        then(resolve: (v: { error: null }) => void) {
          const before = state.householdAllergens.length;
          state.householdAllergens = state.householdAllergens.filter(
            (a) =>
              !(
                (filters.household_id === undefined ||
                  a.household_id === filters.household_id) &&
                (filters.child_id === undefined || a.child_id === filters.child_id)
              ),
          );
          void before;
          resolve({ error: null });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
}

// Story 3-DM-B2 — mock for household_cultural_identifiers.
// Composite PK (household_id, cultural_tag); upsert with
// onConflict='household_id,cultural_tag', ignoreDuplicates=true.
function householdCulturalIdentifiersTable(state: MockDbState) {
  return {
    upsert(
      payload:
        | Array<{
            household_id: string;
            cultural_tag: string;
            enforcement?: HouseholdCulturalIdentifierRowDb['enforcement'];
            source: string;
          }>
        | {
            household_id: string;
            cultural_tag: string;
            enforcement?: HouseholdCulturalIdentifierRowDb['enforcement'];
            source: string;
          },
      opts: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const existing = state.householdCulturalIdentifiers.find(
          (r) => r.household_id === row.household_id && r.cultural_tag === row.cultural_tag,
        );
        if (existing !== undefined) {
          if (opts.ignoreDuplicates === true) continue;
          existing.source = row.source;
          continue;
        }
        state.householdCulturalIdentifiers.push({
          household_id: row.household_id,
          cultural_tag: row.cultural_tag,
          enforcement: row.enforcement ?? 'default',
          source: row.source,
        });
      }
      return Array.isArray(payload)
        ? Promise.resolve({ error: null })
        : {
            select(_cols: string) {
              return {
                maybeSingle: async () => ({
                  data: { household_id: rows[0]!.household_id },
                  error: null,
                }),
              };
            },
          };
    },
    select(_cols: string) {
      return {
        eq(_col: string, householdId: string) {
          const rows = state.householdCulturalIdentifiers.filter(
            (r) => r.household_id === householdId,
          );
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

// Story 3-DM-B2 — mock for the existing dietary_preferences table extended
// to carry household-scoped rows (child_id=NULL). COALESCE-sentinel UNIQUE
// (household_id, COALESCE(child_id, sentinel), tag); upsert with
// onConflict='household_id,tag', ignoreDuplicates=true for household rows.
function dietaryPreferencesTable(state: MockDbState) {
  return {
    upsert(
      payload:
        | Array<{
            household_id: string;
            child_id: string | null;
            tag: string;
            source: string;
            enforcement?: DietaryPreferenceRowDb['enforcement'];
          }>
        | {
            household_id: string;
            child_id: string | null;
            tag: string;
            source: string;
            enforcement?: DietaryPreferenceRowDb['enforcement'];
          },
      opts: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const existing = state.dietaryPreferences.find(
          (r) =>
            r.household_id === row.household_id &&
            r.child_id === row.child_id &&
            r.tag === row.tag,
        );
        if (existing !== undefined) {
          if (opts.ignoreDuplicates === true) continue;
          existing.source = row.source;
          continue;
        }
        state.dietaryPreferences.push({
          id: randomUUID(),
          household_id: row.household_id,
          child_id: row.child_id,
          tag: row.tag,
          enforcement: row.enforcement ?? 'default',
          source: row.source,
        });
      }
      return Array.isArray(payload)
        ? Promise.resolve({ error: null })
        : {
            select(_cols: string) {
              return {
                maybeSingle: async () => ({
                  data: { id: state.dietaryPreferences[0]?.id ?? 'mock' },
                  error: null,
                }),
              };
            },
          };
    },
    select(_cols: string) {
      const filters: Record<string, unknown> = {};
      let childIdIsNull = false;
      const chain = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        is(column: string, value: null) {
          if (column === 'child_id' && value === null) childIdIsNull = true;
          return chain;
        },
        then(resolve: (v: { data: Array<{ tag: string }>; error: null }) => void) {
          const rows = state.dietaryPreferences
            .filter(
              (r) =>
                (filters.household_id === undefined ||
                  r.household_id === filters.household_id) &&
                (!childIdIsNull || r.child_id === null),
            )
            .map((r) => ({ tag: r.tag }));
          resolve({ data: rows, error: null });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

// Story 3.28 — build a mock LunchLinkSessionRepository backed by the state map.
function buildMockLunchLinkRepo(state: MockDbState): LunchLinkSessionRepository {
  return {
    suppress: vi.fn().mockImplementation(async (opts: { childId: string; date: string; userId: string }) => {
      state.lunchLinkSessions.set(`${opts.childId}:${opts.date}`, {
        suppressed_at: new Date().toISOString(),
        suppressed_by_user_id: opts.userId,
      });
    }),
    unsuppress: vi.fn().mockImplementation(async (opts: { childId: string; date: string }) => {
      const existing = state.lunchLinkSessions.get(`${opts.childId}:${opts.date}`);
      if (existing) {
        existing.suppressed_at = null;
        existing.suppressed_by_user_id = null;
      }
    }),
    findByChildAndDate: vi.fn().mockImplementation(async (_householdId: string, childId: string, date: string) => {
      return state.lunchLinkSessions.get(`${childId}:${date}`) ?? null;
    }),
    findSuppressedForDate: vi.fn().mockResolvedValue([]),
    findSuppressedDatesInRange: vi.fn().mockResolvedValue(new Set<string>()),
    findSuppressedChildrenInRange: vi.fn().mockResolvedValue(new Map<string, string[]>()),
  } as unknown as LunchLinkSessionRepository;
}

function signPrimaryParentToken(app: FastifyInstance, householdId = SAMPLE_HOUSEHOLD_ID): string {
  return app.jwt.sign({ sub: SAMPLE_USER_ID, hh: householdId, role: 'primary_parent' });
}

function signSecondaryCaregiverToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: SAMPLE_USER_ID,
    hh: SAMPLE_HOUSEHOLD_ID,
    role: 'secondary_caregiver',
  });
}

const VALID_BODY = {
  name: 'Asha',
  age_band: 'child' as const,
  declared_allergens: ['peanut', 'shellfish'],
  cultural_identifiers: ['south_asian'],
  dietary_preferences: ['vegetarian'],
};

describe('POST /v1/households/:id/children', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 201 with plaintext arrays in response and PII-free audit context', async () => {
    const insertSpy = vi.fn();
    const state = emptyState({ acked: [SAMPLE_USER_ID], insertSpy });
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    // Story 3-DM-B1: response shape now includes appetite_level/texture_needs/
    // spice_tolerance/bag_composition_pattern; drops allergen_rule_version.
    const body = JSON.parse(res.body) as { child: { name: string; declared_allergens: string[]; cultural_identifiers: string[]; dietary_preferences: string[]; bag_composition_pattern: string } };
    expect(body.child.name).toBe('Asha');
    expect(body.child.declared_allergens).toEqual(['peanut', 'shellfish']);
    expect(body.child.cultural_identifiers).toEqual(['south_asian']);
    expect(body.child.dietary_preferences).toEqual(['vegetarian']);
    expect(body.child.bag_composition_pattern).toBe('main_plus_snack_plus_extra');

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('child.add');
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    const meta = captured.value?.metadata ?? {};
    expect(meta).toMatchObject({
      // Story 3-DM-B1: allergen_rule_version dropped from audit metadata.
      declared_allergen_count: 2,
      cultural_identifier_count: 1,
      dietary_preference_count: 1,
    });
    // PII never lands in audit metadata — neither plaintext values nor the name.
    const metaJson = JSON.stringify(meta);
    expect(metaJson).not.toContain('peanut');
    expect(metaJson).not.toContain('shellfish');
    expect(metaJson).not.toContain('south_asian');
    expect(metaJson).not.toContain('vegetarian');
    expect(metaJson).not.toContain('Asha');
  });

  it('declared_allergens land in household_allergens (3-DM-B2 cutover) with source=onboarding_declared and per-child child_id', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);

    // Two rows in household_allergens, one per allergen, both per-child
    // (child_id non-null) — the REST POST is treated as initial onboarding.
    expect(state.householdAllergens).toHaveLength(2);
    expect(state.householdAllergens.every((a) => a.source === 'onboarding_declared')).toBe(true);
    expect(state.householdAllergens.every((a) => a.child_id !== null)).toBe(true);
    // Each row's `allergen` is NOOP-prefixed ciphertext over the plaintext —
    // the canonical store never holds plaintext at rest.
    expect(state.householdAllergens.every((a) => a.allergen.startsWith('NOOP:'))).toBe(true);
    expect(state.householdAllergens.every((a) => a.allergen_hash.length === 64)).toBe(true);
  });

  it('cultural_identifiers + dietary_preferences route to household tables (canonical §5 — household-scoped)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);

    // cultural_identifiers → household_cultural_identifiers (composite PK).
    expect(state.householdCulturalIdentifiers).toHaveLength(1);
    expect(state.householdCulturalIdentifiers[0]).toMatchObject({
      household_id: SAMPLE_HOUSEHOLD_ID,
      cultural_tag: 'south_asian',
      source: 'onboarding_declared',
    });
    // dietary_preferences → dietary_preferences table with child_id=NULL.
    expect(state.dietaryPreferences).toHaveLength(1);
    expect(state.dietaryPreferences[0]).toMatchObject({
      household_id: SAMPLE_HOUSEHOLD_ID,
      child_id: null,
      tag: 'vegetarian',
      source: 'onboarding_declared',
    });
  });

  it('parental notice not acknowledged → 403 /errors/parental-notice-required, no insert', async () => {
    const insertSpy = vi.fn();
    const state = emptyState({ acked: [], insertSpy });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/parental-notice-required');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('secondary_caregiver JWT → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household primary_parent → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(401);
  });

  it('missing name → 400 validation error', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: { age_band: 'child' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/households/:id/children/:childId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('happy path → 200 with decrypted plaintext arrays', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(created.statusCode).toBe(201);
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { child: { id: string; declared_allergens: string[] } };
    expect(body.child.id).toBe(childId);
    expect(body.child.declared_allergens).toEqual(['peanut', 'shellfish']);
  });

  it('non-existent child → 404 /errors/not-found', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/not-found');
  });

  it('cross-household GET → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${OTHER_HOUSEHOLD_ID}/children/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET response includes bag_composition with the DB default', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // Story 3-DM-B1: response carries bag_composition_pattern enum.
    const body = JSON.parse(res.body) as {
      child: { bag_composition_pattern: string };
    };
    expect(body.child.bag_composition_pattern).toBe('main_plus_snack_plus_extra');
  });
});

describe('PATCH /v1/children/:id/bag-composition', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('happy path → 200 returns updated child and writes child.bag_updated audit context', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: false, extra: true },
    });

    expect(res.statusCode).toBe(200);
    // Story 3-DM-B1: response carries bag_composition_pattern enum.
    const body = JSON.parse(res.body) as {
      child: { id: string; bag_composition_pattern: string };
    };
    expect(body.child.id).toBe(childId);
    expect(body.child.bag_composition_pattern).toBe('main_plus_extra');

    expect(captured.value).toBeDefined();
    expect(captured.value?.event_type).toBe('child.bag_updated');
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    const meta = captured.value?.metadata ?? {};
    expect(meta).toMatchObject({
      child_id: childId,
      // Story 3-DM-B1: audit captures pattern enum values now, not boolean structs.
      old: 'main_plus_snack_plus_extra',
      new: 'main_plus_extra',
    });
  });

  it('body containing main: false → 400 /errors/validation', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { main: false, snack: true, extra: true },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('body containing main: true → 400 /errors/validation (main is never user-settable)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { main: true, snack: true, extra: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('non-boolean snack → 400', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: 'yes', extra: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('cross-household child id → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const childId = await createChild(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { snack: false, extra: false },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/forbidden');
  });

  it('secondary_caregiver token → 403 (only primary_parent can change bag composition)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primaryToken = signPrimaryParentToken(app);
    const childId = await createChild(primaryToken);

    const secondaryToken = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${secondaryToken}` },
      payload: { snack: false, extra: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${randomUUID()}/bag-composition`,
      payload: { snack: true, extra: true },
    });

    expect(res.statusCode).toBe(401);
  });

  it('partial body — missing required field snack → 400', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { extra: true },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('/errors/validation');
  });

  it('subsequent GET reflects the patched bag_composition', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/bag-composition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snack: false, extra: false },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${childId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // Story 3-DM-B1: response carries bag_composition_pattern enum.
    const body = JSON.parse(res.body) as {
      child: { bag_composition_pattern: string };
    };
    expect(body.child.bag_composition_pattern).toBe('main_only');
  });
});

// ---------------------------------------------------------------------------
// Story 3.16 — school-policy routes

describe('PATCH /v1/children/:id/school-policies', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChildAs(token: string): Promise<{
    childId: string;
    state: MockDbState;
  }> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return {
      childId: (JSON.parse(res.body) as { child: { id: string } }).child.id,
      state: undefined as unknown as MockDbState,
    };
  }

  it('happy path activation with no future plans → 200, regeneration_triggered=false, audit fired', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const queueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
    const auditWrite = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({ state, queueAddSpy: queueAdd, auditWriteSpy: auditWrite });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      policy: { policy_type: string; is_active: boolean; slot_scope: string };
      regeneration_triggered: boolean;
      affected_plan_ids: string[];
    };
    expect(body.policy.policy_type).toBe('nut_free');
    expect(body.policy.slot_scope).toBe('bag_wide');
    expect(body.policy.is_active).toBe(true);
    expect(body.regeneration_triggered).toBe(false);
    expect(body.affected_plan_ids).toEqual([]);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'school_policy.updated' }),
    );
  });

  it('activation with cleared future plans enqueues regen jobs and returns affected ids', async () => {
    const PLAN_A = '77777777-7777-4777-8777-777777777777';
    const PLAN_B = '88888888-8888-4888-8888-888888888888';
    const futureWeek = '2099-12-28';
    const state = emptyState({
      acked: [SAMPLE_USER_ID],
      plans: [
        {
          id: PLAN_A,
          household_id: SAMPLE_HOUSEHOLD_ID,
          week_id: '90000000-0000-4000-8000-000000000001',
          week_of: futureWeek,
          revision: 1,
          guardrail_cleared_at: '2099-12-21T11:00:01.000Z',
        },
        {
          id: PLAN_B,
          household_id: SAMPLE_HOUSEHOLD_ID,
          week_id: '90000000-0000-4000-8000-000000000002',
          week_of: futureWeek,
          revision: 3,
          guardrail_cleared_at: '2099-12-21T11:00:01.000Z',
        },
      ],
    });
    const queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
    const auditWrite = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({ state, queueAddSpy: queueAdd, auditWriteSpy: auditWrite });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: true, slot_scope: 'main' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      regeneration_triggered: boolean;
      affected_plan_ids: string[];
      policy: { slot_scope: string };
    };
    expect(body.regeneration_triggered).toBe(true);
    expect(body.affected_plan_ids.sort()).toEqual([PLAN_A, PLAN_B].sort());
    expect(body.policy.slot_scope).toBe('main');

    expect(queueAdd).toHaveBeenCalledTimes(2);
    // Story 3.17 — fanout audit moved to PlanAdjustmentService and renamed
    // 'plan.adjustment_triggered'; trigger_type='school_policy_changed'
    // distinguishes the cause.
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.adjustment_triggered',
        metadata: expect.objectContaining({
          trigger_type: 'school_policy_changed',
        }),
      }),
    );
  });

  it('deactivation does NOT enqueue regen even when future plans exist', async () => {
    const PLAN_A = '77777777-7777-4777-8777-777777777777';
    const futureWeek = '2099-12-28';
    const state = emptyState({
      acked: [SAMPLE_USER_ID],
      plans: [
        {
          id: PLAN_A,
          household_id: SAMPLE_HOUSEHOLD_ID,
          week_id: '90000000-0000-4000-8000-000000000001',
          week_of: futureWeek,
          revision: 1,
          guardrail_cleared_at: '2099-12-21T11:00:01.000Z',
        },
      ],
    });
    const queueAdd = vi.fn().mockResolvedValue({ id: 'job' });
    app = await buildTestApp({ state, queueAddSpy: queueAdd });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: false },
    });

    expect(res.statusCode).toBe(200);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects unknown body keys (.strict()) → 400 /errors/validation', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: true, smuggled: 'evil' },
    });

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });

  it('missing policy_type → 400', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { is_active: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it('secondary_caregiver token → 403 (primary_parent only)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primaryToken = signPrimaryParentToken(app);
    const { childId } = await createChildAs(primaryToken);

    const secondaryToken = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${secondaryToken}` },
      payload: { policy_type: 'nut_free', is_active: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household child id → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const { childId } = await createChildAs(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { policy_type: 'nut_free', is_active: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${randomUUID()}/school-policies`,
      payload: { policy_type: 'nut_free', is_active: true },
    });

    expect(res.statusCode).toBe(401);
  });

  it('subsequent toggle updates the existing row (upsert on child_id+policy_type)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const { childId } = await createChildAs(token);

    const first = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: true },
    });
    expect(first.statusCode).toBe(200);
    const firstId = (JSON.parse(first.body) as { policy: { id: string } }).policy.id;

    const second = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: false },
    });
    expect(second.statusCode).toBe(200);
    const secondPolicy = (JSON.parse(second.body) as {
      policy: { id: string; is_active: boolean };
    }).policy;
    expect(secondPolicy.id).toBe(firstId);
    expect(secondPolicy.is_active).toBe(false);
  });
});

describe('GET /v1/children/:id/school-policies', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns the active policy list for an authorized member', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'nut_free', is_active: true },
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { policy_type: 'no_heating', is_active: false },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { policies: Array<{ policy_type: string }> };
    // Only the active policy is returned by findActiveByChildId.
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]?.policy_type).toBe('nut_free');
  });

  it('secondary_caregiver may also read', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primary = signPrimaryParentToken(app);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${primary}` },
      payload: VALID_BODY,
    });
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const secondary = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${secondary}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('cross-household → 403', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: VALID_BODY,
    });
    const childId = (JSON.parse(created.body) as { child: { id: string } }).child.id;

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/school-policies`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${randomUUID()}/school-policies`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Story 3.21 — extra-rules routes

describe('PATCH /v1/children/:id/extra-rules', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('happy path → 200 with updated rules and PII-free audit context', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const captured: { value: AuditWriteInput | undefined } = { value: undefined };
    app = await buildTestApp({ state, capturedAudit: captured });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pins: ['fruit', 'veggie'], bans: ['sweet treat'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child_id: string;
      extra_rules: { pins: string[]; bans: string[] };
      updated_at: string;
    };
    expect(body.child_id).toBe(childId);
    expect(body.extra_rules.pins).toEqual(['fruit', 'veggie']);
    expect(body.extra_rules.bans).toEqual(['sweet treat']);

    expect(captured.value?.event_type).toBe('child.extra_rules_updated');
    expect(captured.value?.household_id).toBe(SAMPLE_HOUSEHOLD_ID);
    const meta = captured.value?.metadata ?? {};
    // Counts not raw arrays — no component type strings in audit row
    expect(meta).toMatchObject({ child_id: childId, pin_count: 2, ban_count: 1 });
    expect(JSON.stringify(meta)).not.toContain('fruit');
    expect(JSON.stringify(meta)).not.toContain('sweet treat');
  });

  it('secondary_caregiver token → 403 (primary_parent only)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primaryToken = signPrimaryParentToken(app);
    const childId = await createChild(primaryToken);

    const secondaryToken = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${secondaryToken}` },
      payload: { pins: [], bans: [] },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-household child id → 404 (no existence leak across households)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const childId = await createChild(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { pins: [], bans: [] },
    });

    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${randomUUID()}/extra-rules`,
      payload: { pins: [], bans: [] },
    });

    expect(res.statusCode).toBe(401);
  });

  it('pins and bans overlap → 400 (cross-field uniqueness refine)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pins: ['fruit'], bans: ['fruit'] },
    });

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/validation');
  });
});

describe('GET /v1/children/:id/extra-rules', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('returns default empty rules for a fresh child', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child_id: string;
      extra_rules: { pins: string[]; bans: string[] };
    };
    expect(body.child_id).toBe(childId);
    expect(body.extra_rules).toEqual({ pins: [], bans: [] });
  });

  it('reflects rules saved via PATCH', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    await app.inject({
      method: 'PATCH',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${token}` },
      payload: { pins: ['grain'], bans: ['sweet treat'] },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      extra_rules: { pins: string[]; bans: string[] };
    };
    expect(body.extra_rules.pins).toEqual(['grain']);
    expect(body.extra_rules.bans).toEqual(['sweet treat']);
  });

  it('secondary_caregiver may read (requireMember)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primary = signPrimaryParentToken(app);
    const childId = await createChild(primary);

    const secondary = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${secondary}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('cross-household → 404', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const childId = await createChild(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/extra-rules`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('unauthenticated → 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${randomUUID()}/extra-rules`,
    });

    expect(res.statusCode).toBe(401);
  });
});


// ─── Story 3.28 — POST /v1/children/:childId/lunch-link-pause ────────────────

describe('POST /v1/children/:childId/lunch-link-pause', () => {
  let app: FastifyInstance;
  const DATE = '2026-06-09';

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('primary_parent can suppress — 200, suppressed:true', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const auditWriteSpy = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({ state, auditWriteSpy });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/lunch-link-pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: { date: DATE, suppress: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child_id: string;
      date: string;
      suppressed: boolean;
      suppressed_at: string | null;
    };
    expect(body.child_id).toBe(childId);
    expect(body.date).toBe(DATE);
    expect(body.suppressed).toBe(true);
    expect(body.suppressed_at).toBeTruthy();
    expect(auditWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'lunch_link.suppressed' }),
    );
  });

  it('secondary_caregiver can suppress (requireMember)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const primary = signPrimaryParentToken(app);
    const childId = await createChild(primary);

    const secondary = signSecondaryCaregiverToken(app);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/lunch-link-pause`,
      headers: { authorization: `Bearer ${secondary}` },
      payload: { date: DATE, suppress: true },
    });

    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { suppressed: boolean }).suppressed).toBe(true);
  });

  it('suppress:false — 200, suppressed:false, audit unsuppressed', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const auditWriteSpy = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({ state, auditWriteSpy });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/lunch-link-pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: { date: DATE, suppress: false },
    });

    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { suppressed: boolean }).suppressed).toBe(false);
    expect(auditWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'lunch_link.unsuppressed' }),
    );
  });

  it('child from different household — 404', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const tokenA = signPrimaryParentToken(app, SAMPLE_HOUSEHOLD_ID);
    const childId = await createChild(tokenA);

    const tokenB = signPrimaryParentToken(app, OTHER_HOUSEHOLD_ID);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/lunch-link-pause`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { date: DATE, suppress: true },
    });

    expect(res.statusCode).toBe(404);
  });

  it('unauthenticated — 401', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${randomUUID()}/lunch-link-pause`,
      payload: { date: DATE, suppress: true },
    });

    expect(res.statusCode).toBe(401);
  });

  it('missing date field — 400 validation error', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/lunch-link-pause`,
      headers: { authorization: `Bearer ${token}` },
      payload: { suppress: true },
    });

    expect(res.statusCode).toBe(400);
  });
});

// Slice 4-S12 — parent FlavorPassport endpoint.
describe('GET /v1/children/:childId/flavor-passport', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  const PASSPORT_CHILD_ID = '88888888-8888-4888-8888-888888888888';
  const PASSPORT_RECIPE_ID = '99999999-9999-4999-8999-999999999999';

  function passportRow(overrides: Record<string, unknown> = {}) {
    return {
      recipe_id: PASSPORT_RECIPE_ID,
      slot_kind: 'main',
      signal_type: 'loved',
      signal_date: '2026-05-10',
      recipes: { canonical_name: 'Tikka wrap', cuisine_tags: ['indian'], recipe_steps: [] },
      ...overrides,
    };
  }

  it('200 with a valid FlavorPassportResponse shape', async () => {
    const state = emptyState();
    state.childPreferences = [passportRow()];
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${PASSPORT_CHILD_ID}/flavor-passport`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      child_id: string;
      state: string;
      stamps: Array<{ recipe_name: string; method_caption: string | null }>;
    };
    expect(body.child_id).toBe(PASSPORT_CHILD_ID);
    expect(body.state).toBe('developing');
    expect(body.stamps).toHaveLength(1);
    expect(body.stamps[0]?.recipe_name).toBe('Tikka wrap');
  });

  it('200 empty state for a child with no positive signals', async () => {
    const state = emptyState();
    state.childPreferences = [];
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${PASSPORT_CHILD_ID}/flavor-passport`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { state: string; stamps: unknown[] };
    expect(body.state).toBe('empty');
    expect(body.stamps).toEqual([]);
  });

  it('secondary caregiver may read', async () => {
    const state = emptyState();
    state.childPreferences = [passportRow()];
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${PASSPORT_CHILD_ID}/flavor-passport`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('401 without an auth token', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/${PASSPORT_CHILD_ID}/flavor-passport`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('400 when childId is not a UUID', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/children/not-a-uuid/flavor-passport`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Story 7-S7 — annual flavor-journey reset

describe('POST /v1/children/:childId/reset-flavor-journey (7-S7)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createChild(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`,
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { child: { id: string } }).child.id;
  }

  it('200 on success — response shape matches ResetFlavorJourneyResponseSchema', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    const auditWrite = vi.fn().mockResolvedValue(undefined);
    app = await buildTestApp({ state, auditWriteSpy: auditWrite });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset-flavor-journey`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { child_id: string; reset_at: string };
    expect(body.child_id).toBe(childId);
    // reset_at is an ISO-8601 timestamp.
    expect(Number.isNaN(Date.parse(body.reset_at))).toBe(false);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'child.flavor_journey_reset',
        household_id: SAMPLE_HOUSEHOLD_ID,
        metadata: { child_id: childId },
      }),
    );
  });

  it('404 when the child does not belong to the caller household (no oracle)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${randomUUID()}/reset-flavor-journey`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { type: string }).type).toBe('/errors/not-found');
  });

  it('409 when within the 365-day cooldown — detail carries the last reset date', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);
    const childId = await createChild(token);

    // Seed a recent reset directly on the stored row so the cooldown is active.
    const lastReset = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const stored = state.children.find((c) => c.id === childId)!;
    stored.flavor_journey_reset_at = lastReset;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset-flavor-journey`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { type: string; detail: string };
    expect(body.type).toBe('/errors/conflict');
    expect(body.detail).toContain(lastReset);
  });

  it('401 when unauthenticated', async () => {
    const state = emptyState();
    app = await buildTestApp({ state });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${randomUUID()}/reset-flavor-journey`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('403 when caller is a secondary_caregiver (primary parent only)', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signSecondaryCaregiverToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/${randomUUID()}/reset-flavor-journey`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('400 when childId is not a UUID', async () => {
    const state = emptyState({ acked: [SAMPLE_USER_ID] });
    app = await buildTestApp({ state });
    const token = signPrimaryParentToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/children/not-a-uuid/reset-flavor-journey`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
