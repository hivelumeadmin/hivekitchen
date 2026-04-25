import { z } from 'zod';
import {
  LoginRequestSchema,
  LoginResponseSchema,
  OAuthCallbackRequestSchema,
  OAuthProviderSchema,
  AuthUserSchema,
  MealItem,
  DayPlan,
  WeeklyPlan,
  CreatePlanResponse,
  AllergyVerdict,
  PlanUpdatedEvent,
  GroceryItem,
  GroceryList,
  Turn,
  TurnBody,
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  VoiceTokenResponse,
  ElevenLabsWebhookPayload,
  InvalidationEvent,
  ForgetRequest,
  ForgetCompletedEvent,
  SurfaceKind,
  PresenceEvent,
  ErrorCode,
  FieldError,
  ApiError,
} from '@hivekitchen/contracts';

// Auth
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;

// Plans
export type MealItem = z.infer<typeof MealItem>;
export type DayPlan = z.infer<typeof DayPlan>;
export type WeeklyPlan = z.infer<typeof WeeklyPlan>;
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
export type AllergyVerdict = z.infer<typeof AllergyVerdict>;
export type PlanUpdatedEvent = z.infer<typeof PlanUpdatedEvent>;

// Lists
export type GroceryItem = z.infer<typeof GroceryItem>;
export type GroceryList = z.infer<typeof GroceryList>;

// Threads
export type Turn = z.infer<typeof Turn>;
export type TurnBody = z.infer<typeof TurnBody>;
export type TurnBodyMessage = z.infer<typeof TurnBodyMessage>;
export type TurnBodyPlanDiff = z.infer<typeof TurnBodyPlanDiff>;
export type TurnBodyProposal = z.infer<typeof TurnBodyProposal>;
export type TurnBodySystemEvent = z.infer<typeof TurnBodySystemEvent>;
export type TurnBodyPresence = z.infer<typeof TurnBodyPresence>;

// Voice
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;
export type ElevenLabsWebhookPayload = z.infer<typeof ElevenLabsWebhookPayload>;

// Events
export type InvalidationEvent = z.infer<typeof InvalidationEvent>;

// Memory
export type ForgetRequest = z.infer<typeof ForgetRequest>;
export type ForgetCompletedEvent = z.infer<typeof ForgetCompletedEvent>;

// Presence
export type SurfaceKind = z.infer<typeof SurfaceKind>;
export type PresenceEvent = z.infer<typeof PresenceEvent>;

// Errors
export type ErrorCode = z.infer<typeof ErrorCode>;
export type FieldError = z.infer<typeof FieldError>;
export type ApiError = z.infer<typeof ApiError>;
