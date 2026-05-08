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
  MemoryRecallInputSchema,
  MemoryRecallNodeSchema,
  MemoryRecallOutputSchema,
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
  SlotScopeSchema,
  SchoolPolicySchema,
  UpdateSchoolPolicyInputSchema,
  UpdateSchoolPolicyResponseSchema,
  GetSchoolPoliciesResponseSchema,
  SchoolPolicyChildIdParamSchema,
  DayOverrideTypeSchema,
  DayOverrideSchema,
  SetDayOverrideInputSchema,
  SetDayOverrideResponseSchema,
  DayOverridePlanItemParamSchema,
  DayOverrideRevertParamSchema,
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
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
  RecipePreviewSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeIngredientSchema,
  RecipeDetailSchema,
  PantryReadInputSchema,
  PantryReadOutputSchema,
  PantryItemSchema,
  PlanComposeInputSchema,
  PlanComposeOutputSchema,
  CulturalLookupInputSchema,
  CulturalLookupOutputSchema,
  PlanItemWriteSchema,
  CommitPlanInputSchema,
  PlanRowSchema,
  PlanItemRowSchema,
  SnackSkuSchema,
  PlanTileSummarySchema,
  ClearedAllergyEntrySchema,
  ScaffoldingDiffSchema,
  BriefStateRowSchema,
  BriefResponseSchema,
  SwapPlanItemInputSchema,
  SwapPlanItemResponseSchema,
  PausePlanDayInputSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
  GetPlansQuerySchema,
  GetPlansResponseSchema,
  PlanItemSwapSummarySchema,
  PlanWeekIdParamSchema,
  PlanHistoryResponseSchema,
  ExtraRulesSchema,
  UpdateExtraRulesInputSchema,
  UpdateExtraRulesResponseSchema,
  ExtraRulesChildIdParamSchema,
  GetExtraRulesResponseSchema,
  CreateExtraLibraryItemInputSchema,
  ExtraLibraryItemSchema,
  ListExtraLibraryResponseSchema,
  ExtraLibraryHouseholdIdParamSchema,
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

// Memory (Story 3.4 — memory.recall read tool)
export type MemoryRecallInput = z.infer<typeof MemoryRecallInputSchema>;
export type MemoryRecallNode = z.infer<typeof MemoryRecallNodeSchema>;
export type MemoryRecallOutput = z.infer<typeof MemoryRecallOutputSchema>;

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

// School policies (Story 3.16 — per-slot policy update + plan propagation)
export type SlotScope = z.infer<typeof SlotScopeSchema>;
export type SchoolPolicy = z.infer<typeof SchoolPolicySchema>;
export type UpdateSchoolPolicyInput = z.infer<typeof UpdateSchoolPolicyInputSchema>;
export type UpdateSchoolPolicyResponse = z.infer<typeof UpdateSchoolPolicyResponseSchema>;
export type GetSchoolPoliciesResponse = z.infer<typeof GetSchoolPoliciesResponseSchema>;
export type SchoolPolicyChildIdParam = z.infer<typeof SchoolPolicyChildIdParamSchema>;

// Day-level context overrides (Story 3.19 — FR118, FR119)
export type DayOverrideType = z.infer<typeof DayOverrideTypeSchema>;
export type DayOverride = z.infer<typeof DayOverrideSchema>;
export type SetDayOverrideInput = z.infer<typeof SetDayOverrideInputSchema>;
export type SetDayOverrideResponse = z.infer<typeof SetDayOverrideResponseSchema>;
export type DayOverridePlanItemParam = z.infer<typeof DayOverridePlanItemParamSchema>;
export type DayOverrideRevertParam = z.infer<typeof DayOverrideRevertParamSchema>;

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

// Agent tools (Story 3.4 — recipe / pantry / plan / cultural lookup)
export type RecipeSearchInput = z.infer<typeof RecipeSearchInputSchema>;
export type RecipeSearchOutput = z.infer<typeof RecipeSearchOutputSchema>;
export type RecipePreview = z.infer<typeof RecipePreviewSchema>;
export type RecipeFetchInput = z.infer<typeof RecipeFetchInputSchema>;
export type RecipeFetchOutput = z.infer<typeof RecipeFetchOutputSchema>;
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;
export type RecipeDetail = z.infer<typeof RecipeDetailSchema>;

export type PantryReadInput = z.infer<typeof PantryReadInputSchema>;
export type PantryReadOutput = z.infer<typeof PantryReadOutputSchema>;
export type PantryItem = z.infer<typeof PantryItemSchema>;

export type PlanComposeInput = z.infer<typeof PlanComposeInputSchema>;
export type PlanComposeOutput = z.infer<typeof PlanComposeOutputSchema>;
export type { PlanComposeItem, PlanComposeDay } from '@hivekitchen/contracts';

export type CulturalLookupInput = z.infer<typeof CulturalLookupInputSchema>;
export type CulturalLookupOutput = z.infer<typeof CulturalLookupOutputSchema>;

// Plan repository write / read shapes (Story 3.5)
export type PlanItemWrite = z.infer<typeof PlanItemWriteSchema>;
export type CommitPlanInput = z.infer<typeof CommitPlanInputSchema>;
export type PlanRow = z.infer<typeof PlanRowSchema>;

// brief_state projection (Story 3.6)
export type PlanItemRow = z.infer<typeof PlanItemRowSchema>;

// Snack SKU catalog (Story 3.20)
export type SnackSku = z.infer<typeof SnackSkuSchema>;
export type PlanTileSummary = z.infer<typeof PlanTileSummarySchema>;
export type BriefStateRow = z.infer<typeof BriefStateRowSchema>;
export type BriefResponse = z.infer<typeof BriefResponseSchema>;

// Cleared allergies (Story 3.10 — composer-emitted entry per child/allergen)
export type ClearedAllergyEntry = z.infer<typeof ClearedAllergyEntrySchema>;

// Scaffolding diff (Story 3.11 — QuietDiff rear-view)
export type ScaffoldingDiff = z.infer<typeof ScaffoldingDiffSchema>;

// Story 3.12 — plan swap + pause mutation types
export type SwapPlanItemInput = z.infer<typeof SwapPlanItemInputSchema>;
export type SwapPlanItemResponse = z.infer<typeof SwapPlanItemResponseSchema>;
export type PausePlanDayInput = z.infer<typeof PausePlanDayInputSchema>;

// Story 3.13 — plan regeneration types
export type RegeneratePlanQuery = z.infer<typeof RegeneratePlanQuerySchema>;
export type RegeneratePlanResponse = z.infer<typeof RegeneratePlanResponseSchema>;

// Story 3.14 — following-week draft view types
export type GetPlansQuery = z.infer<typeof GetPlansQuerySchema>;
export type GetPlansResponse = z.infer<typeof GetPlansResponseSchema>;

// Story 3.15 — historical plans + outcomes view types
export type PlanItemSwapSummary = z.infer<typeof PlanItemSwapSummarySchema>;
export type PlanWeekIdParam = z.infer<typeof PlanWeekIdParamSchema>;
export type PlanHistoryResponse = z.infer<typeof PlanHistoryResponseSchema>;

// Story 3.21 — Extra slot pin/ban rules + household Extra library
export type ExtraRules = z.infer<typeof ExtraRulesSchema>;
export type UpdateExtraRulesInput = z.infer<typeof UpdateExtraRulesInputSchema>;
export type UpdateExtraRulesResponse = z.infer<typeof UpdateExtraRulesResponseSchema>;
export type ExtraRulesChildIdParam = z.infer<typeof ExtraRulesChildIdParamSchema>;
export type GetExtraRulesResponse = z.infer<typeof GetExtraRulesResponseSchema>;
export type CreateExtraLibraryItemInput = z.infer<typeof CreateExtraLibraryItemInputSchema>;
export type ExtraLibraryItem = z.infer<typeof ExtraLibraryItemSchema>;
export type ListExtraLibraryResponse = z.infer<typeof ListExtraLibraryResponseSchema>;
export type ExtraLibraryHouseholdIdParam = z.infer<typeof ExtraLibraryHouseholdIdParamSchema>;
