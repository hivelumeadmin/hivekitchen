# Epic 11 — Vertical Slice Re-Decomposition

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 11: Marketing & Public Acquisition" — 6 horizontal stories (11.1 → 11.6). (Deferred to near public launch — September 2026 per epics.md.)

**Output:** 8 vertical slices. **Launch wall at 11-S5** (landing + pricing + legal + SEO meta + robots.txt — minimum legally-ship-able marketing site).

**Pre-existing scaffolding:** `apps/marketing/` Astro app exists from Story 1.1 (done). Most slices are content + SEO.

**Special note:** Marketing slices are unusually clean because (a) most pages have no backend dependency, (b) no agent involvement, (c) Astro's static-site output makes each page genuinely independent. Vertical slicing here mostly means "ship one page at a time with its full SEO + content shape."

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 11-S1 | Visit `hivekitchen.com` → landing page renders with hero + three-signal framing + signup CTA. Lighthouse LCP <1.5s on anchor device. | 11.1 (partial: page only, SEO meta in S3) |
| 11-S2 | Navigate to `/pricing` → see Standard ($6.99/mo or $69/yr) + Premium ($12.99/mo or $129/yr) with feature comparison + school-year auto-pause callout | 11.2 (page side) |
| 11-S3 | View source on `/` and `/pricing` → see canonical URL, OG + Twitter meta, JSON-LD `Organization`+`WebApplication` (root), JSON-LD `Offer` per tier (pricing). Pass Google Rich Results test. | 11.1 (SEO side), 11.2 (structured-data side) |
| 11-S4 | Navigate to `/faq`, `/legal/terms`, `/legal/privacy`, `/legal/coppa-aadc` → each page renders MDX content. Privacy page lists every named processor. JSON-LD `FAQPage` on `/faq`. | 11.5 |
| 11-S5 | `curl /lunch/test` → response includes `X-Robots-Tag: none`. View `/robots.txt` → marketing routes allowed, `/lunch/*` disallowed, app routes disallowed. Run [Bing/Google indexing checker] → marketing pages indexed, `/lunch/*` not | 11.6 (robots/meta side) **Launch wall** |
| 11-S6 | Visit `/pain-point-demo` → sample BriefCanvas renders for "Halal + peanut-allergic blended-heritage" demo household → tap "swap Tuesday" → see disambiguation → resolve → tile updates. Browser network tab shows zero API calls for data (static fixture). | 11.3 |
| 11-S7 | Navigate to `/cultural-partners/halal` (or `/kosher`, `/hindu-vegetarian`, `/south-asian`, `/east-african`, `/caribbean`) → MDX content with native-cook quotes + recognition examples renders. Each page SEO-optimized for intent queries (e.g., "halal school lunch planning"). | 11.4 |
| 11-S8 | Visit `/gift` → see gift-Premium pricing ($129/yr) + Guest Heart Note add-on ($24/yr) → click CTA → redirect to `/gift/purchase` in app under `.grandparent-scope` | 11.6 (gift side) |

**Count:** 8 slices vs 6 original stories.

---

## Sequencing

```
S1 ─ S2 ─ S3 ─ S4 ─ S5 ─┬─ S6  (interactive demo)
               [launch  ├─ S7  (cultural-community partner pages)
                wall]   └─ S8  (gift-purchase entry)
```

**Launch wall = S5.** Below the wall is sequential — by S5 you have a landing page + pricing + legal pages + SEO meta + robots.txt indexing rules. That's the minimum legally-shippable marketing site for any public launch. S6/S7/S8 are independently parallelizable conversion-quality enhancements that ship on their own timelines.

---

## Slice 11-S1 — Landing page

**Demo:** Visit `hivekitchen.com` (or local Astro dev server) → see landing page with hero copy ("Lumi plans your family's lunch week"), three signal-question framing, signup/beta CTA. Run Lighthouse → LCP <1.5s green; zero JavaScript loaded by default.

**Layers:**
- **UI:** `apps/marketing/src/pages/index.astro` + shared Layout component. Zero-JS-by-default Astro pattern.
- **API:** none.
- **Agent:** none.
- **DB:** none.

**Deferred:** SEO meta tags (S3 — they're cross-cutting and best added in one consolidated slice).

**Cited PRD codes:** FR (marketing intent), NFR-PERF (LCP target).

---

## Slice 11-S2 — Pricing page

**Demo:** Navigate from landing → `/pricing` → render both tiers with feature comparison table + school-year auto-pause callout + gift-purchase entry point. Both tier CTAs link to `/auth/login?next=/billing/checkout?tier=...`.

**Layers:**
- **UI:** `apps/marketing/src/pages/pricing.astro`. Pricing comparison table component.

**Cross-epic dependency:** `/billing/checkout` route lives in Epic 8. Until that ships, the CTA can land on `/auth/login?next=/billing/checkout?tier=standard` and the app shows an "Almost ready" page — acceptable for marketing-site testing.

---

## Slice 11-S3 — SEO meta + structured data

**Demo:** View source on `/`, `/pricing` → see `<title>`, `<meta name="description">`, canonical URL, OpenGraph (`og:title`, `og:description`, `og:image`), Twitter card meta, JSON-LD `<script type="application/ld+json">` for `Organization` + `WebApplication` (root) and `Offer` per tier (pricing). Run Google Rich Results Test on each URL → no errors.

**Layers:**
- **UI:** Shared `<SEO>` component used by all pages; per-page meta overrides. Astro middleware for canonical URL generation.

**This slice is intentionally cross-cutting** — easier to ship SEO meta for all pages in one go than to bolt it onto each page slice. Apply same shared component to all subsequent slices.

---

## Slice 11-S4 — FAQ + legal pages

**Demo:** Navigate to `/faq` → see FAQ rendered from MDX content collection, with JSON-LD `FAQPage` for SEO. Navigate to `/legal/terms`, `/legal/privacy`, `/legal/coppa-aadc` → each page renders MDX. Privacy page lists every named processor (Supabase, ElevenLabs, SendGrid, Twilio, OpenAI, Stripe).

**Layers:**
- **UI:** Astro MDX content collections (`apps/marketing/src/content/`); 4 new routes.

**Note:** Legal copy itself needs to be drafted by Legal — this slice ships the *infrastructure* and a first-draft. Copy revisions land via PRs on the MDX files without engineering work.

---

## Slice 11-S5 — Robots + indexing rules 🚧 LAUNCH WALL

**Demo:**
1. `curl -I https://hivekitchen.com/lunch/test-token` → response includes header `X-Robots-Tag: none`
2. Visit `/robots.txt` → see `Allow: /` for marketing routes, `Disallow: /lunch/`, `Disallow: /app/`, `Disallow: /onboarding`, `Disallow: /account`, etc.
3. Pages under `/lunch/*` include `<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">`
4. Authenticated app routes include `<meta name="robots" content="noindex,nofollow">`

**Layers:**
- **UI:** `apps/marketing/public/robots.txt` + per-page `<SEO robots="...">` prop. `apps/web` AppLayout adds the same robots meta. Fastify response middleware adds `X-Robots-Tag` header to `/lunch/*` routes.

**Cited PRD codes:** Marketing routes indexable; child Lunch Link explicitly non-indexable per Sacred Channel doctrine.

**Why this is the launch wall:** Before any DNS pointing to `hivekitchen.com`, the marketing site needs to be index-safe. Without S5, search engines could index Lunch Link URLs (child surface), which violates the Sacred Channel doctrine and creates a real privacy incident. **S1–S5 form the minimum legally-shippable marketing site.**

---

## Slice 11-S6 — Pre-login interactive demo

**Demo:** Visit `/pain-point-demo` → renders sample BriefCanvas with curated demo household profile: "Halal + peanut-allergic blended-heritage family". See the week laid out. Tap "swap Tuesday" → see DisambiguationPicker → pick option → tile updates with QuietDiff. Network tab shows zero API calls for data (all from static fixture). Bottom CTA: "Start your account → see your family's week."

**Layers:**
- **UI:** New route in marketing app (or in `apps/web` with no-auth gate). Reuses `BriefCanvas`, `PlanTile`, `DisambiguationPicker` components from `apps/web`. Static demo data fixture exports.
- **API:** none — all data from static fixture.

**Cross-component dependency:** Needs BriefCanvas + PlanTile + DisambiguationPicker components from `apps/web`. Since γ Phases 3a–3b made these into clean v2.0 components, sharing them across marketing/app is feasible (likely via `packages/ui` extraction). Alternative: copy the demo BriefCanvas as a marketing-app-local component to avoid coupling.

**Cited PRD codes:** PRD §10 (pre-login demo).

---

## Slice 11-S7 — Cultural-community partner pages

**Demo:** Navigate to `/cultural-partners/halal` (also `/kosher`, `/hindu-vegetarian`, `/south-asian`, `/east-african`, `/caribbean`) → see MDX-rendered content with native-cook quotes, cultural-recognition examples, community partner endorsements. View source → see SEO meta optimized for intent queries (e.g., title "Halal school lunch planning that respects your family's table").

**Layers:**
- **UI:** Astro content collection `cultural-partners/*.mdx`; dynamic route renders each.

**Content dependency:** Each page needs real quotes from cultural-community partners — coordinate with marketing/partnership team before this slice ships.

---

## Slice 11-S8 — Gift-purchase entry

**Demo:** Visit `/gift` → see explainer: "Gift HiveKitchen Premium to a family you love — $129/yr. Add the Grandparent Heart Note add-on for $24/yr to send your own notes." Click CTA → redirect to `/gift/purchase` in `apps/web` under `.grandparent-scope`.

**Layers:**
- **UI:** Marketing page + CTA + correct cross-app redirect handling.

**Cross-epic dependency:** Epic 8 Story 8.6 owns `/gift/purchase` in the app. Until 8.6 ships, the CTA lands at `/gift/purchase` and the app renders an "Almost ready" stub.

---

## What's intentionally NOT a slice

- **"Astro scaffold"** is not its own slice. It already exists (Story 1.1 done). S1 is the first *user-visible* deliverable on top of the scaffold.
- **"Build a CMS for legal copy"** is not a slice. MDX in the repo is sufficient at MVP; copy edits ship via PRs.
- **"A/B testing harness"** is not a slice. Until the site has organic traffic, A/B testing is premature.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 11-S2 | Epic 8 `/billing/checkout` route | 🚧 placeholder OK pre-launch |
| 11-S6 | BriefCanvas, PlanTile, DisambiguationPicker components | ✅ shipped (γ Phases 3a–3b) |
| 11-S8 | Epic 8 Story 8.6 (gift purchase in app) | 🚧 placeholder OK pre-launch |

Marketing is unusually independent. Epics 4–10 can ship in any order without blocking Epic 11 slices, provided pre-launch placeholders for billing endpoints.

---

## Conversion progress

| Epic | Status |
|---|---|
| 4 (Lunch Link + Heart Note) | ✅ converted — 18 slices, MVP wall at S5 |
| 5 (Coordination + Evening Check-in) | ✅ converted — 20 slices, MVP wall at S6 |
| 6 (Grocery + Silent Pantry) | ✅ converted — 11 slices, MVP wall at S6 |
| 7 (Visible Memory + Trust) | ✅ converted — 13 slices, walls at S5 + S11 |
| 11 (Marketing) | ✅ converted (this doc) — 8 slices, launch wall at S5 |
| 8 (Billing + Tiers) | pending |
| 9 (Ops Dashboard) | pending |
| 10 (Beta→Launch) | pending |

---

## What remains

**Epics 8, 9, 10** are next. These are different in character:

- **Epic 8 (Billing)** — Stripe integration. Vertical slices natural but with awkward webhook/test-mode constraints. ~10–14 slices likely.
- **Epic 9 (Ops Dashboard + Compliance Export + Incident Response)** — internal-tooling-shaped, not customer-facing. Slicing helps but the "demo path" rule needs adjusting for ops-internal demos (you're demoing to an ops engineer, not a parent). Lighter weight.
- **Epic 10 (Beta→Launch Transition)** — coordination, A/B cohort, beta→paid posture flip. Mostly procedural/coordination, not feature shipping. Some slices, some milestone-shaped.

Recommend doing **Epic 8 next** since it's still feature-shaped. Then Epic 9 + Epic 10 as combined ops/launch ceremony.

Continue with Epic 8?
