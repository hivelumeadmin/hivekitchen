// LEGAL REVIEW REQUIRED before beta launch — placeholder text only.
//
// Inline as a TypeScript string so the declaration ships in the API's
// compiled `dist/` bundle without a build-time asset-copy step. Any text
// edit MUST be accompanied by a bump of `CURRENT_DECLARATION_VERSION`
// in compliance.service.ts plus a new `vN.ts` here — never edit a
// previously-signed version in place.
export const CONSENT_DECLARATION_V1 = `# HiveKitchen Beta — Verifiable Parental Consent Declaration (v1)

HiveKitchen is operated by HiveLume. By signing this declaration, you confirm that you are the parent or legal guardian of every child profile you create on this account, and that you consent to HiveKitchen collecting and processing the following information about your family during the beta program.

## What we collect

- **Household profile** — your name, contact email, household time zone, and cultural-template preferences.
- **Child profile (per child)** — first name (or short nickname), age band, declared allergies and intolerances, and palate preferences you describe to Lumi.
- **Onboarding conversation** — the transcript of your text or voice conversation with Lumi during onboarding, used to infer the family-profile fields above.
- **Plan and feedback signals** — the weekly plans Lumi generates for your household, swaps you make, and any Heart Notes you author.

## Who processes this data

HiveKitchen relies on a small set of named processors to operate. Each one only sees the subset of data needed to perform its function:

- **Supabase** — primary database, authentication, and storage.
- **ElevenLabs** — speech-to-text and text-to-speech for voice sessions.
- **OpenAI** — Lumi's conversational reasoning during onboarding and weekly planning.
- **SendGrid** — transactional email (Lunch Link delivery, account notifications).
- **Twilio** — SMS-based Lunch Link delivery and notifications.
- **Stripe** — billing and subscription processing (post-beta).

## How long we keep it

- **Voice transcripts** — 90 days by default. You may opt into longer retention or trigger immediate deletion at any time.
- **Family profile, plans, and Heart Notes** — kept for the active life of your account.
- **Audit and consent records** — retained for the period required by COPPA and applicable state privacy laws.

## Your rights

- **Withdraw consent and delete your data.** You may revoke this consent and request deletion at any time. We will erase your family's data — including across our processors — within 30 days of your request.
- **Review what we hold.** Your account dashboard exposes every memory, plan, allergy declaration, and audit entry tied to your household.
- **Correct anything wrong.** You can edit or remove individual memories and child profile fields directly.
- **Export your data.** A machine-readable JSON export is available on request.

## COPPA notice

Under the Children's Online Privacy Protection Act (COPPA), we do not knowingly collect personal information from a child under 13 without verifiable parental consent. By signing this declaration as the primary parent of this household, you provide that consent for each child profile you create here. You may revoke consent at any time, after which we will stop collecting new information about that child and delete prior collected data within 30 days.

## What signing means

Pressing **I agree and sign** below records this declaration (version v1) against your household, with your user identity and a timestamp, in our immutable consent log. This record is the verifiable-parental-consent mechanism for the HiveKitchen beta program. At public launch, this beta mechanism will be replaced by a credit-card verification step; existing beta consent will remain valid for the beta period.

If you have questions before signing, contact privacy@hivelume.com.
`;
