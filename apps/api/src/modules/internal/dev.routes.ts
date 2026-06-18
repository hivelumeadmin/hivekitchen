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
};
