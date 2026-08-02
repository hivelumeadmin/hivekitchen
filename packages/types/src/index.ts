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
  AcceptInviteRequestSchema,
  AcceptInviteResponseSchema,
  HouseholdMemberSchema,
  HouseholdMembersResponseSchema,
  AllergyVerdict,
  PlanUpdatedEvent,
  PlanProgressEvent,
  ConflictSchema,
  FlaggedCompoundItemSchema,
  GuardrailResultSchema,
  PlanItemForGuardrailSchema,
  AllergyCheckInputSchema,
  AllergyCheckOutputSchema,
  Turn,
  TurnBody,
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  VoiceSessionCreateSchema,
  VoiceSessionCreateResponseSchema,
  TtsTokenResponseSchema,
  InvalidationEvent,
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
  EditMemoryRequestSchema,
  ForgetMemoryRequestSchema,
  ParentalDashboardResponseSchema,
  MemorySourceCountsSchema,
  ConsentHistoryEventSchema,
  ConsentHistoryResponseSchema,
  DataExportResponseSchema,
  DeleteHouseholdResponseSchema,
  SurfaceKind,
  PresenceEvent,
  PresenceHeartbeatRequestSchema,
  PresencePartnerSchema,
  PresenceResponseSchema,
  ErrorCode,
  FieldError,
  ApiError,
  UserProfileSchema,
  UpdateProfileRequestSchema,
  UpdateAccessibilityRequestSchema,
  VoiceRetentionModeSchema,
  UpdateVoiceRetentionRequestSchema,
  VoiceTranscriptItemSchema,
  VoiceTranscriptsResponseSchema,
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
  AppetiteLevelSchema,
  TextureNeedsSchema,
  SpiceToleranceSchema,
  BagCompositionSchema,
  SetBagCompositionBodySchema,
  SetBagCompositionResponseSchema,
  ResetFlavorJourneyResponseSchema,
  SlotScopeSchema,
  SchoolPolicySchema,
  UpdateSchoolPolicyInputSchema,
  UpdateSchoolPolicyResponseSchema,
  GetSchoolPoliciesResponseSchema,
  SchoolPolicyChildIdParamSchema,
  PlanDayContextTypeSchema,
  PlanDayContextSchema,
  SetPlanDayContextInputSchema,
  SetPlanDayContextResponseSchema,
  CulturalKeySchema,
  TierSchema,
  TemplateStateSchema,
  CulturalPriorSchema,
  RatifyActionSchema,
  RatifyCulturalPriorBodySchema,
  CulturalPriorListResponseSchema,
  RatifyCulturalPriorResponseSchema,
  TurnBodyRatificationPrompt,
  TurnBodyFamilyLanguagePrompt,
  FamilyLanguageStateSchema,
  FamilyLanguageTermSchema,
  FamilyLanguageRatifyActionSchema,
  FamilyLanguageRatifyBodySchema,
  FamilyLanguageRatifyResponseSchema,
  FamilyLanguageTermsResponseSchema,
  LumiSurfaceSchema,
  LumiContextSignalSchema,
  LumiTurnRequestSchema,
  LumiTurnResponseSchema,
  LumiThreadTurnsResponseSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
  LumiNudgeEventSchema,
  NudgeTriggerSchema,
  RecipeSearchInputSchema,
  RecipeSearchOutputSchema,
  RecipePreviewSchema,
  RecipeFetchInputSchema,
  RecipeFetchOutputSchema,
  RecipeIngredientSchema,
  RecipeAgentExtractionSchema,
  RecipeDiscoverInputSchema,
  RecipeDiscoverOutputSchema,
  RecipeDiscoverConstraintsSchema,
  ChildSignalInputSchema,
  ChildSignalRecipeItemSchema,
  ChildSignalPerChildSchema,
  ChildSignalFamilyPatternSchema,
  ChildSignalOutputSchema,
  RecipeRowSchema,
  RecipeUnitSchema,
  RecipeSourceSchema,
  RecipeVisibilitySchema,
  RecipeSlotSchema,
  AllergenRuleClassSchema,
  AllergenSeveritySchema,
  AllergenTagRowSchema,
  DietaryCategorySchema,
  DietaryTagRowSchema,
  CulturalTagRowSchema,
  CuisineRegionSchema,
  CuisineTagRowSchema,
  VocabularySnapshotSchema,
  KitchenMapSchema,
  KitchenMapHouseholdSchema,
  KitchenMapCaregiverSchema,
  KitchenMapCaregiverRoleSchema,
  KitchenMapChildSchema,
  KitchenMapCulturalSchema,
  KitchenMapCulturalPriorSchema,
  KitchenMapCulturalPriorStateSchema,
  KitchenMapMemorySchema,
  KitchenMapMemoryNodeSchema,
  KitchenMapMemoryNodeTypeSchema,
  KitchenMapHouseholdExtrasSchema,
  KitchenMapExtraLibraryItemSchema,
  KitchenMapRecipesSchema,
  KitchenMapFavouriteRecipeSchema,
  KitchenMapMetaSchema,
  // Slice 2.6-s1 — catalog provenance enum
  CatalogProvenanceSchema,
  ChildUpsertInputSchema,
  ChildUpsertOutputSchema,
  CulturalNoteInputSchema,
  CulturalNoteOutputSchema,
  MemoryNoteFromOnboardingInputSchema,
  MemoryNoteFromOnboardingOutputSchema,
  MemoryNoteFromOnboardingNodeTypeSchema,
  PantryReadInputSchema,
  PantryReadOutputSchema,
  PantryItemSchema,
  CulturalLookupInputSchema,
  CulturalLookupOutputSchema,
  PlanRowSchema,
  PlanTileSummarySchema,
  ClearedAllergyEntrySchema,
  ScaffoldingDiffSchema,
  BriefStatePayloadSchema,
  BriefStateRowSchema,
  BriefResponseSchema,
  // Slice 5-S8 — "I noticed" learning moment
  LearningMomentCalloutSchema,
  LearningMomentActionSchema,
  RespondToLearningMomentRequestSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
  GeneratePlanResponseSchema,
  GetPlansQuerySchema,
  GetPlansResponseSchema,
  HardFailStatusSchema,
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
  HouseholdUpsertInputSchema,
  HouseholdUpsertOutputSchema,
  HouseholdProfilePatchBodySchema,
  HouseholdProfileResponseSchema,
  HouseholdIdParamSchema,
  // Story 3.29 — sovereignty mode toggle
  UpdateSovereigntyModeInputSchema,
  UpdateSovereigntyModeResponseSchema,
  // Slice 2.5-s1 — enforcement gradient + KitchenMap extensions + 7 new tools
  ENFORCEMENT_LEVEL_VALUES,
  EnforcementLevelSchema,
  BagCompositionPatternSchema,
  KitchenMapAllergenSchema,
  KitchenMapDietarySchema,
  KitchenMapFoodPreferenceSchema,
  KitchenMapFavoriteLunchSchema,
  KitchenMapRuleSchema,
  HouseholdSetNameInputSchema,
  HouseholdSetNameOutputSchema,
  AllergenDeclareInputSchema,
  AllergenDeclareOutputSchema,
  DietaryDeclareInputSchema,
  DietaryDeclareOutputSchema,
  CuisineDeclareInputSchema,
  CuisineDeclareOutputSchema,
  FoodPreferenceDeclareInputSchema,
  FoodPreferenceDeclareOutputSchema,
  FavoriteLunchAddInputSchema,
  FavoriteLunchAddOutputSchema,
  RuleSetInputSchema,
  RuleSetOutputSchema,
  // Story 3.28 — Lunch Link suppression
  LunchLinkPauseInputSchema,
  LunchLinkPauseResponseSchema,
  // Slice 4-S12 — FlavorPassport
  FlavorPassportStampSchema,
  FlavorPassportStateSchema,
  FlavorPassportResponseSchema,
  // Slice 4-S15 — Child Request-a-Lunch + Parent Approval
  ChildRequestCreateSchema,
  ChildRequestSchema,
  PendingChildRequestsResponseSchema,
  // Story 3.27 — variant proposal active-learning
  PlanVariantProposalOutputSchema,
  VariantProposalSchema,
  ConfirmVariantProposalInputSchema,
  // Story 3-DM-C1 — plan structure canonical (tree shape).
  WeekdaySchema,
  SlotKindSchema,
  ExtraKindSchema,
  PortionSizeSchema,
  TextureLevelSchema,
  SpiceLevelSchema,
  PauseReasonSchema,
  PlanMainAssignmentRowSchema,
  PlanDayRowSchema,
  PlanSlotRowSchema,
  PlanSlotVariationRowSchema,
  PlannerVariationInputSchema,
  PlannerSlotInputSchema,
  PlannerDayInputSchema,
  PlannerMainAssignmentInputSchema,
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
  CommitPlanTreeInputSchema,
  // Story 3-DM-C1 Phase 9b part 4 — wire-shape migration response + mutation schemas
  PlanSwapSummaryTreeSchema,
  SwapMainInputSchema,
  SwapMainResponseSchema,
  UpdateVariationInputSchema,
  UpdateVariationResponseSchema,
  SwapSlotRecipeInputSchema,
  SwapSlotRecipeResponseSchema,
  SwapSlotSnackSkuInputSchema,
  // Epic 13-s9 — conversational plan-edit wire shapes
  PlanIntentResultSchema,
  PlanEditParamSchema,
  PlanEditInputSchema,
  PlanEditResultSchema,
  PlanEditResponseSchema,
  PlanEditFixedSlotSchema,
  DispatchTierSchema,
  PausePlanDayTreeInputSchema,
  PauseChildOnDayInputSchema,
  MainAssignmentParamSchema,
  VariationParamSchema,
  PlanSlotParamSchema,
  PlanDayContextSlotParamSchema,
  PlanDayContextSlotRevertParamSchema,
  ProposeSwapInputSchema,
  ProposeSwapResponseSchema,
  StateComplianceOverridesResponseSchema,
  // Slice 5-S3 — PackerOfTheDay
  DayAssignmentSchema,
  DayAssignmentsResponseSchema,
  AssignPackerRequestSchema,
  AssignPackerResponseSchema,
  // Story 15-s1 — Family Calendar (terms + exceptions)
  CalendarSourceSchema,
  CalendarExceptionKindSchema,
  CalendarTermSchema,
  CalendarExceptionSchema,
  CreateCalendarTermInputSchema,
  CreateCalendarExceptionInputSchema,
  FamilyCalendarResponseSchema,
  // Story 7-S14 — Kitchen Profile parent-deterministic safety edits
  AllergenKeySchema,
  AddChildAllergenRequestSchema,
  ChildAllergenMutationResponseSchema,
  SetCulturalEnforcementRequestSchema,
  SetCulturalEnforcementResponseSchema,
  // Story 7-S15 — Kitchen Profile Lumi-conversational soft edits (Phase 2)
  SetCulturalStateRequestSchema,
  SetCulturalStateResponseSchema,
  SetFavoriteLunchesRequestSchema,
  SetFavoriteLunchesResponseSchema,
  // Story 3-S41 — Family Snack Shelf add/remove
  SnackCategorySchema,
  SnackPackageTypeSchema,
  SnackAllergenTagSchema,
  SnackSkuSchema,
  CreateSnackSkuInputSchema,
  UpdateSnackSkuInputSchema,
  ListSnackSkusResponseSchema,
  SnackShelfHouseholdIdParamSchema,
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

// Invites (Slice 5-S2 — authenticated caregiver redemption + household roster)
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;
export type HouseholdMembersResponse = z.infer<typeof HouseholdMembersResponseSchema>;

// Geolocation consent (Slice 5-S14 — household-level opt-in; FR74, NFR-PRIV-3)
export type {
  HouseholdGeolocationConsent,
  UpdateGeolocationConsentRequest,
} from '@hivekitchen/contracts';

// Plans
export type AllergyVerdict = z.infer<typeof AllergyVerdict>;
export type PlanUpdatedEvent = z.infer<typeof PlanUpdatedEvent>;
export type PlanProgressEvent = z.infer<typeof PlanProgressEvent>;

// Allergy guardrail (Story 3.1)
export type Conflict = z.infer<typeof ConflictSchema>;
export type FlaggedCompoundItem = z.infer<typeof FlaggedCompoundItemSchema>;
export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;
export type PlanItemForGuardrail = z.infer<typeof PlanItemForGuardrailSchema>;
export type AllergyCheckInput = z.infer<typeof AllergyCheckInputSchema>;
export type AllergyCheckOutput = z.infer<typeof AllergyCheckOutputSchema>;

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
// Slice 2-S20 — browser-direct TTS via single-use token + TTS WebSocket
export type TtsTokenResponse = z.infer<typeof TtsTokenResponseSchema>;

// Events
export type InvalidationEvent = z.infer<typeof InvalidationEvent>;

// Memory
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

// Memory (Story 7-S3 — edit a sentence)
export type EditMemoryRequest = z.infer<typeof EditMemoryRequestSchema>;

// Memory (Story 7-S4 — soft-forget a sentence)
export type ForgetMemoryRequest = z.infer<typeof ForgetMemoryRequestSchema>;

// Parental review dashboard (Story 7-S8 — read-only aggregation panel)
export type ParentalDashboardResponse = z.infer<typeof ParentalDashboardResponseSchema>;
export type MemorySourceCounts = z.infer<typeof MemorySourceCountsSchema>;

// Consent history (Story 7-S9 — chronological audit_log read for FR72)
export type ConsentHistoryEvent = z.infer<typeof ConsentHistoryEventSchema>;
export type ConsentHistoryResponse = z.infer<typeof ConsentHistoryResponseSchema>;

// Data portability export (Story 7-S10 — FR71 / NFR-PRIV-6 / AR-22)
export type DataExportResponse = z.infer<typeof DataExportResponseSchema>;

// Account deletion (Story 7-S11 — FR69 / NFR-PRIV-2 — 30-day cascade)
export type DeleteHouseholdResponse = z.infer<typeof DeleteHouseholdResponseSchema>;

// Presence
export type SurfaceKind = z.infer<typeof SurfaceKind>;
export type PresenceEvent = z.infer<typeof PresenceEvent>;
export type PresenceHeartbeatRequest = z.infer<typeof PresenceHeartbeatRequestSchema>;
export type PresencePartner = z.infer<typeof PresencePartnerSchema>;
export type PresenceResponse = z.infer<typeof PresenceResponseSchema>;

// Errors
export type ErrorCode = z.infer<typeof ErrorCode>;
export type FieldError = z.infer<typeof FieldError>;
export type ApiError = z.infer<typeof ApiError>;

// Users (Story 2.4 — profile management)
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
// Slice 5-S13 — PATCH /v1/users/me/accessibility body
export type UpdateAccessibilityRequest = z.infer<typeof UpdateAccessibilityRequestSchema>;
// Slice 5-S15 — voice transcript retention controls
export type VoiceRetentionMode = z.infer<typeof VoiceRetentionModeSchema>;
export type UpdateVoiceRetentionRequest = z.infer<typeof UpdateVoiceRetentionRequestSchema>;
export type VoiceTranscriptItem = z.infer<typeof VoiceTranscriptItemSchema>;
export type VoiceTranscriptsResponse = z.infer<typeof VoiceTranscriptsResponseSchema>;
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
export type AppetiteLevel = z.infer<typeof AppetiteLevelSchema>;
export type TextureNeeds = z.infer<typeof TextureNeedsSchema>;
export type SpiceTolerance = z.infer<typeof SpiceToleranceSchema>;
export type SetBagCompositionBody = z.infer<typeof SetBagCompositionBodySchema>;
export type SetBagCompositionResponse = z.infer<typeof SetBagCompositionResponseSchema>;
// Story 7-S7 — annual flavor-journey reset response.
export type ResetFlavorJourneyResponse = z.infer<typeof ResetFlavorJourneyResponseSchema>;

// School policies (Story 3.16 — per-slot policy update + plan propagation)
export type SlotScope = z.infer<typeof SlotScopeSchema>;
export type SchoolPolicy = z.infer<typeof SchoolPolicySchema>;
export type UpdateSchoolPolicyInput = z.infer<typeof UpdateSchoolPolicyInputSchema>;
export type UpdateSchoolPolicyResponse = z.infer<typeof UpdateSchoolPolicyResponseSchema>;
export type GetSchoolPoliciesResponse = z.infer<typeof GetSchoolPoliciesResponseSchema>;
export type SchoolPolicyChildIdParam = z.infer<typeof SchoolPolicyChildIdParamSchema>;

// Day-level context (Story 3.19 / 3-DM-E1 — FR118, FR119; formerly the day-overrides table)
export type PlanDayContextType = z.infer<typeof PlanDayContextTypeSchema>;
export type PlanDayContext = z.infer<typeof PlanDayContextSchema>;
export type SetPlanDayContextInput = z.infer<typeof SetPlanDayContextInputSchema>;
export type SetPlanDayContextResponse = z.infer<typeof SetPlanDayContextResponseSchema>;

// Cultural priors (Story 2.11)
export type CulturalKey = z.infer<typeof CulturalKeySchema>;
export type Tier = z.infer<typeof TierSchema>;
export type TemplateState = z.infer<typeof TemplateStateSchema>;
export type CulturalPrior = z.infer<typeof CulturalPriorSchema>;
export type RatifyAction = z.infer<typeof RatifyActionSchema>;
export type RatifyCulturalPriorBody = z.infer<typeof RatifyCulturalPriorBodySchema>;
export type CulturalPriorListResponse = z.infer<typeof CulturalPriorListResponseSchema>;
export type RatifyCulturalPriorResponse = z.infer<typeof RatifyCulturalPriorResponseSchema>;
export type TurnBodyRatificationPrompt = z.infer<typeof TurnBodyRatificationPrompt>;

// Family-language ratchet (Slice 5-S10 — UX-DR47 forward-only kinship terms)
export type TurnBodyFamilyLanguagePrompt = z.infer<typeof TurnBodyFamilyLanguagePrompt>;
export type FamilyLanguageState = z.infer<typeof FamilyLanguageStateSchema>;
export type FamilyLanguageTerm = z.infer<typeof FamilyLanguageTermSchema>;
export type FamilyLanguageRatifyAction = z.infer<typeof FamilyLanguageRatifyActionSchema>;
export type FamilyLanguageRatifyBody = z.infer<typeof FamilyLanguageRatifyBodySchema>;
export type FamilyLanguageRatifyResponse = z.infer<typeof FamilyLanguageRatifyResponseSchema>;
export type FamilyLanguageTermsResponse = z.infer<typeof FamilyLanguageTermsResponseSchema>;

// Ambient Lumi (Story 12.1 — ADR-002 contract surface)
export type LumiSurface = z.infer<typeof LumiSurfaceSchema>;
export type LumiContextSignal = z.infer<typeof LumiContextSignalSchema>;
export type LumiTurnRequest = z.infer<typeof LumiTurnRequestSchema>;
export type LumiTurnResponse = z.infer<typeof LumiTurnResponseSchema>;
export type LumiThreadTurnsResponse = z.infer<typeof LumiThreadTurnsResponseSchema>;
export type VoiceTalkSessionCreate = z.infer<typeof VoiceTalkSessionCreateSchema>;
export type VoiceTalkSessionResponse = z.infer<typeof VoiceTalkSessionResponseSchema>;
export type LumiNudgeEvent = z.infer<typeof LumiNudgeEventSchema>;
// Story 12-S11 — proactive-nudge trigger class (job data + DB traceability).
export type NudgeTrigger = z.infer<typeof NudgeTriggerSchema>;

// Agent tools (Story 3.4 — recipe / pantry / plan / cultural lookup)
export type RecipeSearchInput = z.infer<typeof RecipeSearchInputSchema>;
export type RecipeSearchOutput = z.infer<typeof RecipeSearchOutputSchema>;
export type RecipePreview = z.infer<typeof RecipePreviewSchema>;
export type RecipeFetchInput = z.infer<typeof RecipeFetchInputSchema>;
export type RecipeFetchOutput = z.infer<typeof RecipeFetchOutputSchema>;
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

// Story 3-31 — RecipeAgent discover surface
export type RecipeAgentExtraction = z.infer<typeof RecipeAgentExtractionSchema>;
export type RecipeDiscoverInput = z.infer<typeof RecipeDiscoverInputSchema>;
export type RecipeDiscoverOutput = z.infer<typeof RecipeDiscoverOutputSchema>;
export type RecipeDiscoverConstraints = z.infer<typeof RecipeDiscoverConstraintsSchema>;

// Story 4-S11 — child_signal agent tool I/O
export type ChildSignalInput = z.infer<typeof ChildSignalInputSchema>;
export type ChildSignalRecipeItem = z.infer<typeof ChildSignalRecipeItemSchema>;
export type ChildSignalPerChild = z.infer<typeof ChildSignalPerChildSchema>;
export type ChildSignalFamilyPattern = z.infer<typeof ChildSignalFamilyPatternSchema>;
export type ChildSignalOutput = z.infer<typeof ChildSignalOutputSchema>;

// Slice A0 — Recipes catalog DB row shapes
export type RecipeRow = z.infer<typeof RecipeRowSchema>;
export type RecipeUnit = z.infer<typeof RecipeUnitSchema>;
export type RecipeSource = z.infer<typeof RecipeSourceSchema>;
export type RecipeVisibility = z.infer<typeof RecipeVisibilitySchema>;
export type RecipeSlot = z.infer<typeof RecipeSlotSchema>;

// Slice A0c — Vocabulary table row shapes
export type AllergenRuleClass = z.infer<typeof AllergenRuleClassSchema>;
export type AllergenSeverity = z.infer<typeof AllergenSeveritySchema>;
export type AllergenTagRow = z.infer<typeof AllergenTagRowSchema>;
export type DietaryCategory = z.infer<typeof DietaryCategorySchema>;
export type DietaryTagRow = z.infer<typeof DietaryTagRowSchema>;
export type CulturalTagRow = z.infer<typeof CulturalTagRowSchema>;
export type CuisineRegion = z.infer<typeof CuisineRegionSchema>;
export type CuisineTagRow = z.infer<typeof CuisineTagRowSchema>;
export type VocabularySnapshot = z.infer<typeof VocabularySnapshotSchema>;

// Slice A0 — Kitchen Map projection
export type KitchenMap = z.infer<typeof KitchenMapSchema>;
export type KitchenMapHousehold = z.infer<typeof KitchenMapHouseholdSchema>;
export type KitchenMapCaregiver = z.infer<typeof KitchenMapCaregiverSchema>;
export type KitchenMapCaregiverRole = z.infer<typeof KitchenMapCaregiverRoleSchema>;
export type KitchenMapChild = z.infer<typeof KitchenMapChildSchema>;
export type KitchenMapCultural = z.infer<typeof KitchenMapCulturalSchema>;
export type KitchenMapCulturalPrior = z.infer<typeof KitchenMapCulturalPriorSchema>;
export type KitchenMapCulturalPriorState = z.infer<typeof KitchenMapCulturalPriorStateSchema>;
export type KitchenMapMemory = z.infer<typeof KitchenMapMemorySchema>;
export type KitchenMapMemoryNode = z.infer<typeof KitchenMapMemoryNodeSchema>;
export type KitchenMapMemoryNodeType = z.infer<typeof KitchenMapMemoryNodeTypeSchema>;
export type KitchenMapHouseholdExtras = z.infer<typeof KitchenMapHouseholdExtrasSchema>;
export type KitchenMapExtraLibraryItem = z.infer<typeof KitchenMapExtraLibraryItemSchema>;
export type KitchenMapRecipes = z.infer<typeof KitchenMapRecipesSchema>;
export type KitchenMapFavouriteRecipe = z.infer<typeof KitchenMapFavouriteRecipeSchema>;
export type KitchenMapMeta = z.infer<typeof KitchenMapMetaSchema>;
// Slice 2.6-s1 — catalog provenance enum used by KitchenMapFavoriteLunch
// and KitchenMapFavouriteRecipe.
export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;

// Slice C — Onboarding agent tool I/O
export type ChildUpsertInput = z.infer<typeof ChildUpsertInputSchema>;
export type ChildUpsertOutput = z.infer<typeof ChildUpsertOutputSchema>;
export type CulturalNoteInput = z.infer<typeof CulturalNoteInputSchema>;
export type CulturalNoteOutput = z.infer<typeof CulturalNoteOutputSchema>;
export type MemoryNoteFromOnboardingInput = z.infer<typeof MemoryNoteFromOnboardingInputSchema>;
export type MemoryNoteFromOnboardingOutput = z.infer<typeof MemoryNoteFromOnboardingOutputSchema>;
export type MemoryNoteFromOnboardingNodeType = z.infer<typeof MemoryNoteFromOnboardingNodeTypeSchema>;

export type PantryReadInput = z.infer<typeof PantryReadInputSchema>;
export type PantryReadOutput = z.infer<typeof PantryReadOutputSchema>;
export type PantryItem = z.infer<typeof PantryItemSchema>;

export type CulturalLookupInput = z.infer<typeof CulturalLookupInputSchema>;
export type CulturalLookupOutput = z.infer<typeof CulturalLookupOutputSchema>;

// Plan canonical row (Story 3-DM-C1 Phase 9b part 4 step 5 — formerly
// PlanRowCanonical; the flat PlanRow with week_id retired with plan_items).
export type PlanRow = z.infer<typeof PlanRowSchema>;

// brief_state projection (Story 3.6)
export type PlanTileSummary = z.infer<typeof PlanTileSummarySchema>;
// Story 3-DM-D1 — consolidated brief_state payload shape.
export type BriefStatePayload = z.infer<typeof BriefStatePayloadSchema>;
export type BriefStateRow = z.infer<typeof BriefStateRowSchema>;
export type BriefResponse = z.infer<typeof BriefResponseSchema>;

// Slice 5-S8 — "I noticed" learning moment callout + respond action
export type LearningMomentCallout = z.infer<typeof LearningMomentCalloutSchema>;
export type LearningMomentAction = z.infer<typeof LearningMomentActionSchema>;
export type RespondToLearningMomentRequest = z.infer<typeof RespondToLearningMomentRequestSchema>;

// Cleared allergies (Story 3.10 — composer-emitted entry per child/allergen)
export type ClearedAllergyEntry = z.infer<typeof ClearedAllergyEntrySchema>;

// Scaffolding diff (Story 3.11 — QuietDiff rear-view)
export type ScaffoldingDiff = z.infer<typeof ScaffoldingDiffSchema>;

// Story 3.13 — plan regeneration types
export type RegeneratePlanQuery = z.infer<typeof RegeneratePlanQuerySchema>;
export type RegeneratePlanResponse = z.infer<typeof RegeneratePlanResponseSchema>;

// Story 3-S34 — on-demand plan composition response
export type GeneratePlanResponse = z.infer<typeof GeneratePlanResponseSchema>;

// Story 3-S35 — weekly auto-compose enrollment toggle
export type {
  AutoComposeState,
  UpdateAutoComposeRequest,
} from '@hivekitchen/contracts';

// Story 3.14 — following-week draft view types (canonical tree shape)
export type GetPlansQuery = z.infer<typeof GetPlansQuerySchema>;
export type GetPlansResponse = z.infer<typeof GetPlansResponseSchema>;

// Story 3.25 — hard-fail escalation status payload
export type HardFailStatus = z.infer<typeof HardFailStatusSchema>;

// Story 3.15 — historical plans + outcomes view types (canonical tree shape)
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


// Slice 2-s27 — household food-identity profile (agent tool + REST route)
export type HouseholdUpsertInput = z.infer<typeof HouseholdUpsertInputSchema>;
export type HouseholdUpsertOutput = z.infer<typeof HouseholdUpsertOutputSchema>;
export type HouseholdProfilePatchBody = z.infer<typeof HouseholdProfilePatchBodySchema>;
export type HouseholdProfileResponse = z.infer<typeof HouseholdProfileResponseSchema>;
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;

// Story 3.29 — sovereignty mode toggle
export type UpdateSovereigntyModeInput = z.infer<typeof UpdateSovereigntyModeInputSchema>;
export type UpdateSovereigntyModeResponse = z.infer<typeof UpdateSovereigntyModeResponseSchema>;

// Slice 2.5-s1 — enforcement gradient + KitchenMap structured signal arrays
export { ENFORCEMENT_LEVEL_VALUES };
export type EnforcementLevel = z.infer<typeof EnforcementLevelSchema>;
export type BagCompositionPattern = z.infer<typeof BagCompositionPatternSchema>;
export type KitchenMapAllergen = z.infer<typeof KitchenMapAllergenSchema>;
export type KitchenMapDietary = z.infer<typeof KitchenMapDietarySchema>;
export type KitchenMapFoodPreference = z.infer<typeof KitchenMapFoodPreferenceSchema>;
export type KitchenMapFavoriteLunch = z.infer<typeof KitchenMapFavoriteLunchSchema>;
export type KitchenMapRule = z.infer<typeof KitchenMapRuleSchema>;

// Slice 2.5-s1 — seven new structured onboarding tool I/O contracts (stubs;
// wired in slice 2.5-s4)
export type HouseholdSetNameInput = z.infer<typeof HouseholdSetNameInputSchema>;
export type HouseholdSetNameOutput = z.infer<typeof HouseholdSetNameOutputSchema>;
export type AllergenDeclareInput = z.infer<typeof AllergenDeclareInputSchema>;
export type AllergenDeclareOutput = z.infer<typeof AllergenDeclareOutputSchema>;
export type DietaryDeclareInput = z.infer<typeof DietaryDeclareInputSchema>;
export type DietaryDeclareOutput = z.infer<typeof DietaryDeclareOutputSchema>;
export type CuisineDeclareInput = z.infer<typeof CuisineDeclareInputSchema>;
export type CuisineDeclareOutput = z.infer<typeof CuisineDeclareOutputSchema>;
export type FoodPreferenceDeclareInput = z.infer<typeof FoodPreferenceDeclareInputSchema>;
export type FoodPreferenceDeclareOutput = z.infer<typeof FoodPreferenceDeclareOutputSchema>;
export type FavoriteLunchAddInput = z.infer<typeof FavoriteLunchAddInputSchema>;
export type FavoriteLunchAddOutput = z.infer<typeof FavoriteLunchAddOutputSchema>;
export type RuleSetInput = z.infer<typeof RuleSetInputSchema>;
export type RuleSetOutput = z.infer<typeof RuleSetOutputSchema>;

// Story 3.28 — Lunch Link suppression
export type LunchLinkPauseInput = z.infer<typeof LunchLinkPauseInputSchema>;
export type LunchLinkPauseResponse = z.infer<typeof LunchLinkPauseResponseSchema>;

// Slice 4-S12 — FlavorPassport
export type FlavorPassportStamp = z.infer<typeof FlavorPassportStampSchema>;
export type FlavorPassportState = z.infer<typeof FlavorPassportStateSchema>;
export type FlavorPassportResponse = z.infer<typeof FlavorPassportResponseSchema>;

// Slice 4-S15 — Child Request-a-Lunch + Parent Approval
export type ChildRequestCreate = z.infer<typeof ChildRequestCreateSchema>;
export type ChildRequest = z.infer<typeof ChildRequestSchema>;
export type PendingChildRequestsResponse = z.infer<typeof PendingChildRequestsResponseSchema>;

// Slice 4-S13 — Grandparent Guest Author cap
export type { GuestAuthorCapResponse } from '@hivekitchen/contracts';

// Story 3.27 — variant proposal active-learning
export type PlanVariantProposalOutput = z.infer<typeof PlanVariantProposalOutputSchema>;
export type VariantProposal = z.infer<typeof VariantProposalSchema>;
export type ConfirmVariantProposalInput = z.infer<typeof ConfirmVariantProposalInputSchema>;

// Story 3-DM-C1 — Plan structure canonical (tree shape).
// Step 5 cutover complete: the flat PlanItemRow / PlanItemWrite /
// CommitPlanInput / SwapPlanItemInput / PlanComposeInput|Output / flat
// PlanRow / flat GetPlansResponse / flat PlanHistoryResponse types retired
// with plan_items. Canonical names take their slots.
export type Weekday = z.infer<typeof WeekdaySchema>;
export type SlotKind = z.infer<typeof SlotKindSchema>;
export type ExtraKind = z.infer<typeof ExtraKindSchema>;
export type PortionSize = z.infer<typeof PortionSizeSchema>;
export type TextureLevel = z.infer<typeof TextureLevelSchema>;
export type SpiceLevel = z.infer<typeof SpiceLevelSchema>;
export type PauseReason = z.infer<typeof PauseReasonSchema>;
export type PlanMainAssignmentRow = z.infer<typeof PlanMainAssignmentRowSchema>;
export type PlanDayRow = z.infer<typeof PlanDayRowSchema>;
export type PlanSlotRow = z.infer<typeof PlanSlotRowSchema>;
export type PlanSlotVariationRow = z.infer<typeof PlanSlotVariationRowSchema>;
export type PlannerVariationInput = z.infer<typeof PlannerVariationInputSchema>;
export type PlannerSlotInput = z.infer<typeof PlannerSlotInputSchema>;
export type PlannerDayInput = z.infer<typeof PlannerDayInputSchema>;
export type PlannerMainAssignmentInput = z.infer<typeof PlannerMainAssignmentInputSchema>;
export type PlanComposeTreeInput = z.infer<typeof PlanComposeTreeInputSchema>;
export type PlanComposeTreeOutput = z.infer<typeof PlanComposeTreeOutputSchema>;
export type CommitPlanTreeInput = z.infer<typeof CommitPlanTreeInputSchema>;

// Story 3-DM-C1 Phase 9b part 4 — wire-shape mutation + history-summary types.
export type PlanSwapSummaryTree = z.infer<typeof PlanSwapSummaryTreeSchema>;
export type SwapMainInput = z.infer<typeof SwapMainInputSchema>;
export type SwapMainResponse = z.infer<typeof SwapMainResponseSchema>;
export type UpdateVariationInput = z.infer<typeof UpdateVariationInputSchema>;
export type UpdateVariationResponse = z.infer<typeof UpdateVariationResponseSchema>;
export type SwapSlotRecipeInput = z.infer<typeof SwapSlotRecipeInputSchema>;
export type SwapSlotRecipeResponse = z.infer<typeof SwapSlotRecipeResponseSchema>;
export type SwapSlotSnackSkuInput = z.infer<typeof SwapSlotSnackSkuInputSchema>;
// Epic 13-s9 — conversational plan-edit wire types.
export type PlanIntentResult = z.infer<typeof PlanIntentResultSchema>;
export type PlanEditParam = z.infer<typeof PlanEditParamSchema>;
export type PlanEditInput = z.infer<typeof PlanEditInputSchema>;
export type PlanEditResult = z.infer<typeof PlanEditResultSchema>;
export type PlanEditResponse = z.infer<typeof PlanEditResponseSchema>;
export type PlanEditFixedSlot = z.infer<typeof PlanEditFixedSlotSchema>;
export type DispatchTier = z.infer<typeof DispatchTierSchema>;
export type PausePlanDayTreeInput = z.infer<typeof PausePlanDayTreeInputSchema>;
export type PauseChildOnDayInput = z.infer<typeof PauseChildOnDayInputSchema>;
export type MainAssignmentParam = z.infer<typeof MainAssignmentParamSchema>;
export type VariationParam = z.infer<typeof VariationParamSchema>;
export type PlanSlotParam = z.infer<typeof PlanSlotParamSchema>;
export type PlanDayContextSlotParam = z.infer<typeof PlanDayContextSlotParamSchema>;
export type PlanDayContextSlotRevertParam = z.infer<typeof PlanDayContextSlotRevertParamSchema>;

// Slice 5-S12 — conversational swap proposal.
export type ProposeSwapInput = z.infer<typeof ProposeSwapInputSchema>;
export type ProposeSwapResponse = z.infer<typeof ProposeSwapResponseSchema>;

// State-residency compliance scaffold (Story 7-S12 — AR-21, NFR-COMP-3)
export type StateComplianceOverridesResponse = z.infer<typeof StateComplianceOverridesResponseSchema>;

// Slice 5-S3 — PackerOfTheDay (day_assignments read/write)
export type DayAssignment = z.infer<typeof DayAssignmentSchema>;
export type DayAssignmentsResponse = z.infer<typeof DayAssignmentsResponseSchema>;
export type AssignPackerRequest = z.infer<typeof AssignPackerRequestSchema>;
export type AssignPackerResponse = z.infer<typeof AssignPackerResponseSchema>;

// Story 15-s1 — Family Calendar (calendar_terms + calendar_exceptions)
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
export type CalendarExceptionKind = z.infer<typeof CalendarExceptionKindSchema>;
export type CalendarTerm = z.infer<typeof CalendarTermSchema>;
export type CalendarException = z.infer<typeof CalendarExceptionSchema>;
export type CreateCalendarTermInput = z.infer<typeof CreateCalendarTermInputSchema>;
export type CreateCalendarExceptionInput = z.infer<typeof CreateCalendarExceptionInputSchema>;
export type FamilyCalendarResponse = z.infer<typeof FamilyCalendarResponseSchema>;

// Story 7-S14 — Kitchen Profile parent-deterministic safety edits (Phase 1)
export type AllergenKey = z.infer<typeof AllergenKeySchema>;
export type AddChildAllergenRequest = z.infer<typeof AddChildAllergenRequestSchema>;
export type ChildAllergenMutationResponse = z.infer<typeof ChildAllergenMutationResponseSchema>;
export type SetCulturalEnforcementRequest = z.infer<typeof SetCulturalEnforcementRequestSchema>;
export type SetCulturalEnforcementResponse = z.infer<typeof SetCulturalEnforcementResponseSchema>;

// Story 7-S15 — Kitchen Profile Lumi-conversational soft edits (Phase 2)
export type SetCulturalStateRequest = z.infer<typeof SetCulturalStateRequestSchema>;
export type SetCulturalStateResponse = z.infer<typeof SetCulturalStateResponseSchema>;
export type SetFavoriteLunchesRequest = z.infer<typeof SetFavoriteLunchesRequestSchema>;
export type SetFavoriteLunchesResponse = z.infer<typeof SetFavoriteLunchesResponseSchema>;

// Story 3-S41 — Family Snack Shelf add/remove
export type SnackCategory = z.infer<typeof SnackCategorySchema>;
export type SnackPackageType = z.infer<typeof SnackPackageTypeSchema>;
// Story 3-S43 — FALCPA-9 allergen tag on snack SKUs
export type SnackAllergenTag = z.infer<typeof SnackAllergenTagSchema>;
export type SnackSku = z.infer<typeof SnackSkuSchema>;
export type CreateSnackSkuInput = z.infer<typeof CreateSnackSkuInputSchema>;
export type UpdateSnackSkuInput = z.infer<typeof UpdateSnackSkuInputSchema>;
export type ListSnackSkusResponse = z.infer<typeof ListSnackSkusResponseSchema>;
export type SnackShelfHouseholdIdParam = z.infer<typeof SnackShelfHouseholdIdParamSchema>;
