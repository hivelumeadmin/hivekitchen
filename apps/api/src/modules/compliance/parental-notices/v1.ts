// LEGAL REVIEW REQUIRED before beta launch — placeholder text only.
//
// Inline as a TypeScript string so the notice ships in the API's compiled
// `dist/` bundle without a build-time asset-copy step. Any text edit MUST
// be accompanied by a bump of `CURRENT_PARENTAL_NOTICE_VERSION` in
// compliance.service.ts plus a new `vN.ts` here — never edit a previously-
// acknowledged version in place. (Mirrors the Story 2.8 consent-declarations
// pattern; see consent-declarations/README.md.)

export interface ProcessorEntry {
  readonly name:
    | 'supabase'
    | 'elevenlabs'
    | 'sendgrid'
    | 'twilio'
    | 'stripe'
    | 'openai';
  readonly display_name: string;
  readonly purpose: string;
  readonly data_categories: readonly string[];
  readonly retention_label: string;
}

export interface RetentionEntry {
  readonly category: string;
  readonly horizon_days: number | null;
  readonly label: string;
}

export const PARENTAL_NOTICE_V1_PROCESSORS: readonly ProcessorEntry[] = [
  {
    name: 'supabase',
    display_name: 'Supabase',
    purpose: 'Primary database, authentication, and file storage.',
    data_categories: [
      'household profile',
      'child profile',
      'plans',
      'memory nodes',
      'audit log',
    ],
    retention_label: 'Active-account lifetime; deleted within 30 days of account closure.',
  },
  {
    name: 'elevenlabs',
    display_name: 'ElevenLabs',
    purpose: 'Speech-to-text and text-to-speech for voice sessions with Lumi.',
    data_categories: ['voice audio', 'voice transcripts'],
    retention_label: '90 days by default. Opt in to longer or trigger immediate deletion any time.',
  },
  {
    name: 'sendgrid',
    display_name: 'SendGrid',
    purpose: 'Transactional email delivery (Lunch Link, account notifications).',
    data_categories: ['parent email address', 'message content'],
    retention_label: 'Provider-side: ~30-day operational log; account-side: deleted within 30 days of account closure.',
  },
  {
    name: 'twilio',
    display_name: 'Twilio',
    purpose: 'SMS delivery for Lunch Link and notifications you opt into.',
    data_categories: ['parent phone number', 'message content'],
    retention_label: 'Provider-side: short operational window; account-side: deleted within 30 days of account closure.',
  },
  {
    name: 'stripe',
    display_name: 'Stripe',
    purpose: 'Billing and subscription processing (post-beta).',
    data_categories: ['billing identity', 'payment-method tokens'],
    retention_label: 'As required by financial regulation; account-side: deleted within 30 days of account closure where law permits.',
  },
  {
    name: 'openai',
    display_name: 'OpenAI',
    purpose: "Lumi's conversational reasoning during onboarding and weekly planning.",
    data_categories: ['scoped agent context', 'recipe and plan reasoning'],
    retention_label: 'Provider-side: 30 days zero-retention configuration; account-side: deleted within 30 days of account closure.',
  },
] as const;

export const PARENTAL_NOTICE_V1_DATA_CATEGORIES: readonly string[] = [
  'household profile (parent name, contact email, time zone, cultural-template preferences)',
  'child profile (first name or nickname, age band, declared allergies and intolerances, palate preferences)',
  'onboarding conversation (text or voice transcript with Lumi during the family-profile interview)',
  'plan and feedback signals (weekly plans, swaps, Heart Notes you author)',
  'audit and consent records (timestamped record of consent and material changes)',
] as const;

export const PARENTAL_NOTICE_V1_RETENTION: readonly RetentionEntry[] = [
  {
    category: 'voice transcripts',
    horizon_days: 90,
    label: '90 days by default. You may opt into longer retention or trigger immediate deletion at any time.',
  },
  {
    category: 'family profile, plans, Heart Notes',
    horizon_days: null,
    label: 'Kept for the active life of your account. Deleted within 30 days of account closure across all named processors.',
  },
  {
    category: 'consent and audit records',
    horizon_days: null,
    label: 'Retained for the period required by COPPA and applicable state privacy laws.',
  },
] as const;

export const PARENTAL_NOTICE_V1_CONTENT = `# Before we collect data about your family

This notice explains what HiveKitchen collects about your household, who processes it, and how long we keep it. We deliver it before your first child profile so you can read it once and revisit it any time from **Account → Privacy & Data**.

You sign a separate, immutable consent declaration at the end of onboarding (the COPPA verifiable-parental-consent step). This notice is informational — it tells you the full picture so the consent you sign is informed.

## What we collect, and why

- **Household profile** — your name, contact email, time zone, and cultural-template preferences. We use these to set up your account and personalise Lumi's tone and rhythm to your family.
- **Child profile (per child)** — first name (or short nickname), age band, declared allergies and intolerances, and palate preferences. We use these to compose safe, allergy-cleared weekly plans your family will actually eat.
- **Onboarding conversation** — the transcript of your text or voice conversation with Lumi during onboarding. We use it to infer the family-profile fields above; it never trains an external model.
- **Plan and feedback signals** — the weekly plans Lumi generates for your household, swaps you make, and any Heart Notes you author. We use these to refine Lumi's understanding of your family's rhythm.
- **Audit and consent records** — a timestamped record of when you consented, when material changes happened, and which version of this notice you read.

## Who processes your data

HiveKitchen relies on a small set of named processors to operate. Each one only sees the subset of data it needs to perform its function.

- **Supabase** — primary database, authentication, and file storage. Holds your household profile, child profiles, plans, memory nodes, and audit log. Retention: active-account lifetime; deleted within 30 days of account closure.
- **ElevenLabs** — speech-to-text and text-to-speech for voice sessions with Lumi. Holds voice audio and transcripts only for the duration of a session and the retention window. Retention: 90 days by default; opt in to longer or trigger immediate deletion any time.
- **SendGrid** — transactional email delivery (Lunch Link, account notifications). Holds your email address and message content only as needed to deliver. Retention: provider-side operational log of about 30 days; account-side deleted within 30 days of account closure.
- **Twilio** — SMS delivery for Lunch Link and notifications you opt into. Holds your phone number and message content only as needed to deliver. Retention: provider-side short operational window; account-side deleted within 30 days of account closure.
- **Stripe** — billing and subscription processing (post-beta only). Holds your billing identity and payment-method tokens; never holds child data. Retention: as required by financial regulation; account-side deleted within 30 days of account closure where law permits.
- **OpenAI** — Lumi's conversational reasoning during onboarding and weekly planning. Receives scoped agent context (no full transcripts unless needed for the current turn). Retention: provider-side 30-day zero-retention configuration; account-side deleted within 30 days of account closure.

## How long we keep it

- **Voice transcripts** — 90 days by default. You may opt into longer retention or trigger immediate deletion at any time.
- **Family profile, plans, and Heart Notes** — kept for the active life of your account. Deleted within 30 days of account closure across all named processors.
- **Audit and consent records** — retained for the period required by COPPA and applicable state privacy laws.

## Your rights

- **Withdraw consent and delete your data.** You may revoke consent and request deletion at any time. We will erase your family's data, including across our processors, within 30 days of your request.
- **Review what we hold.** Your account dashboard exposes every memory, plan, allergy declaration, and audit entry tied to your household.
- **Correct anything wrong.** You can edit or remove individual memories and child profile fields directly.
- **Export your data.** A machine-readable JSON export is available on request.

## How to revisit this notice

You can read this notice again any time from **Account → Privacy & Data**. If we update it (for legal reasons, processor changes, or material practice changes) we will publish a new version and ask you to read and acknowledge it before continuing to add or change child profiles.

If you have questions before acknowledging, contact privacy@hivelume.com.
`;
