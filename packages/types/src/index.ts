import { z } from "zod";
import {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  MealItem,
  DayPlan,
  WeeklyPlan,
  CreatePlanResponse,
  GroceryItem,
  GroceryList,
  ThreadTurn,
  Thread,
  VoiceTokenResponse,
  ElevenLabsWebhookPayload,
  SSEEvent,
} from "@hivekitchen/contracts";

// Auth
export type LoginRequest = z.infer<typeof LoginRequest>;
export type LoginResponse = z.infer<typeof LoginResponse>;
export type RefreshRequest = z.infer<typeof RefreshRequest>;
export type RefreshResponse = z.infer<typeof RefreshResponse>;

// Plans
export type MealItem = z.infer<typeof MealItem>;
export type DayPlan = z.infer<typeof DayPlan>;
export type WeeklyPlan = z.infer<typeof WeeklyPlan>;
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;

// Lists
export type GroceryItem = z.infer<typeof GroceryItem>;
export type GroceryList = z.infer<typeof GroceryList>;

// Threads
export type ThreadTurn = z.infer<typeof ThreadTurn>;
export type Thread = z.infer<typeof Thread>;

// Voice
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;
export type ElevenLabsWebhookPayload = z.infer<typeof ElevenLabsWebhookPayload>;

// Events
export type SSEEvent = z.infer<typeof SSEEvent>;
