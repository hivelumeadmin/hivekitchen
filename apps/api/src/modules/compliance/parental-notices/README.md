# Parental Notice — Versioning Policy

This directory holds versioned parental-notice documents. Each version is an
immutable text snapshot — once a household has acknowledged version `vN`, the
file at `vN.ts` MUST NOT be edited in place. To change the notice, ship a new
`vN+1.ts` and bump `CURRENT_PARENTAL_NOTICE_VERSION` in
`apps/api/src/modules/compliance/compliance.service.ts`.

When a new version ships:

1. Add `vN+1.ts` exporting `PARENTAL_NOTICE_VN_PLUS_1_CONTENT` and the same
   `PROCESSORS` / `DATA_CATEGORIES` / `RETENTION` constants.
2. Bump `CURRENT_PARENTAL_NOTICE_VERSION` in `compliance.service.ts`.
3. Add the new value to `KNOWN_PARENTAL_NOTICE_VERSIONS` in
   `packages/contracts/src/compliance.ts`.
4. Decide whether existing acknowledged users must re-acknowledge — if yes,
   ship a migration that NULLs `users.parental_notice_acknowledged_version`
   (and optionally `users.parental_notice_acknowledged_at`) for affected
   users so the gating UI re-prompts them.

Same policy applies to `consent-declarations/`. See Story 2.8 review notes
for rationale (post-review patches eliminated `.md` asset shipping in favor
of inline TS strings to avoid `dist/` asset-copy fragility).
