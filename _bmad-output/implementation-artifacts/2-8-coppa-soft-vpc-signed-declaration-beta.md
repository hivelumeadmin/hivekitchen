# Story 2.8: COPPA soft-VPC signed declaration (beta)

Status: done

## Story

As a Primary Parent,
I want to sign a digital consent declaration during beta onboarding as the verifiable-parental-consent mechanism,
so that the system has auditable VPC for the beta period before credit-card VPC takes over at public launch (FR8).

## Architecture Overview

This story introduces the COPPA beta compliance primitive: a signed consent declaration that creates an immutable `vpc_consents` row, fires a `vpc.consented` audit event, and gates the user's transition from the onboarding interview into the main app.

The consent step slots in **after the interview finishes** (voice or text) and **before navigating to `/app`**. The onboarding page currently routes directly to `/app` on interview completion — this story intercepts that navigation and inserts a `'consent'` mode step.

```
Voice onDisconnect / Text finalize success
        ↓
  OnboardingPage mode → 'consent'
        ↓
  OnboardingConsent mounts
        ↓
  GET /v1/compliance/consent-declaration  → { document_version, content }
        ↓
  display text + scroll-gated "I agree" button
        ↓
  POST /v1/compliance/vpc-consent  { document_version }
        ↓
  ComplianceService.submitVpcConsent
        ↓  INSERT vpc_consents (immutable)
        ↓  request.auditContext = vpc.consented
        ↓
  200 { household_id, signed_at, mechanism, document_version }
        ↓
  navigate('/app')
```

New compliance module: `apps/api/src/modules/compliance/`
- `compliance.repository.ts` — wraps `vpc_consents` table (insert + existence check)
- `compliance.service.ts` — business logic (conflict guard, file read, response shape)
- `compliance.routes.ts` — two endpoints as `fp()` plugin

Consent text is versioned at `apps/api/src/modules/compliance/consent-declarations/v1.md`. The GET endpoint reads this file at service startup (cached) and returns `{ document_version: 'v1', content }`. The POST records exactly the version the user saw and signed.

**`vpc.consented` is already in both the TypeScript `AUDIT_EVENT_TYPES` array and the Postgres `audit_event_type` enum** (migration `20260501110000`). Do NOT add a new migration for the audit event type and do NOT modify `audit.types.ts` for this story.

## Acceptance Criteria

1. **Given** I am authenticated as `primary_parent` at the onboarding consent step, **When** I request `GET /v1/compliance/consent-declaration`, **Then** the API returns `200 { document_version: 'v1', content: <markdown text> }` sourced from `consent-declarations/v1.md`.

2. **Given** I have read the consent declaration, **When** I POST `{ document_version: 'v1' }` to `POST /v1/compliance/vpc-consent`, **Then** a `vpc_consents` row is persisted with `(household_id, mechanism: 'soft_signed_declaration', signed_at: <now>, signed_by_user_id: <my user_id>, document_version: 'v1')`, the `vpc.consented` audit event fires with `{ correlation_id: household_id, metadata: { mechanism: 'soft_signed_declaration' } }`, and the API returns `200 { household_id, signed_at, mechanism: 'soft_signed_declaration', document_version: 'v1' }`.

3. **Given** a `vpc_consents` row already exists for this `(household_id, mechanism, document_version)` combination, **When** the same POST is submitted again, **Then** `409 /errors/conflict` with detail `"consent already recorded for this household and document version"` — the row is immutable; re-consent is not permitted.

4. **Given** an unauthenticated request to either endpoint, **Then** `401`.

5. **Given** an authenticated `secondary_caregiver` JWT, **When** either endpoint is called, **Then** `403` — only `primary_parent` may sign the declaration.

6. **Given** `document_version` is missing or is not a known version (currently only `'v1'`), **When** POST is submitted, **Then** `400` Zod validation error.

7. **Given** voice onboarding has disconnected successfully, **When** `onDisconnect` fires in `OnboardingVoiceSession`, **Then** `OnboardingPage` transitions to `mode = 'consent'` (not directly to `/app`). Requires adding an `onComplete` callback prop to `OnboardingVoice`.

8. **Given** text onboarding has been successfully finalized (`POST /v1/onboarding/text/finalize` returned 200), **When** the response resolves, **Then** `OnboardingPage` transitions to `mode = 'consent'` (not directly to `/app`). Requires converting `OnboardingText`'s internal `navigate('/app')` call to an `onFinalized` prop call.

9. **Given** `mode === 'consent'`, **When** `OnboardingConsent` renders, **Then** the consent declaration text is fetched and displayed in a scrollable container with a sign button that is disabled until the user has scrolled to the bottom of the text.

10. **Given** consent has been signed (`POST /v1/compliance/vpc-consent` returned 200), **When** the `onConsented` callback fires, **Then** `OnboardingPage` calls `navigate('/app')`.

## Tasks / Subtasks

- [x] Task 1 — Migration: `vpc_consents` table (AC: 2, 3)
  - [x] Create `supabase/migrations/20260508000000_create_vpc_consents.sql`:
    ```sql
    -- Rollback: DROP TABLE vpc_consents;
    -- Story 2.8 — immutable COPPA soft-VPC consent record.
    -- No UPDATE or DELETE RLS policies — rows are append-only by design.
    CREATE TABLE vpc_consents (
      id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id        uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      mechanism           text        NOT NULL CHECK (mechanism = 'soft_signed_declaration'),
      signed_at           timestamptz NOT NULL DEFAULT now(),
      signed_by_user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_version    text        NOT NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT vpc_consents_household_mechanism_version_uniq
        UNIQUE (household_id, mechanism, document_version)
    );

    ALTER TABLE vpc_consents ENABLE ROW LEVEL SECURITY;

    -- Authenticated users may read their own household's consent record (e.g., audit view in Story 7.8).
    CREATE POLICY vpc_consents_select_own ON vpc_consents
      FOR SELECT USING (
        household_id = (
          SELECT current_household_id FROM users WHERE id = auth.uid()
        )
      );
    -- No UPDATE or DELETE policies — rows are immutable.
    ```

- [x] Task 2 — Consent declaration document (AC: 1)
  - [x] Create `apps/api/src/modules/compliance/consent-declarations/v1.md`:
    - First line must be exactly: `# HiveKitchen Beta — Verifiable Parental Consent Declaration (v1)`
    - Cover: identity of service (HiveKitchen / HiveLume), what data is collected (family profile, child name/age-band/allergies/palate preferences, onboarding conversation transcript), named processors (Supabase, ElevenLabs, SendGrid, Twilio, Stripe, OpenAI), data retention horizons (voice transcripts 90 days default; family profile for active-account lifetime), right to withdraw and delete (within 30 days across all processors), COPPA rights notice
    - Target length: ≤ 400 words — must be readable in under 2 minutes
    - **Add a comment block at the top of the file**: `<!-- LEGAL REVIEW REQUIRED before beta launch — placeholder text only -->`
    - This file is the source of truth: the document_version recorded in `vpc_consents` refers to this file's name (`v1`)

- [x] Task 3 — Contracts: compliance schemas (AC: 1, 2, 6)
  - [x] Create `packages/contracts/src/compliance.ts`:
    ```typescript
    import { z } from 'zod';

    export const KNOWN_CONSENT_VERSIONS = ['v1'] as const;

    export const ConsentDeclarationResponseSchema = z.object({
      document_version: z.string(),
      content: z.string(),
    });

    export const VpcConsentRequestSchema = z.object({
      document_version: z.enum(KNOWN_CONSENT_VERSIONS),
    });

    export const VpcConsentResponseSchema = z.object({
      household_id: z.string().uuid(),
      signed_at: z.string().datetime(),
      mechanism: z.literal('soft_signed_declaration'),
      document_version: z.string(),
    });
    ```
  - [x] Add re-exports in `packages/contracts/src/index.ts`:
    `export { KNOWN_CONSENT_VERSIONS, ConsentDeclarationResponseSchema, VpcConsentRequestSchema, VpcConsentResponseSchema } from './compliance.js';`
  - [x] Add inferred type re-exports in `packages/types/src/index.ts`:
    `export type { ConsentDeclarationResponse, VpcConsentRequest, VpcConsentResponse } from '@hivekitchen/contracts';` (using `export type` — isolatedModules)
  - [x] Create `packages/contracts/src/compliance.test.ts` — round-trip schema tests:
    - `VpcConsentRequestSchema` accepts `{ document_version: 'v1' }`, rejects missing field, rejects `{ document_version: 'v99' }` (unknown version)
    - `VpcConsentResponseSchema` accepts a valid shaped object, rejects non-uuid `household_id`, rejects invalid `signed_at` datetime
    - `ConsentDeclarationResponseSchema` accepts a valid object, rejects missing `content`

- [x] Task 4 — Backend: compliance module (AC: 1, 2, 3, 4, 5, 6)
  - [x] Create `apps/api/src/modules/compliance/compliance.repository.ts`:
    ```typescript
    import type { SupabaseClient } from '@supabase/supabase-js';

    export interface VpcConsentRow {
      id: string;
      household_id: string;
      mechanism: string;
      signed_at: string;
      signed_by_user_id: string;
      document_version: string;
      created_at: string;
    }

    export class ComplianceRepository {
      constructor(private readonly supabase: SupabaseClient) {}

      async findConsent(
        householdId: string,
        mechanism: string,
        documentVersion: string,
      ): Promise<VpcConsentRow | null> {
        // SELECT from vpc_consents WHERE household_id=$1 AND mechanism=$2 AND document_version=$3
        // Return null if not found, throw on unexpected DB error
      }

      async insertConsent(input: {
        household_id: string;
        mechanism: string;
        signed_by_user_id: string;
        document_version: string;
      }): Promise<VpcConsentRow> {
        // INSERT INTO vpc_consents (...) VALUES (...) RETURNING *
        // Throw on any DB error (UNIQUE violation will be guarded by service before reaching here)
      }
    }
    ```

  - [x] Create `apps/api/src/modules/compliance/compliance.service.ts`:
    ```typescript
    import { readFileSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import type { FastifyBaseLogger } from 'fastify';
    import { ConflictError } from '../../common/errors.js';
    import type { ComplianceRepository } from './compliance.repository.js';

    const MECHANISM = 'soft_signed_declaration' as const;

    export class ComplianceService {
      private readonly declarationContent: string;

      constructor(
        private readonly repository: ComplianceRepository,
        private readonly logger: FastifyBaseLogger,
      ) {
        // Read and cache at construction time — file is static per deploy.
        // Use import.meta.url — no __dirname in ESM.
        const dir = fileURLToPath(new URL('./consent-declarations/', import.meta.url));
        this.declarationContent = readFileSync(`${dir}v1.md`, 'utf8');
      }

      getConsentDeclaration(): { document_version: string; content: string } {
        return { document_version: 'v1', content: this.declarationContent };
      }

      async submitVpcConsent(input: {
        userId: string;
        householdId: string;
        documentVersion: string;
        requestId: string;
      }): Promise<{ household_id: string; signed_at: string; mechanism: string; document_version: string }> {
        // 1. Check for existing consent — throw ConflictError if already recorded
        const existing = await this.repository.findConsent(
          input.householdId, MECHANISM, input.documentVersion,
        );
        if (existing) {
          throw new ConflictError('consent already recorded for this household and document version');
        }
        // 2. Insert immutable record
        const row = await this.repository.insertConsent({
          household_id: input.householdId,
          mechanism: MECHANISM,
          signed_by_user_id: input.userId,
          document_version: input.documentVersion,
        });
        this.logger.info(
          { module: 'compliance', action: 'vpc.consented', household_id: input.householdId },
          'VPC consent recorded',
        );
        // 3. Return shaped response (audit fires via request.auditContext in route handler)
        return {
          household_id: row.household_id,
          signed_at: row.signed_at,
          mechanism: row.mechanism,
          document_version: row.document_version,
        };
      }
    }
    ```

  - [x] Create `apps/api/src/modules/compliance/compliance.routes.ts` (`fp` plugin, `name: 'compliance-routes'`):
    ```typescript
    import fp from 'fastify-plugin';
    import {
      ConsentDeclarationResponseSchema,
      VpcConsentRequestSchema,
      VpcConsentResponseSchema,
    } from '@hivekitchen/contracts';
    import { authorize } from '../../middleware/authorize.hook.js';
    import { ComplianceRepository } from './compliance.repository.js';
    import { ComplianceService } from './compliance.service.js';

    // Both endpoints are primary_parent only — secondary caregivers may not
    // sign the declaration on behalf of the household's primary parent.
    const requirePrimaryParent = authorize(['primary_parent']);

    const complianceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
      const service = new ComplianceService(
        new ComplianceRepository(fastify.supabase),
        fastify.log,
      );

      fastify.get(
        '/v1/compliance/consent-declaration',
        { preHandler: requirePrimaryParent, schema: { response: { 200: ConsentDeclarationResponseSchema } } },
        async () => service.getConsentDeclaration(),
      );

      fastify.post(
        '/v1/compliance/vpc-consent',
        {
          preHandler: requirePrimaryParent,
          schema: {
            body: VpcConsentRequestSchema,
            response: { 200: VpcConsentResponseSchema },
          },
        },
        async (request) => {
          const { document_version } = request.body as { document_version: string };
          const result = await service.submitVpcConsent({
            userId: request.user.id,
            householdId: request.user.household_id,
            documentVersion: document_version,
            requestId: request.id,
          });
          // Audit via onResponse hook — consistent with auth.routes.ts pattern
          request.auditContext = {
            event_type: 'vpc.consented',
            user_id: request.user.id,
            household_id: result.household_id,
            correlation_id: result.household_id,
            request_id: request.id,
            metadata: { mechanism: 'soft_signed_declaration' },
          };
          return result;
        },
      );
    };

    export const complianceRoutes = fp(complianceRoutesPlugin, { name: 'compliance-routes' });
    ```

  - [x] Register in `apps/api/src/app.ts`: add `await app.register(complianceRoutes)` after `onboardingRoutes`. Import `complianceRoutes` from `./modules/compliance/compliance.routes.js`.

- [x] Task 5 — Backend tests (AC: 1, 2, 3, 4, 5, 6)
  - [x] Create `apps/api/src/modules/compliance/compliance.routes.test.ts`:
    - `GET /v1/compliance/consent-declaration`:
      - happy path → 200, `document_version === 'v1'`, `content` is non-empty string
      - unauthenticated (no JWT) → 401
      - `secondary_caregiver` JWT → 403
    - `POST /v1/compliance/vpc-consent`:
      - happy path → 200, shaped response matches `VpcConsentResponseSchema`; `request.auditContext` populated with `event_type: 'vpc.consented'`
      - duplicate consent (household already has a row for v1) → 409 (`/errors/conflict`)
      - missing `document_version` body field → 400
      - unknown `document_version` (`'v99'`) → 400
      - unauthenticated → 401
      - `secondary_caregiver` JWT → 403
  - [x] Use same supabase chain-mock pattern as `onboarding.routes.test.ts` and `voice.routes.test.ts`
  - [x] Do NOT mock `@hivekitchen/contracts` — source-imported, deterministic
  - [x] Mock the `readFileSync` call or provide a real test fixture — simplest approach: create a small `consent-declarations/v1.md` fixture in tests or mock `node:fs` readFileSync for the service constructor

- [x] Task 6 — Frontend: completion callbacks (AC: 7, 8)
  - [x] Update `apps/web/src/features/onboarding/OnboardingVoice.tsx`:
    - Add `onComplete?: () => void` prop to the outer `OnboardingVoice` component
    - Pass it through to `OnboardingVoiceSession` as a prop
    - In `onDisconnect` callback: call `onComplete?.()` instead of `void navigate('/app')`
    - Remove the `useNavigate` import from this component if navigation is now owned by the parent
    - Keep the error/loading states as-is — only the success path changes

  - [x] Update `apps/web/src/features/onboarding/OnboardingText.tsx`:
    - Add `onFinalized?: () => void` prop
    - In `handleFinalize`, replace `void navigate('/app')` with `onFinalized?.()` (or `navigate('/app')` as fallback if prop absent — keeps existing tests green without change)
    - If `useNavigate` is only used in the finalize path, remove it once the prop is introduced (avoids dead import)

- [x] Task 7 — Frontend: `OnboardingConsent` component (AC: 9, 10)
  - [x] Create `apps/web/src/features/onboarding/OnboardingConsent.tsx`:
    - Props: `onConsented: () => void`
    - State: `declaration: ConsentDeclarationResponse | null`, `loadError: string | null`, `hasScrolled: boolean`, `signing: boolean`, `signError: string | null`
    - On mount: `hkFetch<ConsentDeclarationResponse>('/v1/compliance/consent-declaration')` → parse with `ConsentDeclarationResponseSchema.parse(raw)` → set `declaration`
    - Render a scrollable `<div>` (max-h `60vh`, overflow-y auto) containing the declaration markdown rendered as plain text (no markdown parser needed — display as `<pre className="whitespace-pre-wrap font-sans text-sm text-stone-700">`) with a sentinel `<div ref={sentinelRef}/>` at the bottom
    - Use `IntersectionObserver` (threshold `0.9`) on the sentinel to set `hasScrolled = true`. Guard with `typeof IntersectionObserver !== 'undefined'` for jsdom
    - Sign button: `disabled={!hasScrolled || signing || !declaration}` — honey-amber, full width
    - Sign button label: `signing ? 'Signing…' : 'I agree and sign'`
    - On sign: `hkFetch<VpcConsentResponse>('/v1/compliance/vpc-consent', { method: 'POST', body: { document_version: declaration.document_version } })` → on success call `onConsented()`
    - On sign error: display inline error, re-enable button (`signing = false`)
    - Loading state (GET in flight): render `<p className="font-sans text-stone-400 text-sm">Loading…</p>`
    - Load error: render error message + retry button that re-fetches
    - Editorial framing copy above the scrollable div (not inside): `"Before I save your family's preferences, Lumi needs your formal agreement to our data practices."`
    - Tailwind utilities only; warm-neutral palette; no inline `style={{}}`; `motion-reduce:` variant on any transitions
    - `import type { ConsentDeclarationResponse, VpcConsentResponse } from '@hivekitchen/types'`

  - [x] Update `apps/web/src/routes/(app)/onboarding.tsx`:
    - Add `'consent'` to the `OnboardingMode` union type
    - Import `useNavigate` from `react-router-dom` (add if not already present)
    - Import `OnboardingConsent` from `@/features/onboarding/OnboardingConsent.js`
    - Voice path: pass `onComplete={() => setMode('consent')}` to `<OnboardingVoice />`
    - Text path: pass `onFinalized={() => setMode('consent')}` to `<OnboardingText />`
    - Add `mode === 'consent'` branch:
      ```tsx
      if (mode === 'consent') {
        return (
          <main className="min-h-screen flex items-start justify-center px-4 py-8">
            <div className="w-full max-w-2xl flex flex-col gap-6">
              <h1 className="font-serif text-2xl text-stone-800 text-center">
                One final step
              </h1>
              <OnboardingConsent onConsented={() => void navigate('/app')} />
            </div>
          </main>
        );
      }
      ```

- [x] Task 8 — Frontend tests (AC: 9, 10)
  - [x] Create `apps/web/src/features/onboarding/OnboardingConsent.test.tsx`:
    - Renders loading state on mount (GET in flight)
    - Renders consent text after successful GET; sign button initially disabled
    - After IntersectionObserver fires (mock it in tests): sign button becomes enabled
    - Clicking enabled sign button → POST called with correct `document_version`; `onConsented` called on success
    - GET failure → error message shown + retry button; retry re-triggers fetch
    - POST failure → error message shown, sign button re-enabled
  - [x] Use `@testing-library/react` + `msw` for GET and POST endpoints (used `globalThis.fetch` mock — same pattern as OnboardingText.test.tsx — instead of pulling in msw)
  - [x] Mock `IntersectionObserver` in test setup: `global.IntersectionObserver = vi.fn(...)` → call callback immediately with `isIntersecting: true` so scroll-gate doesn't block sign-button tests (used a constructable class stub since `vi.fn()` is not callable with `new`)

### Review Findings

_Code review on 2026-04-27 (parallel adversarial reviewers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision-needed, 8 patch, 10 deferred, 7 dismissed as noise._

**All 10 acceptance criteria are implemented and satisfied per the Acceptance Auditor.** Findings below are correctness issues, edge cases, and scope concerns surfaced beyond the AC table.

#### Decision needed

- [x] [Review][Decision] **Markdown disclosure rendering** — Resolved 2026-04-27: chose option (a) install `react-markdown@^9` and render the declaration with component-level styling (no `prose` plugin to avoid second dep). Folded into patch P9.

#### Patch (resolved 2026-04-27)

- [x] [Review][Patch] **[HIGH] `consent-declarations/v1.md` not copied to `dist/` at build time — production startup crash** — Fixed: replaced the markdown asset with a TypeScript module `consent-declarations/v1.ts` exporting `CONSENT_DECLARATION_V1`. Service imports the string instead of `readFileSync`-ing a `.md` from `dist/`. No build-time copy step needed. (Sources: blind+edge.)
- [x] [Review][Patch] **[HIGH] `vpc_consents.signed_by_user_id ON DELETE CASCADE` violates immutability** — Fixed: changed FK to `ON DELETE RESTRICT`. Account-deletion flows (Story 7.5) must now anonymize `signed_by_user_id` to a sentinel or migrate to a successor primary parent before removing the user; comment in the migration explains the contract.
- [x] [Review][Patch] **[HIGH] Scroll-gate is bypassable for short content / tall viewport / IO-less browsers** — Fixed: IntersectionObserver now scopes `root: scrollContainerRef.current` with `threshold: 1.0`. Added two fallbacks: (1) when `scrollHeight <= clientHeight` (content fits) the gate resolves immediately; (2) when `IntersectionObserver` is undefined, a `scroll` listener measures `scrollTop + clientHeight >= scrollHeight - 8`.
- [x] [Review][Patch] **[HIGH] `vpc.consented` audit metadata omits `document_version`** — Fixed: `request.auditContext.metadata` now carries `{ mechanism, document_version }`. Test assertion updated to verify both fields.
- [x] [Review][Patch] **[MED] `isUniqueViolation` substring match is fragile** — Fixed: dropped the `e.message.includes(...)` fallback; helper is now `code === '23505'` only (Supabase/postgres-js surface it consistently). All 12 callers across onboarding, threads, voice, and compliance retain correct behavior (verified by full API test suite).
- [x] [Review][Patch] **[MED] `ComplianceService.submitVpcConsent` ignores `requestId` parameter** — Fixed: `request_id: input.requestId` is now included in the `vpc.consented` info log payload.
- [x] [Review][Patch] **[MED] Service constructor crashes on missing/empty `v1.md`** — Fixed: declaration is now imported as a TypeScript string (P1), so file-system absence is impossible. Empty-content guard remains: constructor throws `Error('consent declaration v1 is empty')` if the inlined string is zero-length after trim.
- [x] [Review][Patch] **[LOW] Test mock `findConsent` ignores `.eq()` filters** — Fixed: mock now captures all `.eq(column, value)` calls into a `filters` object and returns the seeded `existingConsent` only when `(household_id, mechanism, document_version)` all match. Regression-proof against future query-shape changes.
- [x] [Review][Patch] **[NEW: was Decision] Markdown disclosure rendered as raw text** — Fixed: added `react-markdown@^9` and rewrote the declaration container to use `<Markdown components={{...}}>` with component-level Tailwind classes for h1/h2/p/ul/li/strong/a (no Typography plugin needed). Added a regression test verifying that headings render as `<h1>`/`<h2>` and `**bold**` syntax does not appear in the DOM.

#### Deferred (pre-existing or out-of-scope for Story 2-8)

- [x] [Review][Defer] **[HIGH] Audit-emit failure leaves consent row recorded but no `vpc.consented` audit event** [`apps/api/src/middleware/audit.hook.ts`, `compliance.routes.ts:52-59`] — deferred, pre-existing fire-and-forget audit pattern across all routes; not introduced by 2-8. Tracked separately for Story 9.x compliance-trail hardening.
- [x] [Review][Defer] **[HIGH] R2-P5 orphan-resume synthetic greeting skipped** [`apps/api/src/modules/onboarding/onboarding.service.ts` `submitTextTurn`] — deferred, Story 2-7 carryover. The `if (history.length === 0) prepend(OPENING_GREETING)` guard does not fire when the previous attempt persisted an orphaned user turn, so on retry the agent sees `[user: ...]` with no opening assistant context — the very failure mode R2-P5 was meant to prevent. Open as a Story 2-7 follow-up patch (test for: orphan-resume turn 1).
- [x] [Review][Defer] **[MED] `MIN_TURNS_FOR_COMPLETION_CHECK` floor inconsistent between `submitTextTurn` and `finalizeTextOnboarding`** [`apps/api/src/agents/onboarding.agent.ts:75-80`, `onboarding.service.ts`] — deferred, Story 2-7 carryover. The synthetic greeting is in-memory only, so finalize sees `history.length === 5` while submit sees `=== 6` for the same conversation. Track for the next 2-7 round.
- [x] [Review][Defer] **[MED] `signed_by_user_id` not DB-confirmed against `households.primary_parent_user_id`** [`compliance.routes.ts:43-47`] — deferred, JWT-trust pattern is consistent across the API. For COPPA legal artifact a DB-confirmed signer would be ideal but is a project-wide auth-model change, not a 2-8 fix.
- [x] [Review][Defer] **[MED] `OnboardingConsent` retry can submit a stale-versioned POST mid-deploy** [`OnboardingConsent.tsx`, `compliance.service.ts`] — deferred. If a v1→v2 deploy lands while a user is reading, the client signs the version they read; the server has no `document_version === CURRENT_DECLARATION_VERSION` guard. Acceptable for beta single-version state; revisit when v2 is introduced (add server-side current-version check at that time).
- [x] [Review][Defer] **[MED] `findConsent` unique key on `(household, mechanism, document_version)` does not prevent multi-mechanism collision when `credit_card_vpc` ships** [`vpc_consents` migration, `compliance.repository.ts`] — deferred, Story 10.1 territory. Today only `soft_signed_declaration` is allowed (CHECK constraint), so this is not a current bug.
- [x] [Review][Defer] **[MED] `OnboardingVoice.onComplete` fires on `onDisconnect`, before the ElevenLabs post-call webhook resolves** [`apps/web/src/features/onboarding/OnboardingVoice.tsx:18-25`, `apps/api/src/modules/voice/voice.service.ts:191-205`] — deferred, voice webhook race is a known Story 2-6 concern (best-effort empty-summary pattern). 2-8 simply gates after disconnect; webhook-failure handling is a 2-6 hardening item.
- [x] [Review][Defer] **[MED] `declarationContent` cached for process lifetime — version smear across rolling deploys** [`compliance.service.ts:25, 30-35`] — deferred. Mitigated by version-pinning policy ("any text edit = bump `CURRENT_DECLARATION_VERSION`"); add this to the runbook before launch.
- [x] [Review][Defer] **[MED] Migration `20260505000000_threads_modality_and_unique_constraints.sql` shipped here is a Story 2-7 R2 fix** [`supabase/migrations/20260505000000...`, `2-7-text-equivalent-onboarding-path.md` R2-D1/R2-D2] — deferred, scope drift from 2-7 round-2. Story 2-7 was marked `done` while this required migration was unmerged. No fix here; flag for sprint retrospective (CI check: every story marked done should have its migrations in main).
- [x] [Review][Defer] **[MED] `householdHasCompletedOnboarding` accepts any closed thread with a summary turn but doesn't validate summary integrity** [`apps/api/src/modules/onboarding/onboarding.service.ts:404-414`] — deferred, Story 2-7 territory. Voice path's "best-effort empty summary" pattern can produce a summary turn with empty content; the gate would still mark the household done.

#### Dismissed (noise / per-spec)

- GET endpoint requires `primary_parent` (Edge Hunter HIGH) — per AC1 spec wording: "Given I am authenticated as primary_parent at the onboarding consent step…". Spec-aligned, not a bug.
- RLS SELECT policy lets any household member read consent rows (Blind HIGH) — per migration comment "Authenticated users may read their own household's consent record (e.g., audit view in Story 7.8)". Deliberate.
- `signed_at` vs audit `created_at` micro-clock-skew (Edge LOW) — operational tooling joins on `household_id`, not timestamps.
- `correlation_id = household_id` semantic overload (Edge LOW) — intentional per inline route comment for Story 9.6 dashboard joins.
- Service returns `mechanism: MECHANISM` instead of `row.mechanism` (Auditor LOW) — functionally identical (CHECK constraint pins mechanism); cosmetic.
- `KNOWN_CONSENT_VERSIONS` exported via wildcard `export * from './compliance.js'` (Auditor LOW) — exported, just not by named list. Spec intent satisfied.
- `ComplianceRepository extends BaseRepository` differs from spec snippet (Auditor LOW) — matches the project's repository pattern (`ThreadRepository`, `VoiceRepository`, etc.).

## Dev Notes

### `vpc.consented` audit — already exists, no migration needed

`vpc.consented` is in `AUDIT_EVENT_TYPES` (TypeScript) AND in the Postgres `audit_event_type` enum in migration `20260501110000_create_audit_event_type_enum.sql`. The `audit.types.test.ts` parity test will fail if TypeScript has a value without a matching Postgres migration. Do not touch either file.

### `request.auditContext` audit pattern

The `audit.hook.ts` `onResponse` hook reads `request.auditContext` and fires `auditService.write()` after every response. Set `request.auditContext` in the POST handler after a successful `submitVpcConsent` call — same pattern as `auth.routes.ts`. The `AuditWriteInput` type accepts `household_id?: string` and `correlation_id?: string`; set both to `result.household_id`.

### ESM file reading — no `__dirname`

`apps/api` is ESM (`"type": "module"`). Use `import.meta.url` to locate the consent-declarations directory:
```typescript
const dir = fileURLToPath(new URL('./consent-declarations/', import.meta.url));
const content = readFileSync(`${dir}v1.md`, 'utf8');
```
Cache at service construction — this file doesn't change at runtime. Never re-read per request.

### `vpc_consents` immutability — belt-and-suspenders

The application guard (findConsent + ConflictError) runs before the INSERT. The `UNIQUE (household_id, mechanism, document_version)` constraint is a concurrency backstop. Under concurrent calls a DB `23505` error is theoretically possible — map it to `ConflictError` in the repository layer (check `error.code === '23505'` on the Supabase error, same pattern used in `thread.repository.ts` for `isUniqueViolation`).

### `OnboardingVoice` — navigation ownership

`OnboardingVoiceSession` currently calls `void navigate('/app')` in `onDisconnect`. After this story, the parent (`OnboardingPage`) owns navigation — the component just signals completion. When removing `useNavigate` from `OnboardingVoice`, confirm no other path inside that file still calls it.

The `onDisconnect` fires after voice session ends (both clean endings and network drops). This is the correct place to trigger the consent step — the post-call ElevenLabs webhook has already been dispatched server-side to persist the onboarding summary before disconnect fires client-side (webhook fires before the SDK closes the WS). The consent step will block navigation for a few seconds, which is fine.

### `OnboardingText` — backward-compatible prop

`OnboardingText` currently owns `useNavigate` internally for the finalize path only. Converting to `onFinalized?: () => void` prop with `navigate('/app')` as the fallback keeps existing `OnboardingText.test.tsx` tests green without change — they don't pass `onFinalized` and the fallback path covers the existing assertions.

### Scroll-gate for sign button

Use `IntersectionObserver` on a sentinel `<div>` at the bottom of the scrollable container:
```typescript
useEffect(() => {
  if (!sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
  const observer = new IntersectionObserver(
    ([entry]) => { if (entry?.isIntersecting) setHasScrolled(true); },
    { threshold: 0.9 },
  );
  observer.observe(sentinelRef.current);
  return () => observer.disconnect();
}, [declaration]); // re-run when declaration content loads
```
In test environments (`typeof IntersectionObserver === 'undefined'`), the button stays disabled unless the test mocks `IntersectionObserver`. Mock it in test setup to call the callback synchronously with `isIntersecting: true`.

### Consent declaration legal status

The `v1.md` placeholder must be replaced with legally-reviewed text before beta launch. The implementation is complete once the file exists with structural content. Track the legal review as a non-code dependency outside this story.

### `AuditWriteInput.household_id` field

Checking `audit.types.ts`: `AuditWriteInput` has `household_id?: string`. Set it in the `request.auditContext` assignment. This ensures the audit row carries household context for the ops compliance dashboard (Story 9.6).

### Project Structure Notes

**New files:**
- `supabase/migrations/20260508000000_create_vpc_consents.sql`
- `apps/api/src/modules/compliance/compliance.repository.ts`
- `apps/api/src/modules/compliance/compliance.service.ts`
- `apps/api/src/modules/compliance/compliance.routes.ts`
- `apps/api/src/modules/compliance/compliance.routes.test.ts`
- `apps/api/src/modules/compliance/consent-declarations/v1.md`
- `packages/contracts/src/compliance.ts`
- `packages/contracts/src/compliance.test.ts`
- `apps/web/src/features/onboarding/OnboardingConsent.tsx`
- `apps/web/src/features/onboarding/OnboardingConsent.test.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — re-export compliance schemas
- `packages/types/src/index.ts` — re-export inferred types (use `export type`)
- `apps/api/src/app.ts` — register `complianceRoutes` after `onboardingRoutes`
- `apps/web/src/routes/(app)/onboarding.tsx` — add `'consent'` mode + consent branch + callbacks
- `apps/web/src/features/onboarding/OnboardingVoice.tsx` — add `onComplete` prop, remove internal navigate
- `apps/web/src/features/onboarding/OnboardingText.tsx` — add `onFinalized` prop with navigate fallback

**Not touched:**
- `apps/api/src/audit/audit.types.ts` — `vpc.consented` already present
- `supabase/migrations/20260501110000_create_audit_event_type_enum.sql` — `vpc.consented` already present
- `apps/api/src/modules/onboarding/` — no changes to onboarding module internals

### Previous Story Learnings (from 2.7 + 2.6)

- **`.js` extensions on relative imports in `apps/api`** — required by TSC/tsx ESM resolution; every relative import in the new compliance module needs `.js`
- **`import type` for type-only imports** — `isolatedModules` is on; `export type` for re-exports in `packages/types`
- **`authorize(['primary_parent'])` preHandler** — from `apps/api/src/middleware/authorize.hook.ts`; used in `onboarding.routes.ts` as `authorize(['primary_parent'])` — copy that pattern exactly
- **`fp()` plugin with `name:`** — all route files use `fp(plugin, { name: 'xxx-routes' })`
- **Supabase chain mocks in tests** — look at `onboarding.routes.test.ts` for the exact Supabase mock chain pattern (`.from().select().eq().single()` etc.)
- **Do NOT mock `@hivekitchen/contracts`** — source-imported, deterministic
- **Selectors only on Zustand stores** — no full-store destructure
- **AbortController on hkFetch** — add one in `OnboardingConsent` for the GET on mount; cancel on unmount
- **No `console.*` in `apps/api`** — use `request.log` or injected `logger`
- **PII rule** — do NOT log consent text content; log `document_version`, `household_id`, action only

### References

- [Source: epics.md#Story-2.8] Acceptance criteria source
- [Source: _bmad-output/project-context.md] All implementation rules — read before implementing
- [Source: supabase/migrations/20260501110000_create_audit_event_type_enum.sql:36] `vpc.consented` already in Postgres enum
- [Source: apps/api/src/audit/audit.types.ts:32] `vpc.consented` already in TypeScript enum
- [Source: apps/api/src/audit/audit.types.test.ts] Enum parity test — will fail if TS/Postgres diverge
- [Source: apps/api/src/middleware/audit.hook.ts] `request.auditContext` onResponse hook
- [Source: apps/api/src/modules/auth/auth.routes.ts:36-44] `auditContext` fire-and-forget pattern (account.created) vs `request.auditContext` pattern — use `request.auditContext` for vpc.consented
- [Source: apps/api/src/modules/onboarding/onboarding.routes.ts:25] `authorize(['primary_parent'])` preHandler — copy this pattern
- [Source: apps/api/src/common/errors.ts] `ConflictError`, `ForbiddenError` — already defined, no new classes needed
- [Source: apps/api/src/modules/threads/thread.repository.ts] `isUniqueViolation` helper — reuse for 23505 mapping in compliance.repository.ts
- [Source: apps/web/src/features/onboarding/OnboardingVoice.tsx:20-28] `onDisconnect` → `navigate('/app')` — replace with `onComplete?.()` in this story
- [Source: apps/web/src/features/onboarding/OnboardingText.tsx:110] `void navigate('/app')` — replace with `onFinalized?.()` in this story
- [Source: apps/web/src/routes/(app)/onboarding.tsx] Mode state machine — add 'consent' variant
- [Source: _bmad-output/implementation-artifacts/2-7-text-equivalent-onboarding-path.md] Full previous story patterns — test structure, supabase mocks, module layout

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `vi.fn().mockImplementation((cb) => instance)` is **not constructable** under Vitest 4 — calling `new IntersectionObserver(...)` against a `vi.fn`-built mock throws `is not a constructor`. Replaced with a real `class ImmediateIntersectionObserver` stub in the test file. Worth remembering for future tests that mock constructable browser APIs.
- `apps/api` typecheck has a pre-existing failure in `src/plugins/stripe.plugin.ts:6` (`'2026-04-22.dahlia'` vs `'2024-06-20'`) inherited from commit `737be7b` (stripe 16→22 bump). Not introduced by this story; left untouched.

### Completion Notes List

- All 10 ACs satisfied. Backend module exposes both endpoints under `primary_parent` authorization with full coverage (happy path, 401, 403, 409, 400 missing/unknown version, audit context). Frontend introduces a scroll-gated consent step between onboarding completion and the `/app` shell, identical for voice and text paths.
- `vpc.consented` audit event was already declared in both `audit.types.ts` and migration `20260501110000` — no enum additions or migrations were necessary for the audit type, in keeping with the story's explicit instruction.
- Concurrency: application layer guards with `findConsent` first; the repository maps any `23505` from the `UNIQUE (household_id, mechanism, document_version)` constraint to a clean `409 ConflictError` so a concurrent double-POST cannot bypass the immutability invariant.
- The `v1.md` placeholder text is bracketed with `<!-- LEGAL REVIEW REQUIRED before beta launch — placeholder text only -->` per the story; the file is the source of truth for the `document_version` recorded on the `vpc_consents` row.
- `OnboardingText` keeps a `navigate('/app')` fallback when `onFinalized` is absent, preserving the existing 2.7 test suite without modification.
- Tests: api 112 passing (compliance contributes 9), web 45 passing (consent contributes 5), contracts 178 passing (compliance contributes 9). No regressions introduced.

### File List

**New files**
- `supabase/migrations/20260508000000_create_vpc_consents.sql`
- `apps/api/src/modules/compliance/compliance.repository.ts`
- `apps/api/src/modules/compliance/compliance.service.ts`
- `apps/api/src/modules/compliance/compliance.routes.ts`
- `apps/api/src/modules/compliance/compliance.routes.test.ts`
- `apps/api/src/modules/compliance/consent-declarations/v1.ts` (post-review: replaced `v1.md` to ship inside the compiled bundle without a build-time asset copy)
- `packages/contracts/src/compliance.ts`
- `packages/contracts/src/compliance.test.ts`
- `apps/web/src/features/onboarding/OnboardingConsent.tsx`
- `apps/web/src/features/onboarding/OnboardingConsent.test.tsx`

**Modified files**
- `packages/contracts/src/index.ts`
- `packages/types/src/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/threads/thread.repository.ts` (post-review: dropped the `.message`-substring fallback in `isUniqueViolation` — code-23505 only)
- `supabase/migrations/20260508000000_create_vpc_consents.sql` (post-review: `signed_by_user_id` FK changed to `ON DELETE RESTRICT`)
- `apps/web/src/routes/(app)/onboarding.tsx`
- `apps/web/src/features/onboarding/OnboardingVoice.tsx`
- `apps/web/src/features/onboarding/OnboardingText.tsx`
- `apps/web/package.json` (post-review: added `react-markdown@^9` dependency)

## Change Log

| Date       | Author | Summary |
|------------|--------|---------|
| 2026-04-27 | Menon (Claude Opus 4.7) | Story 2.8 implemented — `vpc_consents` table + immutable repository, ComplianceService with cached `v1.md` declaration, primary-parent-only `GET /v1/compliance/consent-declaration` and `POST /v1/compliance/vpc-consent` routes (with `vpc.consented` auditContext), and a scroll-gated `OnboardingConsent` step inserted between onboarding completion (voice or text) and `/app`. Added round-trip contract tests, Fastify `inject()` route tests, and component tests with a constructable `IntersectionObserver` stub. Status moved to `review`. |
| 2026-04-27 | Menon (Claude Opus 4.7) | Code review (Opus 4.7, parallel adversarial) — addressed 9 patches (4 HIGH, 4 MED, 1 LOW + 1 promoted-from-decision): inlined `consent-declarations/v1.ts` (replacing `v1.md`) to ship inside `dist/` without an asset-copy step; changed `vpc_consents.signed_by_user_id` FK to `ON DELETE RESTRICT` for true immutability; rewrote `OnboardingConsent` scroll-gate to scope IO to the container with short-content + IO-less fallbacks; added `document_version` to `vpc.consented` audit metadata; threaded `request_id` into the consent log; tightened `isUniqueViolation` to code-23505 only; tightened `findConsent` test mock to honor `.eq()` filters; replaced `<pre>` markdown with `react-markdown` + Tailwind component styling. 10 deferred items (incl. R2-P5 onboarding-resume bug, audit fire-and-forget hardening, voice-webhook race) appended to `deferred-work.md`. All tests green: api 112, web 47 (+1 markdown-rendering regression test), contracts 178. Status moved to `done`. |
