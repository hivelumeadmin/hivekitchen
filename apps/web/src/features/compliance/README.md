# Compliance feature — parental notice link contract

Story 2.9 introduced the parental-notice primitive (`<ParentalNoticeDialog>`
gating add-child, `<ParentalNoticeView>` for reference reading from Account
&rsaquo; Privacy &amp; Data).

## Forward link contract

Story 2.9 AC requires the notice to be linkable "from every child-facing
surface and from Settings." The child-facing surfaces (`<LunchLinkPage>`,
`<HeartNoteComposer>`, `<FlavorPassport>`) do not yet exist as of 2.9 merge
time. Their consumer stories (Epic 4 — Lunch Link / Heart Note; Epic 5 —
Coordination; Epic 7 — Memory) MUST include a tertiary-affordance link to
the parental notice when they ship.

Contract:
- The link target is the same content rendered by `<ParentalNoticeView>`.
- For unauthenticated child-facing surfaces (Lunch Link), a future story
  (likely 4.x) must add a public, unauthenticated GET endpoint OR a public
  `/notice/parental` SPA route that hard-codes the same content. Story 2.9
  does NOT ship that public surface — `GET /v1/compliance/parental-notice`
  is `primary_parent`-only today.
- The link text follows UX-DR50 / UX-DR51: tertiary affordance, no all-caps,
  no marketing-speak. Suggested copy: "How HiveKitchen handles your data".

When you ship a child-scope or grandparent-scope route, add this link.
