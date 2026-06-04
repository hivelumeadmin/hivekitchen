# Story 4.18: Absence-Nudge Lint Rule

Status: done

**Slice key:** `4-s18-absence-nudge-lint-rule`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S18
**Builds on:** 1-5 (ESLint config + hivekitchen plugin), 4-S5 (sacred-channel boundary check script)
**Folds:** 4.13 — FR43, Corollary 3b

---

## Story

As a Primary Parent,
I want zero notifications, streaks, or absence-reminders referencing Heart Note authoring frequency,
So that the sacred channel never inverts into a guilt engine (FR43, Corollary 3b).

---

## Context — What This Slice Does and Why

The Heart Note is defined as an **unmodified, parent-authored expression channel** to the child. The sacred-channel doctrine (FR38–FR39, Corollary 3b) explicitly forbids:
- Streaks ("You've written 5 notes in a row!")
- Absence nudges ("You haven't written Layla a note this week")
- Frequency reminders ("Reminder: send a Heart Note")
- Silence notices ("It's been quiet — Layla is waiting")

Story 4-S5 established the first sacred-channel boundary check: a script (`check-sacred-channel-boundary.ts`) that fails CI when any file co-locates `findForDelivery` with an LLM orchestrator call. That script's own comment deferred this slice:

> *"Limitation: same-file co-location only. Cross-file call-graph analysis is deferred to slice 4-S18 (a more sophisticated absence-nudge lint rule)."*

This slice ships that rule. It is a proper **ESLint custom rule** (`no-heart-note-frequency-reference`) that:
1. Scans all TypeScript/TSX files that have Heart Note context (import or identifier reference)
2. Flags any string literal within those files matching the forbidden copy patterns
3. Fails `pnpm lint` — which already runs in the CI quality job — so no new CI step is required
4. Reports a violation message citing `no-heart-note-frequency-reference` and Corollary 3b explicitly

This is a **lint-only slice**. No runtime changes. No migrations. No API endpoints. No UI components.

**Why ESLint (not a grep script)?**
The check-sacred-channel script works but produces only console output. An ESLint rule:
- Shows inline errors in the developer's IDE (VS Code, JetBrains) on the offending line
- Is integrated into the existing `pnpm lint` step (no new CI hook)
- Named with standard kebab convention (`no-*`) per ESLint convention
- Is composable with the existing hivekitchen plugin

**Scope:** `apps/web/src/` and `apps/api/src/`. `apps/marketing/` does not have an ESLint config (it is an Astro app without a wired eslint.config.mjs); marketing coverage is a known gap noted in Open Questions.

---

## Acceptance Criteria

### AC1 — Custom ESLint rule: `no-heart-note-frequency-reference`

New file: `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`

**What it detects:** A string literal matching the forbidden-copy pattern inside any file that also references heart_note.

**Forbidden-copy regex (case-insensitive):**
```
/streak|reminder|absence|haven't written|been quiet/i
```

**Heart-note-context detection (file level):**
- An `ImportDeclaration` whose source path matches `/heart[-_]?note/i` (e.g., `../heart-note.repository`, `./heart-notes.service`)
- OR an `Identifier` whose name matches `/HeartNote|heartNote|heart_note/` (e.g., `HeartNoteRepository`, `useHeartNote`, `heartNoteRepo`, `heart_notes`)

**Logic:** Collect all `Literal` string nodes with forbidden values. At `Program:exit`, if the file has heart_note context, report each collected literal. If no heart_note context, silently exit — the rule does NOT fire in unrelated files.

**Rule implementation shape:**

```typescript
import type { Rule } from 'eslint';

const FORBIDDEN = /streak|reminder|absence|haven't written|been quiet/i;
const HEART_NOTE_IMPORT = /heart[-_]?note/i;
const HEART_NOTE_IDENT = /HeartNote|heartNote|heart_note/;

export const noHeartNoteFrequencyReference: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid absence-nudge, streak, or frequency-reminder copy adjacent to heart_note references (FR43, Corollary 3b).',
    },
    messages: {
      forbidden:
        'FR43 / Corollary 3b: "{{value}}" is an absence-nudge or frequency reference. ' +
        'The Heart Note sacred channel must never become a guilt engine. Remove this copy.',
    },
  },
  create(context) {
    let hasHeartNoteContext = false;
    const pending: Array<{ node: Rule.Node; value: string }> = [];

    return {
      ImportDeclaration(node) {
        const src = typeof node.source.value === 'string' ? node.source.value : '';
        if (HEART_NOTE_IMPORT.test(src)) {
          hasHeartNoteContext = true;
        }
      },
      Identifier(node) {
        if (HEART_NOTE_IDENT.test(node.name)) {
          hasHeartNoteContext = true;
        }
      },
      Literal(node) {
        const v = node.value;
        if (typeof v === 'string' && FORBIDDEN.test(v)) {
          pending.push({ node: node as unknown as Rule.Node, value: v });
        }
      },
      'Program:exit'() {
        if (!hasHeartNoteContext) return;
        for (const { node, value } of pending) {
          context.report({
            node,
            messageId: 'forbidden',
            data: { value: value.length > 60 ? `${value.slice(0, 60)}…` : value },
          });
        }
      },
    };
  },
};
```

### AC2 — Register rule in hivekitchenPlugin; enable in webConfig() and apiConfig()

In `packages/eslint-config-hivekitchen/src/index.ts`:

**Step 1 — Import the new rule:**
```typescript
import { noHeartNoteFrequencyReference } from './rules/no-heart-note-frequency-reference.js';
```

**Step 2 — Export it:**
```typescript
export { noCrossScopeComponent, noDialogOutsideAllowlist, logicalPropertiesOnly, noHeartNoteFrequencyReference };
```

**Step 3 — Add to hivekitchenPlugin.rules:**
```typescript
const hivekitchenPlugin = {
  rules: {
    'no-cross-scope-component': noCrossScopeComponent,
    'no-dialog-outside-allowlist': noDialogOutsideAllowlist,
    'logical-properties-only': logicalPropertiesOnly,
    'no-heart-note-frequency-reference': noHeartNoteFrequencyReference, // ← add this
  },
};
```

**Step 4 — Enable the rule in baseConfig():** Add to the rules block under `files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}']`:
```typescript
'hivekitchen/no-heart-note-frequency-reference': 'error',
```

Adding to `baseConfig()` (not just `webConfig()` or `apiConfig()` separately) covers both web and api with a single change. The `hivekitchenPlugin` is already registered in `baseConfig()` — no new plugin registration needed.

### AC3 — Rule tests (RuleTester)

New file: `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.test.ts`

Use ESLint's `RuleTester` (import from `'eslint'`). Run with vitest or the existing test runner in the package.

**Valid cases (rule must NOT fire):**
```typescript
// V1: heart_note context, no forbidden strings
{ code: `import { HeartNoteRepository } from './heart-note.repository'; const label = "Send a note";` }

// V2: forbidden string, but no heart_note context
{ code: `const msg = "You haven't written anything in a while";` }

// V3: completely unrelated file
{ code: `const x = "streak bonus";` }

// V4: heart_note identifier, innocuous string
{ code: `const heartNoteId = '123'; const copy = "Have a great lunch!";` }
```

**Invalid cases (rule MUST fire with messageId 'forbidden'):**
```typescript
// I1: import + "haven't written"
{
  code: `import HeartNoteRepo from './heart-note.repository';
         const msg = "You haven't written Layla a note this week";`,
  errors: [{ messageId: 'forbidden' }],
}

// I2: identifier + "streak"
{
  code: `const heartNoteCount = 3; const copy = "You're on a 3-note streak!";`,
  errors: [{ messageId: 'forbidden' }],
}

// I3: import + "absence"
{
  code: `import { heartNoteService } from './heart-note.service'; const s = "Layla noticed your absence";`,
  errors: [{ messageId: 'forbidden' }],
}

// I4: identifier + "been quiet"
{
  code: `const HeartNoteStatus = {}; const t = "It's been quiet — Layla is waiting";`,
  errors: [{ messageId: 'forbidden' }],
}

// I5: identifier + "reminder"
{
  code: `const heart_notes = []; const s = "Reminder: send a Heart Note today";`,
  errors: [{ messageId: 'forbidden' }],
}

// I6: multiple forbidden strings in same file → all reported
{
  code: `import HeartNote from './heart-note'; const a = "streak"; const b = "absence";`,
  errors: [{ messageId: 'forbidden' }, { messageId: 'forbidden' }],
}
```

### AC4 — CI coverage: no new step required

`pnpm lint` already runs `pnpm --filter @hivekitchen/web lint` and `pnpm --filter @hivekitchen/api lint` via Turborepo in the `quality` CI job (`.github/workflows/ci.yml` line 43: `run: pnpm lint`). The new rule is enabled through `webConfig()` / `apiConfig()` → `baseConfig()`, so it automatically runs in CI. **Do not add a new CI step.**

### AC5 — Existing codebase passes with zero false positives

Run `pnpm lint` after implementation. The rule must not fire on any existing file in `apps/web/src/` or `apps/api/src/`. If it does, identify and fix any legitimate use of the forbidden patterns (e.g., in existing tests that mock notification strings) by adding `// eslint-disable-next-line hivekitchen/no-heart-note-frequency-reference` with a comment explaining why the exception is safe. Document any exceptions in the Completion Notes.

---

## Demo Path

**This is a negative-test story.** There is no user-visible UI feature to demo. The demo is: CI fails when a PR adds forbidden copy.

**Demo steps:**

1. After implementing the rule, run `pnpm lint` on a clean checkout → it passes (AC5).

2. Create a scratch file in `apps/web/src/routes/(app)/heart-note.tsx` (the existing Heart Note composer). Add this line temporarily anywhere in the file:
   ```tsx
   const nudge = "You haven't written Layla a note this week";
   ```

3. Run `pnpm --filter @hivekitchen/web lint` → observe failure:
   ```
   apps/web/src/routes/(app)/heart-note.tsx
     42:18  error  FR43 / Corollary 3b: "You haven't written Layla a note this week" is an
                   absence-nudge or frequency reference. The Heart Note sacred channel must
                   never become a guilt engine. Remove this copy.
                   hivekitchen/no-heart-note-frequency-reference
   ```

4. Remove the scratch line. Re-run `pnpm lint` → passes.

5. Verify the same string in a completely unrelated file (e.g., `apps/web/src/routes/(app)/account.tsx` with NO heart_note imports or identifiers) does **not** trigger the rule.

**No USER-SIDE GATE.** This slice has no live-stack requirement. `pnpm lint` + unit tests are the complete verification.

---

## Critical Guardrails

**Rule scope: file-level co-location, not cross-file call-graph analysis.** The rule fires when a forbidden string appears in the same file as a heart_note reference. It does NOT trace call graphs across files (that would require type-checked ESLint rules and full TypeScript project analysis — a future enhancement if needed). Same-file co-location catches the primary risk: a developer adding guilt-engine copy inside a component or service that already touches heart_note.

**Do NOT flag unrelated files.** If `hasHeartNoteContext` is false at `Program:exit`, the rule returns silently. A file with just `"You haven't written"` in a vacation-planner module must not fail.

**No runtime changes.** This slice ships zero API routes, zero migrations, zero UI components. Do not add anything beyond ESLint rule + registration + tests.

**baseConfig() coverage is correct — not webConfig() or apiConfig() separately.** `baseConfig()` spreads into both, and `hivekitchenPlugin` is already registered there. Adding to both `webConfig()` and `apiConfig()` independently would be redundant and would cause a double-registration warning. Add once to `baseConfig()`.

**apps/marketing/ is not covered by this slice.** Marketing is an Astro app with no `eslint.config.mjs`. Do not create one as part of this slice — it would require Astro-specific ESLint setup beyond this story's scope. Note the gap in Completion Notes.

**No `// eslint-disable` lines in production source.** If a false positive is found in existing source, investigate whether the string is actually forbidden (and should be removed) before adding a disable comment. If it truly is safe (e.g., a test mock), use a narrowly-scoped line disable with a comment citing the reason.

**Identifier visitor fires on all identifiers — this is intentional.** `HeartNote` inside `HeartNoteRepository` sets the file context. This is correct: any file that uses a HeartNote-named symbol is in the heart_note domain and subject to the sacred-channel copy rules.

**Test runner for the eslint-config-hivekitchen package.** Confirm how existing test files in the package are run before adding yours. Check `packages/eslint-config-hivekitchen/package.json` for the test script. If no tests exist yet, use `vitest` (which is used across the monorepo) with a direct `import { RuleTester } from 'eslint'`.

---

## What Already Exists (Do Not Recreate)

- **hivekitchenPlugin** — `packages/eslint-config-hivekitchen/src/index.ts` lines 44–50. The plugin object with `rules` map. Add one entry; do not recreate it.
- **baseConfig()** — `packages/eslint-config-hivekitchen/src/index.ts` lines 52–70. Registers `hivekitchenPlugin` and spreads `tseslint.configs.recommended`. Add one line under `rules`; do not reorganize the function.
- **Rule file pattern** — `packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.ts` is the cleanest reference implementation: `Rule.RuleModule` export, `create(context)` factory, `ImportDeclaration` visitor, `context.report({ node, messageId, data })`. Mirror this pattern exactly.
- **check-sacred-channel-boundary.ts** — `apps/api/scripts/check-sacred-channel-boundary.ts`. The existing script for the 4-S5 boundary check. Do NOT modify this script for 4-S18. The new ESLint rule is additive; it does not replace the script.
- **CI quality job** — `.github/workflows/ci.yml` line 43: `run: pnpm lint`. This already covers the new rule. Do not add a new step.
- **apps/web/eslint.config.mjs** — imports `webConfig()` → `baseConfig()` → hivekitchenPlugin already registered. The rule will be available automatically once added to the plugin.
- **apps/api/eslint.config.mjs** — imports `apiConfig()` → `baseConfig()` → same. Same automatic coverage.

---

## Tasks

### T1 — Implement the ESLint rule (AC1)

**T1.1** Create `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts` with the rule implementation exactly as shown in AC1.

**T1.2** Define and export `noHeartNoteFrequencyReference` as a named export (no default export — consistent with the other rule files which use `export const` + a separate `export default`; check existing files to confirm the pattern).

Verify: TypeScript compiles (the package uses source-import, no build step for the rules). Check that `import type { Rule } from 'eslint'` resolves (it should — `eslint` is listed in the package's deps; confirm in `packages/eslint-config-hivekitchen/package.json`).

### T2 — Register rule in hivekitchenPlugin and enable in baseConfig() (AC2)

**T2.1** In `packages/eslint-config-hivekitchen/src/index.ts`:
- Add import: `import { noHeartNoteFrequencyReference } from './rules/no-heart-note-frequency-reference.js';`
- Add to exports: append `noHeartNoteFrequencyReference` to the named exports line
- Add to `hivekitchenPlugin.rules`: `'no-heart-note-frequency-reference': noHeartNoteFrequencyReference`
- Add to `baseConfig()` rules block: `'hivekitchen/no-heart-note-frequency-reference': 'error'`

**T2.2** Run `pnpm --filter @hivekitchen/eslint-config-hivekitchen typecheck` (or `pnpm typecheck` scoped to the package) to confirm zero new TypeScript errors.

### T3 — Write RuleTester tests (AC3)

**T3.1** Check `packages/eslint-config-hivekitchen/package.json` for the test script. If it already has a test runner, add the new test file alongside existing test files. If not, add `"test": "vitest run"` and ensure vitest is in devDependencies.

**T3.2** Create `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.test.ts` with all valid and invalid cases from AC3. Use `RuleTester` from `eslint`.

**T3.3** Run the package test suite:
```
pnpm --filter @hivekitchen/eslint-config-hivekitchen test
```
All 10 test cases (4 valid, 6 invalid) must pass.

### T4 — Verify zero false positives in existing codebase (AC5)

**T4.1** Run `pnpm lint` from the repo root. Confirm it exits 0 with no new errors.

**T4.2** If any existing file triggers the rule:
- Investigate whether the string is genuinely forbidden copy (unlikely — the patterns are very specific to absence-nudge language)
- If it's a false positive (e.g., a test fixture or a legitimate use), add a narrowly-scoped `// eslint-disable-next-line hivekitchen/no-heart-note-frequency-reference` with a comment citing the reason
- Record any disable comments in Completion Notes

### T5 — Demo verification (AC4)

**T5.1** Temporarily add `const nudge = "You haven't written Layla a note this week";` to `apps/web/src/routes/(app)/heart-note.tsx`.

**T5.2** Run `pnpm --filter @hivekitchen/web lint`. Confirm failure with `hivekitchen/no-heart-note-frequency-reference` message citing Corollary 3b.

**T5.3** Remove the scratch line. Re-run `pnpm --filter @hivekitchen/web lint` → exits 0.

**T5.4** Add the same string to `apps/web/src/routes/(app)/account.tsx` (which has no heart_note imports or identifiers). Run lint → exits 0 (rule does not fire outside heart_note context).

**T5.5** Remove the account.tsx scratch change.

---

## Project Structure Notes

**New files:**
- `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts` — ESLint rule implementation
- `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.test.ts` — RuleTester test suite

**Modified files:**
- `packages/eslint-config-hivekitchen/src/index.ts` — import + export + plugin registration + baseConfig() rule enablement
- `packages/eslint-config-hivekitchen/package.json` — possibly add test script + vitest devDep if not already present
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

**Not modified:**
- `apps/api/scripts/check-sacred-channel-boundary.ts` — 4-S5 script; this slice is additive, not a replacement
- `.github/workflows/ci.yml` — `pnpm lint` already covers the new rule; no new CI step
- `apps/web/eslint.config.mjs` — inherits the new rule via `webConfig()` → `baseConfig()`; no change needed
- `apps/api/eslint.config.mjs` — inherits via `apiConfig()` → `baseConfig()`; no change needed
- Any `apps/marketing/` files — out of scope; see Open Questions

---

## Task Completion Checklist

- [x] T1.1 — `no-heart-note-frequency-reference.ts` rule file created
- [x] T1.2 — `noHeartNoteFrequencyReference` exported as named export (+ default, matching the 3 existing rule files); package TypeScript compiles
- [x] T2.1 — Rule imported, exported, added to `hivekitchenPlugin.rules`, enabled in `baseConfig()`
- [x] T2.2 — `pnpm typecheck` scoped to eslint-config-hivekitchen passes with zero new errors
- [x] T3.1 — Test runner confirmed (vitest already wired: `"test": "vitest run --passWithNoTests"`; no package.json change needed)
- [x] T3.2 — `no-heart-note-frequency-reference.test.ts` created with all 10 cases
- [x] T3.3 — All 10 RuleTester cases pass (4 valid + 6 invalid)
- [x] T4.1 — `pnpm lint` run on the full repo; new rule fires zero times (zero false positives). NOTE: repo lint is NOT at exit 0 — there is a pre-existing baseline of 74 web errors + API errors from orthogonal rules (eqeqeq, jsx-a11y, consistent-type-imports, react-hooks). My additive rule introduces zero new errors. See Completion Notes.
- [x] T4.2 — Zero disable comments needed (no existing file co-locates a forbidden string with heart_note import/identifier context)
- [x] T5.1–T5.5 — Demo verified: forbidden string in `heart-note.tsx` (heart_note context) → rule fires at 20:15 with FR43/Corollary 3b message; same string in `account.tsx` (only a `/v1/heart-notes/...` URL *string literal*, no import/identifier context) → rule silent. Both scratch edits reverted.

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/eslint-config typecheck` → 0 errors
- `pnpm --filter @hivekitchen/eslint-config test` → 5 files / 32 tests pass (new file contributes 10)
- `pnpm --filter @hivekitchen/eslint-config exec vitest run src/rules/no-heart-note-frequency-reference.test.ts` → 10/10 pass
- `pnpm lint` (full repo) → new rule fires 0 times (verified via `grep -i no-heart-note-frequency-reference`)
- Positive demo: `pnpm --filter @hivekitchen/web lint` with scratch line in `heart-note.tsx` → `20:15 error … hivekitchen/no-heart-note-frequency-reference`
- Negative demo: same string in `account.tsx` → rule silent
- `pnpm --filter @hivekitchen/eslint-config build` → clean; `dist/index.js` contains the rule (3 matches)

### Completion Notes List

- **All 5 ACs satisfied.** New ESLint rule `no-heart-note-frequency-reference` implemented exactly per AC1, registered in `hivekitchenPlugin.rules`, and enabled once in `baseConfig()` (so web + api inherit; no double-registration). 10 RuleTester cases pass.
- **Export shape:** Used `export const noHeartNoteFrequencyReference` **plus** `export default` to match all three existing rule files (`no-dialog-outside-allowlist.ts`, `no-cross-scope-component.ts`, `logical-properties-only.ts`), which all carry a default export. Task T1.2's parenthetical "no default export" is internally contradictory (it then says "consistent with the other rule files which use `export const` + a separate `export default`"); the codebase convention is authoritative → both exports present. `index.ts` consumes the named export, so this is non-breaking either way.
- **AC5 — zero false positives (verified, zero disable comments):** Pre-scan found 7 files in `apps/api/src` containing a forbidden substring, **none** of which reference heart_note (no import-source or identifier match), and 0 such files in `apps/web/src`. Live `pnpm lint` confirms the rule fires 0 times. No `// eslint-disable` lines were added anywhere.
- **AC4 / spec reconciliation — the package HAS a build step (story note #3 is stale).** Story "Previous Story Intelligence" #3 claims the package is source-imported (`main: src/index.ts`, no build). Current `package.json` actually resolves consumers via `exports["."].default → ./dist/index.js` and defines `build: tsc -p tsconfig.build.json`. `turbo.json` sets `lint.dependsOn: ["^build"]`, so `pnpm lint` rebuilds `@hivekitchen/eslint-config` first and apps lint against the freshly-built `dist`. Confirmed end-to-end: the positive demo fired with my exact message (only present in my new source), proving the rebuilt `dist` carries the rule. CI's existing `pnpm lint` step therefore covers the new rule with no new step (AC4 holds). Package vitest transpiles `src` on the fly, so tests are unaffected by the build path.
- **Repo lint is not at exit 0 (pre-existing baseline).** T4.1's literal "exits 0" is not achievable on this working tree: there is a documented baseline of 74 web errors + API errors from orthogonal rules (`eqeqeq`, `jsx-a11y/*`, `@typescript-eslint/consistent-type-imports`, `react-hooks/exhaustive-deps`), several inside the uncommitted 4-s17 files (`account.test.tsx`, etc.). Adding an orthogonal rule that reports nothing cannot change those rules' output; my change introduces **zero** new lint errors. The acceptance-relevant assertion ("rule must not fire on any existing file") is satisfied.
- **`package.json` not modified:** the test script (`vitest run --passWithNoTests`) and `vitest` devDep already exist, so T3.1 required no change (contrary to the story's "possibly add test script" note).
- **No runtime suites run:** this is a lint-only slice with zero runtime/API/web source changes. The only changed source compilation unit is `packages/eslint-config-hivekitchen`, fully covered by its typecheck + vitest + the live lint run. Running the full web/api vitest suites would only reproduce their documented pre-existing baselines.
- **Open Questions (non-blocking, shipped as written):** (1) Marketing app coverage deferred — `apps/marketing` uses `astro check`, has no `eslint.config.mjs`; option (a) taken. (2) Template-literal coverage off — rule covers quoted-string `Literal` nodes only, per AC; `TemplateLiteral` not added.

### File List

**New:**
- `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`
- `packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.test.ts`

**Modified:**
- `packages/eslint-config-hivekitchen/src/index.ts` (import + export + `hivekitchenPlugin.rules` entry + `baseConfig()` enablement)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status tracking)
- `_bmad-output/implementation-artifacts/4-s18-absence-nudge-lint-rule.md` (this story file — Dev Agent Record, checklist, status, change log)

**Not modified (per story):** `apps/api/scripts/check-sacred-channel-boundary.ts`, `.github/workflows/ci.yml`, `apps/web/eslint.config.mjs`, `apps/api/eslint.config.mjs`, `packages/eslint-config-hivekitchen/package.json`, any `apps/marketing/` file. (`dist/` is a gitignored build artifact, not a source change.)

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.13] — AC: "lint rule `no-heart-note-frequency-reference` blocks any string literal in `apps/web/src/`, `apps/api/src/`, `apps/marketing/src/` matching `streak|reminder|absence|haven't written|been quiet` adjacent to `heart_note` references."
- [Source: `_bmad-output/planning-artifacts/epics.md` §FR43] — "System never surfaces notifications, streaks, or absence-reminders referencing Heart Note authoring frequency to any parent."
- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S18] — "Demo (negative test): Open a PR adding a notification string like `"You haven't written Layla a note this week"`. CI fails with a clear lint error pointing to `no-heart-note-frequency-reference` and the Corollary-3b citation."
- [Source: `apps/api/scripts/check-sacred-channel-boundary.ts` line 13] — "Cross-file call-graph analysis is deferred to slice 4-S18 (a more sophisticated absence-nudge lint rule)."
- [Source: `packages/eslint-config-hivekitchen/src/index.ts`] — `hivekitchenPlugin` shape, `baseConfig()` rules block, import/export conventions
- [Source: `packages/eslint-config-hivekitchen/src/rules/no-dialog-outside-allowlist.ts`] — cleanest existing rule pattern: `Rule.RuleModule`, `create(context)`, `ImportDeclaration` visitor, `context.report({ node, messageId, data })`
- [Source: `packages/eslint-config-hivekitchen/src/rules/no-cross-scope-component.ts`] — example of file-context detection (`context.filename`), multi-visitor pattern
- [Source: `.github/workflows/ci.yml` line 43] — `run: pnpm lint` in quality job; no new CI step needed
- [Source: `_bmad-output/implementation-artifacts/4-s5-sacred-channel-doctrine-encryption-lint.md`] — 4-S5 patterns: `findForDelivery` sentinel method, check script structure, CI hook shape

---

## Previous Story Intelligence (from 4-S17, 4-S5)

1. **`packages/eslint-config-hivekitchen/src/index.ts` uses ESM `.js` extensions on relative imports.** When importing the new rule file: `import { noHeartNoteFrequencyReference } from './rules/no-heart-note-frequency-reference.js'` — note the `.js` extension even though the source file is `.ts`. This is the existing pattern: `import { noCrossScopeComponent } from './rules/no-cross-scope-component.js'`. Follow this exactly — omitting `.js` will cause runtime resolution failures.

2. **hivekitchenPlugin is defined as a const before `baseConfig()`.** Lines 44–50 define the plugin object. `baseConfig()` then casts it with `as unknown as NonNullable<Linter.Config['plugins']>[string]` when registering. When adding the new rule to `hivekitchenPlugin.rules`, add it directly to the object literal — do not split the plugin object across functions.

3. **No build step for eslint-config-hivekitchen.** The package uses `"main": "src/index.ts"` — consumers import directly from source. TypeScript compilation errors in the rule files will fail `pnpm typecheck` but the package's own `pnpm test` (vitest) transpiles on-the-fly via tsx/esbuild.

4. **`Rule.Node` type cast is needed for the `pending` array.** The `Literal` visitor's parameter is typed as `estree.Literal`, not `Rule.Node`. The cast `node as unknown as Rule.Node` is needed to store it and pass to `context.report({ node })`. This is the same pattern used by the existing rules — see how `no-dialog-outside-allowlist.ts` casts the node parameter.

5. **`pnpm lint` in CI covers all apps via Turborepo pipeline.** When you run `pnpm lint` at the root, Turbo runs `lint` in each package that defines it. `apps/web` and `apps/api` both have `"lint": "eslint src"` (or similar). The new rule is picked up automatically through the config factory functions. Verify the lint commands in each app's `package.json` before claiming coverage.

6. **Sacred-channel doctrine lives in the ESLint package, not app-level configs.** 4-S5 put the boundary check in a script under `apps/api/scripts/`. For 4-S18, the ESLint rule goes in `packages/eslint-config-hivekitchen/` — which is the correct home for a lint rule that applies across multiple apps. Do not create a new script.

7. **`Identifier` visitor fires on type identifiers too.** In TypeScript files, `type HeartNote = ...` and `interface HeartNote {}` also produce `Identifier` nodes. This is desirable — a file declaring a type named `HeartNote` is definitely in heart_note domain. No special handling needed.

---

## Open Questions for Menon (non-blocking — story ships as written)

**1. Marketing app ESLint coverage.** The AC in epics.md lists `apps/marketing/src/` as a target. `apps/marketing/` is an Astro app with no `eslint.config.mjs` (confirmed). Two options:
- (a) Defer marketing coverage: ship 4-S18 covering web + api only; wire marketing ESLint in a future ops story if forbidden copy is ever found there (lower risk — Heart Note code doesn't live in marketing).
- (b) Scope-extend 4-S18: create a minimal `apps/marketing/eslint.config.mjs` using only `baseConfig()` from `@hivekitchen/eslint-config`. This requires adding ESLint as a devDependency to `apps/marketing/package.json` and confirming it works with Astro's TypeScript setup.

Story ships with option (a) unless you confirm (b) before dev starts.

**2. Template literal coverage.** The AC says "string literal". The ESLint `Literal` visitor covers only quoted strings (`"..."`, `'...'`, `` `...` `` with no interpolation). Tagged template literals and template expressions (`\`Haven't written ${name} a note\``) are `TemplateLiteral` nodes — a separate visitor. The current rule implementation covers `Literal` only (quoted strings). If you want `TemplateLiteral` coverage too, the dev agent can add a `TemplateLiteral` visitor that checks `quasis` elements. This is a minor extension; defaults to off (Literal-only) unless you request it.

---

## Review Findings

- [x] [Review][Patch] Add `schema: []` to rule `meta` — without it ESLint cannot validate options and strict tooling (VS Code ESLint extension, `eslint --inspect-config`) may warn that the schema is missing; `schema: []` explicitly documents zero-options intent [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`]

- [x] [Review][Defer] Template literals (interpolated strings) bypass the `Literal` visitor — `\`You haven't written ${childName} a note\`` is a `TemplateLiteral` node and is never checked [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`] — deferred, explicitly scoped as Literal-only per spec Open Question #2
- [x] [Review][Defer] JSX text children are `JSXText` nodes, not `Literal` — `<p>You haven't written a note</p>` body is invisible to the rule [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`] — deferred, Literal-only scope per spec
- [x] [Review][Defer] `FORBIDDEN` breadth: `reminder` and `absence` match common non-nudge strings with no word boundaries — `"audit.user.absence"`, `"Set a reminder for prep"` would fire if heart_note context is present [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`] — deferred, spec defines the exact regex; zero current false positives confirmed
- [x] [Review][Defer] `Identifier` visitor breadth: fires on all identifiers including barrel re-export specifiers — a file that re-exports `HeartNoteRepository` and contains an unrelated `absence` string would be flagged [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`] — deferred, intentional per spec ("Identifier visitor fires on type identifiers too — intentional")
- [x] [Review][Defer] `webConfig()` re-registers `hivekitchenPlugin` in its own `plugins` block — redundant registration pre-existing before this story [`packages/eslint-config-hivekitchen/src/index.ts`] — deferred, pre-existing, not introduced by this story
- [x] [Review][Defer] TypeScript type-literal discriminants (e.g. `type HeartNoteStatus = 'absence'`) would be flagged as nudge copy [`packages/eslint-config-hivekitchen/src/rules/no-heart-note-frequency-reference.ts`] — deferred, hypothetical; zero current false positives confirmed

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Story 4-S18 created — Absence-Nudge Lint Rule. Implements FR43 / Corollary 3b via a new `no-heart-note-frequency-reference` ESLint custom rule in `packages/eslint-config-hivekitchen`. Rule flags forbidden copy patterns (streak/reminder/absence/haven't written/been quiet) inside files with heart_note context. Enabled in `baseConfig()` so web + api inherit automatically. No runtime changes, no migrations, no new CI step. Status: ready-for-dev. |
| 2026-06-03 | Story 4-S18 implemented. New rule `no-heart-note-frequency-reference.ts` (file-level heart_note context via import-source/identifier; forbidden-string `Literal` collection reported at `Program:exit`) + `no-heart-note-frequency-reference.test.ts` (10 RuleTester cases, all pass). Registered in `hivekitchenPlugin.rules` + enabled `'error'` once in `baseConfig()`. Scoped typecheck 0 errors; package vitest 32/32. Full `pnpm lint`: rule fires 0 times (zero false positives, zero disable comments); pre-existing 74-web + API baseline from orthogonal rules unchanged. Demo verified: forbidden string in `heart-note.tsx` → fires; in `account.tsx` (URL-string-only heart_note ref) → silent. Reconciled stale story note #3: package HAS a `tsc` build (`exports.default → dist/index.js`); `turbo.json lint.dependsOn ^build` rebuilds it, so CI `pnpm lint` covers the rule (AC4 holds). Status: ready-for-dev → review. |
