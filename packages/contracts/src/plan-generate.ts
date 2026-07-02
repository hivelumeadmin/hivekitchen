import { z } from 'zod';
import { WeekdaySchema } from './plan.js';

// Story 3-S34 — on-demand ("compose now") plan composition. 202 Accepted body.
// The window is server-derived from "now" + the household timezone, so the
// request has no body. job_id correlates the enqueued BullMQ job; week_of is
// the Monday anchor of the composed week; planned_days is the exact weekday set
// the planner was asked to fill; basis explains which window rule fired.
export const GeneratePlanResponseSchema = z.object({
  job_id: z.string().min(1),
  week_of: z.string().date(),
  planned_days: z.array(WeekdaySchema),
  basis: z.enum(['current_week_remaining', 'next_week_full']),
});
