import { z } from 'zod';
import {
  LoginRequestSchema,
  LoginResponseSchema,
  OAuthCallbackRequestSchema,
  OAuthProviderSchema,
  AuthUserSchema,
  RefreshResponseSchema,
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  RedeemInviteRequestSchema,
  RedeemInviteResponseSchema,
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
  VoiceTokenRequestSchema,
  VoiceTokenResponse,
  ElevenLabsLlmRequestSchema,
  ElevenLabsPostCallWebhookPayload,
  InvalidationEvent,
  ForgetRequest,
  ForgetCompletedEvent,
  SurfaceKind,
  PresenceEvent,
  ErrorCode,
  FieldError,
  ApiError,
  UserProfileSchema,
  UpdateProfileRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetCompleteRequestSchema,
  NotificationPrefsSchema,
  UpdateNotificationPrefsRequestSchema,
  CulturalLanguageSchema,
  UpdateCulturalPreferenceRequestSchema,
  CULTURAL_LANGUAGE_VALUES,
  TextOnboardingTurnRequestSchema,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
  ConsentDeclarationResponseSchema,
  VpcConsentRequestSchema,
  VpcConsentResponseSchema,
  ParentalNoticeResponseSchema,
  AcknowledgeParentalNoticeRequestSchema,
  AcknowledgeParentalNoticeResponseSchema,
  ProcessorEntrySchema,
  RetentionEntrySchema,
  KNOWN_PARENTAL_NOTICE_VERSIONS,
  PARENTAL_NOTICE_PROCESSOR_NAMES,
} from '@hivekitchen/contracts';

// Auth
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// Invites (Story 2.3)
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>;
export type RedeemInviteRequest = z.infer<typeof RedeemInviteRequestSchema>;
export type RedeemInviteResponse = z.infer<typeof RedeemInviteResponseSchema>;

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
export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;
export type ElevenLabsLlmRequest = z.infer<typeof ElevenLabsLlmRequestSchema>;
export type ElevenLabsPostCallWebhook = z.infer<typeof ElevenLabsPostCallWebhookPayload>;

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

// Users (Story 2.4 — profile management)
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

// Password reset completion (Story 2.4b)
export type PasswordResetCompleteRequest = z.infer<typeof PasswordResetCompleteRequestSchema>;

// Users (Story 2.5 — notification preferences + cultural language)
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
export type UpdateNotificationPrefsRequest = z.infer<typeof UpdateNotificationPrefsRequestSchema>;
export type CulturalLanguagePreference = z.infer<typeof CulturalLanguageSchema>;
export type UpdateCulturalPreferenceRequest = z.infer<typeof UpdateCulturalPreferenceRequestSchema>;
export { CULTURAL_LANGUAGE_VALUES };

// Onboarding (Story 2.7 — text-equivalent path)
export type TextOnboardingTurnRequest = z.infer<typeof TextOnboardingTurnRequestSchema>;
export type TextOnboardingTurnResponse = z.infer<typeof TextOnboardingTurnResponseSchema>;
export type TextOnboardingFinalizeResponse = z.infer<typeof TextOnboardingFinalizeResponseSchema>;

// Compliance (Story 2.8 — COPPA soft-VPC signed declaration)
export type ConsentDeclarationResponse = z.infer<typeof ConsentDeclarationResponseSchema>;
export type VpcConsentRequest = z.infer<typeof VpcConsentRequestSchema>;
export type VpcConsentResponse = z.infer<typeof VpcConsentResponseSchema>;

// Compliance (Story 2.9 — AADC parental notice)
export type ParentalNoticeResponse = z.infer<typeof ParentalNoticeResponseSchema>;
export type AcknowledgeParentalNoticeRequest = z.infer<
  typeof AcknowledgeParentalNoticeRequestSchema
>;
export type AcknowledgeParentalNoticeResponse = z.infer<
  typeof AcknowledgeParentalNoticeResponseSchema
>;
export type ProcessorEntry = z.infer<typeof ProcessorEntrySchema>;
export type RetentionEntry = z.infer<typeof RetentionEntrySchema>;
export { KNOWN_PARENTAL_NOTICE_VERSIONS, PARENTAL_NOTICE_PROCESSOR_NAMES };
