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
  ConflictSchema,
  GuardrailResultSchema,
  PlanItemForGuardrailSchema,
  AllergyCheckInputSchema,
  AllergyCheckOutputSchema,
  GroceryItem,
  GroceryList,
  Turn,
  TurnBody,
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  VoiceSessionCreateSchema,
  VoiceSessionCreateResponseSchema,
  WsClientMessageSchema,
  WsServerMessageSchema,
  WsSessionReadySchema,
  WsTranscriptSchema,
  WsResponseStartSchema,
  WsResponseEndSchema,
  WsSessionSummarySchema,
  WsErrorSchema,
  WsErrorCodeSchema,
  InvalidationEvent,
  ForgetRequest,
  ForgetCompletedEvent,
  NodeTypeSchema,
  SourceTypeSchema,
  MemoryNodeSchema,
  MemoryProvenanceSchema,
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
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
  AgeBandSchema,
  AddChildBodySchema,
  ChildResponseSchema,
  AddChildResponseSchema,
  GetChildResponseSchema,
  BagCompositionSchema,
  SetBagCompositionBodySchema,
  SetBagCompositionResponseSchema,
  CulturalKeySchema,
  TierSchema,
  TemplateStateSchema,
  CulturalPriorSchema,
  RatifyActionSchema,
  RatifyCulturalPriorBodySchema,
  CulturalPriorListResponseSchema,
  RatifyCulturalPriorResponseSchema,
  TemplateStateChangedEventSchema,
  TurnBodyRatificationPrompt,
  LumiSurfaceSchema,
  LumiContextSignalSchema,
  LumiTurnRequestSchema,
  LumiThreadTurnsResponseSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
  LumiNudgeEventSchema,
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

// Allergy guardrail (Story 3.1)
export type Conflict = z.infer<typeof ConflictSchema>;
export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;
export type PlanItemForGuardrail = z.infer<typeof PlanItemForGuardrailSchema>;
export type AllergyCheckInput = z.infer<typeof AllergyCheckInputSchema>;
export type AllergyCheckOutput = z.infer<typeof AllergyCheckOutputSchema>;

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

// Voice (Story 2.6b — HK-owned WebSocket pipeline)
export type VoiceSessionCreate = z.infer<typeof VoiceSessionCreateSchema>;
export type VoiceSessionCreateResponse = z.infer<typeof VoiceSessionCreateResponseSchema>;
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type WsSessionReady = z.infer<typeof WsSessionReadySchema>;
export type WsTranscript = z.infer<typeof WsTranscriptSchema>;
export type WsResponseStart = z.infer<typeof WsResponseStartSchema>;
export type WsResponseEnd = z.infer<typeof WsResponseEndSchema>;
export type WsSessionSummary = z.infer<typeof WsSessionSummarySchema>;
export type WsError = z.infer<typeof WsErrorSchema>;
export type WsErrorCode = z.infer<typeof WsErrorCodeSchema>;

// Events
export type InvalidationEvent = z.infer<typeof InvalidationEvent>;

// Memory
export type ForgetRequest = z.infer<typeof ForgetRequest>;
export type ForgetCompletedEvent = z.infer<typeof ForgetCompletedEvent>;

// Memory (Story 2.13 — visible memory write primitives)
export type NodeType = z.infer<typeof NodeTypeSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type MemoryNode = z.infer<typeof MemoryNodeSchema>;
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;
export type MemoryNoteInput = z.infer<typeof MemoryNoteInputSchema>;
export type MemoryNoteOutput = z.infer<typeof MemoryNoteOutputSchema>;

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

// Children (Story 2.10 — envelope-encrypted child profiles)
export type AgeBand = z.infer<typeof AgeBandSchema>;
export type AddChildBody = z.infer<typeof AddChildBodySchema>;
export type ChildResponse = z.infer<typeof ChildResponseSchema>;
export type AddChildResponse = z.infer<typeof AddChildResponseSchema>;
export type GetChildResponse = z.infer<typeof GetChildResponseSchema>;

// Children (Story 2.12 — per-child Lunch Bag slot declaration)
export type BagComposition = z.infer<typeof BagCompositionSchema>;
export type SetBagCompositionBody = z.infer<typeof SetBagCompositionBodySchema>;
export type SetBagCompositionResponse = z.infer<typeof SetBagCompositionResponseSchema>;

// Cultural priors (Story 2.11)
export type CulturalKey = z.infer<typeof CulturalKeySchema>;
export type Tier = z.infer<typeof TierSchema>;
export type TemplateState = z.infer<typeof TemplateStateSchema>;
export type CulturalPrior = z.infer<typeof CulturalPriorSchema>;
export type RatifyAction = z.infer<typeof RatifyActionSchema>;
export type RatifyCulturalPriorBody = z.infer<typeof RatifyCulturalPriorBodySchema>;
export type CulturalPriorListResponse = z.infer<typeof CulturalPriorListResponseSchema>;
export type RatifyCulturalPriorResponse = z.infer<typeof RatifyCulturalPriorResponseSchema>;
export type TemplateStateChangedEvent = z.infer<typeof TemplateStateChangedEventSchema>;
export type TurnBodyRatificationPrompt = z.infer<typeof TurnBodyRatificationPrompt>;

// Ambient Lumi (Story 12.1 — ADR-002 contract surface)
export type LumiSurface = z.infer<typeof LumiSurfaceSchema>;
export type LumiContextSignal = z.infer<typeof LumiContextSignalSchema>;
export type LumiTurnRequest = z.infer<typeof LumiTurnRequestSchema>;
export type LumiThreadTurnsResponse = z.infer<typeof LumiThreadTurnsResponseSchema>;
export type VoiceTalkSessionCreate = z.infer<typeof VoiceTalkSessionCreateSchema>;
export type VoiceTalkSessionResponse = z.infer<typeof VoiceTalkSessionResponseSchema>;
export type LumiNudgeEvent = z.infer<typeof LumiNudgeEventSchema>;
