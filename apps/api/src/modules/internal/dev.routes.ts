import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../middleware/authorize.hook.js';
import { getCurrentWeekMonday } from '../../lib/derive-week-id.js';
import { GENERATE_QUEUE, GENERATION_JOB_OPTS_BASE } from '../../jobs/plan-generation.job.js';
import type { PlanGenerationJobData } from '../../jobs/plan-generation.job.js';

export const devRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/v1/dev/trigger-plan-generation',
    { preHandler: authorize(['primary_parent']) },
    async (request, reply) => {
      const { household_id } = request.user;
      const week_of = getCurrentWeekMonday();
      const request_id = randomUUID();

      const jobData: PlanGenerationJobData = { household_id, week_of, request_id };
      const queue = fastify.bullmq.getQueue(GENERATE_QUEUE);
      const job = await queue.add('generate-plan', jobData, {
        ...GENERATION_JOB_OPTS_BASE,
        jobId: `plan-gen-dev-${household_id}-${week_of}`,
      });

      return reply.send({ job_id: job.id, week_of });
    },
  );

  // DELETE /v1/dev/reset-all — full dev reset mirroring scripts/dev-db-reset.ts.
  // Clears all household/session data for EVERY household in the DB, flushes
  // Redis, then deletes the calling user's public.users row so the next login
  // recreates it and routes through onboarding from scratch. auth.users is
  // untouched (Supabase credentials remain valid).
  fastify.delete(
    '/v1/dev/reset-all',
    { preHandler: authorize(['primary_parent']) },
    async (request, reply) => {
      const db = fastify.supabase;

      async function clear(table: string, idCol = 'id'): Promise<void> {
        const { error } = await db.from(table).delete().not(idCol, 'is', null);
        if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
          throw error;
        }
      }

      // Leaf-first deletion order mirrors dev-db-reset.ts
      await clear('variant_proposals');
      await clear('extra_removal_signals');
      await clear('plan_day_context');
      await clear('guardrail_decisions');
      await clear('plan_items');
      await clear('plans');
      await clear('household_recipe_usage', 'household_id');
      await clear('recipe_comments');
      await clear('recipes');
      await clear('brief_state', 'household_id');
      await clear('memory_provenance');
      await clear('memory_nodes');
      await clear('heart_notes');
      await clear('child_allergens');
      await clear('food_preferences');
      await clear('dietary_preferences');
      await clear('household_rules');
      await clear('favorite_lunches');
      await clear('cultural_priors');
      await clear('school_policies');
      await clear('onboarding_moment_state', 'household_id');
      await clear('extra_library');
      await clear('lunch_link_sessions');
      await clear('allergy_rules');
      await clear('vpc_consents');
      await clear('audit_log');
      await clear('thread_turns');
      await clear('voice_sessions');
      await clear('threads');
      await clear('invites');
      await clear('children');

      // Null FK before deleting households
      await db.from('users').update({ current_household_id: null }).not('id', 'is', null);
      await clear('households');
      await clear('users');

      // Flush Redis: kitchen-map cache + BullMQ queues
      await fastify.redis.flushdb();

      return reply.status(204).send();
    },
  );

  // DELETE /v1/dev/reset-plans — wipes all plan data for the calling household.
  // Cascade chain: plans → plan_main_assignments → plan_slots → plan_slot_variations,
  // plan_day_context, variant_proposals; and plan_days → plan_slots (same chain).
  // guardrail_decisions and brief_state are not plan-FKed so cleared explicitly.
  fastify.delete(
    '/v1/dev/reset-plans',
    { preHandler: authorize(['primary_parent']) },
    async (request, reply) => {
      const { household_id } = request.user;
      const db = fastify.supabase;

      const [gd, pl, bs] = await Promise.all([
        db.from('guardrail_decisions').delete().eq('household_id', household_id),
        db.from('plans').delete().eq('household_id', household_id),
        db.from('brief_state').delete().eq('household_id', household_id),
      ]);

      if (gd.error) throw gd.error;
      if (pl.error) throw pl.error;
      if (bs.error) throw bs.error;

      return reply.status(204).send();
    },
  );
};
