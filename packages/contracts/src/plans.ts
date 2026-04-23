import { z } from "zod";

export const MealItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const DayPlan = z.object({
  day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday"]),
  meal: MealItem,
});

export const WeeklyPlan = z.object({
  id: z.string().uuid(),
  weekOf: z.string(),
  status: z.enum(["draft", "confirmed"]),
  days: z.array(DayPlan),
});

export const CreatePlanResponse = z.object({
  plan: WeeklyPlan,
});
