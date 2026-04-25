## Summary

<!-- What changed and WHY (not what — the diff shows what). -->

## Type of Change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `refactor` — code refactoring, no behavior change
- [ ] `chore` — tooling, deps, infra, CI
- [ ] `docs` — documentation only

## Patterns Checklist

Non-mechanizable checks — tick every box that applies, leave unticked if genuinely N/A.

- [ ] **PII redaction** — No PII fields appear in logs, error payloads, or client-facing responses. Verified via log review.
- [ ] **Error type catalog** — Any new error type extends `apps/api/src/common/errors.ts` with a `type` URI (Problem+JSON) and is the only error thrown by the relevant service.
- [ ] **Audit event_type** — Any new audit category adds an `audit_event_type` Postgres enum migration **and** the matching entry in `apps/api/src/audit/audit.types.ts` TS enum mirror **in the same PR**.
- [ ] **Design system** — Any new `packages/ui` component, semantic token, or scope-allowlist entry is reflected in `specs/Design System.md`.
- [ ] **Scope allowlist** — Any new cross-scope import has a corresponding entry in `packages/eslint-config/scope-allowlist.config.ts`.
- [ ] **Tool manifest** — Any new agent tool declares `maxLatencyMs` in `apps/api/src/agents/tools.manifest.ts`. CI lint blocks PRs that omit this.
