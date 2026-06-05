# Story 7-S6: First-time Helper Pulse

Status: done

## Story

As a first-time visitor to `/app/memory`,
I want the `⋯` icon on the first memory sentence to pulse honey-amber with a floating helper tooltip for 4 seconds,
so that I immediately understand how to explore or manage Lumi's memory without needing instructions.

## Acceptance Criteria

1. **Given** a user visits `/app/memory` for the first time (no `memory_helper_seen_at` key in `localStorage`), **When** at least one memory node is rendered, **Then** the `⋯` trigger on the FIRST row only pulses honey-amber (`animate-pulse` + `text-honey-amber-500`) and a helper tooltip "Tap ⋯ to see where this came from or ask Lumi to forget it" is visible beside it.

2. **Given** the helper is showing, **When** 4 seconds elapse with no user interaction, **Then** the pulse and tooltip both disappear automatically and `localStorage.getItem('memory_helper_seen_at')` returns a non-null string.

3. **Given** the helper is showing, **When** the user performs any `pointerdown` event anywhere on the page, **Then** the pulse and tooltip disappear immediately and `localStorage.getItem('memory_helper_seen_at')` returns a non-null string.

4. **Given** `localStorage` already has `memory_helper_seen_at` set (any non-null value), **When** the user visits `/app/memory`, **Then** no helper tooltip is shown and no `⋯` button pulses honey-amber — even if the page re-renders.

5. **Given** the user has `prefers-reduced-motion` set, **When** the helper is shown, **Then** there is NO `animate-pulse` animation on the `⋯` button. The helper tooltip text still appears and still auto-dismisses after 4s (the motion preference suppresses only animation, not the helper copy).

6. **Given** multiple memory nodes are rendered, **When** the helper is showing, **Then** ONLY the first node's `⋯` button gets the honey-amber pulse + tooltip. All other `⋯` buttons remain unchanged (`text-fg-muted`).

7. **Given** zero nodes are returned (empty state, loading, or error), **When** the memory page renders, **Then** no helper is shown (nothing to point to).

## Tasks / Subtasks

### Task 1 — `memory.tsx`: read localStorage once + pass `showHelper` to first row (AC: #1, #4, #6, #7)

- [x] In `apps/web/src/routes/(app)/memory.tsx`, read localStorage exactly once per mount with a `useRef`:
  ```tsx
  const showHelper = useRef(!localStorage.getItem('memory_helper_seen_at')).current;
  ```
  Place this after `useLumiContext` and before any effects. Using `useRef(...).current` reads once at construction time — stable for the component's lifetime, no re-renders triggered.

- [x] In the `nodes.map((node, index) => ...)` call, add an `index` parameter and thread `showHelper` to the first row only:
  ```tsx
  {nodes.map((node, index) => (
    <VisibleMemorySentence
      key={node.id}
      node={node}
      showHelper={index === 0 && showHelper}
      onNodeUpdated={(u) => setNodes((prev) => prev.map((n) => (n.id === u.id ? u : n)))}
    />
  ))}
  ```

- [x] No other changes to `memory.tsx`.

---

### Task 2 — `VisibleMemorySentence.tsx`: thread `showHelper` prop to `ProvenancePopover` (AC: #1, #6)

- [x] In `apps/web/src/components/VisibleMemorySentence.tsx`, extend the `Props` interface:
  ```tsx
  interface Props {
    node: MemoryNode;
    onNodeUpdated: (node: MemoryNode) => void;
    showHelper?: boolean;
  }
  ```

- [x] Destructure `showHelper` from props in the function signature:
  ```tsx
  export function VisibleMemorySentence({ node, onNodeUpdated, showHelper }: Props) {
  ```

- [x] Pass `showHelper` through to `<ProvenancePopover>` in the normal (non-tombstone, non-editing) render:
  ```tsx
  <ProvenancePopover
    nodeId={node.id}
    showHelper={showHelper}
    onEdit={() => { ... }}
    onForget={() => { ... }}
  />
  ```

- [x] No changes to any other `ProvenancePopover` call sites — the prop is optional and defaults to `undefined` (falsy).

- [x] **⚠️ Existing `VisibleMemorySentence.test.tsx` mock:** The test file already mocks `ProvenancePopover` with a hand-rolled component. That mock's type signature doesn't include `showHelper` — but since the mock is a plain function it silently ignores extra props at runtime. **Do NOT modify the existing mock or any existing `VisibleMemorySentence` tests.** The mock captures `onEdit` and `onForget` and that's sufficient for the unit-level tests.

---

### Task 3 — `ProvenancePopover.tsx`: helper state + pulse + tooltip (AC: #1–#6)

- [x] Add `showHelper?: boolean` to the props destructure:
  ```tsx
  export function ProvenancePopover({
    nodeId,
    onEdit,
    onForget,
    showHelper,
  }: {
    nodeId: string;
    onEdit?: () => void;
    onForget?: () => void;
    showHelper?: boolean;
  }) {
  ```

- [x] Add helper visibility state (initial value from the prop — stable after mount):
  ```tsx
  const [helperVisible, setHelperVisible] = useState(!!showHelper);
  ```

- [x] Add a single `useEffect` that manages BOTH the 4s auto-dismiss AND the pointerdown listener. Both fire the same `dismiss` closure, so localStorage is written exactly once regardless of which path triggers:
  ```tsx
  useEffect(() => {
    if (!helperVisible) return;
    function dismiss() {
      setHelperVisible(false);
      localStorage.setItem('memory_helper_seen_at', new Date().toISOString());
    }
    const timer = setTimeout(dismiss, 4000);
    document.addEventListener('pointerdown', dismiss, { once: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [helperVisible]);
  ```
  `{ once: true }` means the DOM listener self-removes after its first fire; the cleanup handles the case where the component unmounts before either trigger fires.

- [x] Update the `⋯` trigger button's `className` to add honey-amber + pulse when `helperVisible`:
  ```tsx
  className={
    "mt-0.5 font-sans text-sm hover:text-fg transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage rounded" +
    (helperVisible
      ? " text-honey-amber-500 animate-pulse motion-reduce:animate-none"
      : " text-fg-muted")
  }
  ```
  The `motion-reduce:animate-none` class suppresses the pulse for users who prefer reduced motion (AC5). The `text-honey-amber-500` color change still applies for reduced-motion users — only the animation itself is suppressed.

- [x] Add the helper tooltip as a sibling of the trigger button, INSIDE the `<span ref={containerRef}>` wrapper (which already has `className="relative inline-block shrink-0"`):
  ```tsx
  {helperVisible && (
    <span
      role="tooltip"
      aria-live="polite"
      className="absolute end-full top-0 me-2 w-48 rounded-lg border border-border bg-surface px-3 py-2 font-sans text-xs text-fg shadow-sm pointer-events-none motion-reduce:animate-none"
    >
      Tap ⋯ to see where this came from or ask Lumi to forget it
    </span>
  )}
  ```
  - `end-full top-0 me-2` — floats the tooltip to the left of the `⋯` button (which sits at the right edge of each row), vertically aligned to its top
  - `pointer-events-none` — prevents the tooltip from intercepting mouse events; the `pointerdown` listener fires on the document beneath it (AC3 still works)
  - The `containerRef` already wraps the trigger button; the tooltip is inside the same `relative` container so absolute positioning works correctly

- [x] **Existing behavior is unchanged.** The helper only activates when `showHelper=true` is explicitly passed. Default (`showHelper` absent/`undefined`) → `useState(false)` → no effect runs → no class changes → no tooltip renders. Zero regression risk.

---

### Task 4 — Tests: `ProvenancePopover.test.tsx` new describe block (AC: #1–#5)

Add a new `describe('helper pulse (7-S6)')` block at the bottom of the existing file. Use `vi.useFakeTimers()` for the 4s test. Clean up `localStorage` and real timers in `beforeEach`/`afterEach`.

```tsx
describe('helper pulse (7-S6)', () => {
  beforeEach(() => {
    localStorage.removeItem('memory_helper_seen_at');
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem('memory_helper_seen_at');
  });

  it('shows the helper tooltip when showHelper=true (AC1)', () => {
    render(<ProvenancePopover nodeId={NODE_ID} showHelper />);
    expect(
      screen.getByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeDefined();
  });

  it('does NOT show the helper tooltip when showHelper is absent (AC4)', () => {
    render(<ProvenancePopover nodeId={NODE_ID} />);
    expect(
      screen.queryByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeNull();
  });

  it('auto-dismisses the helper after 4s and writes to localStorage (AC2)', () => {
    vi.useFakeTimers();
    render(<ProvenancePopover nodeId={NODE_ID} showHelper />);

    expect(
      screen.getByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeDefined();

    vi.advanceTimersByTime(4000);

    expect(
      screen.queryByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeNull();
    expect(localStorage.getItem('memory_helper_seen_at')).not.toBeNull();
  });

  it('dismisses the helper on pointerdown and writes to localStorage (AC3)', () => {
    render(<ProvenancePopover nodeId={NODE_ID} showHelper />);

    expect(
      screen.getByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeDefined();

    fireEvent(document.body, new Event('pointerdown', { bubbles: true }));

    expect(
      screen.queryByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeNull();
    expect(localStorage.getItem('memory_helper_seen_at')).not.toBeNull();
  });

  it('does NOT show the helper when showHelper=false (AC4)', () => {
    render(<ProvenancePopover nodeId={NODE_ID} showHelper={false} />);
    expect(
      screen.queryByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeNull();
  });
});
```

**Test count:** 5 new tests added to the existing 12 → 17 in `ProvenancePopover.test.tsx`.

---

### Task 5 — Tests: `memory.test.tsx` new cases (AC: #1, #4, #6, #7)

Add two new tests at the bottom of the existing `describe('MemoryRoute')` block. Add `localStorage.removeItem('memory_helper_seen_at')` to the existing `beforeEach` (or `afterEach`) to prevent cross-test state leakage.

```tsx
// 7-S6 — first-time helper.

it('shows the helper tooltip on the first node when localStorage has no seen-at (7-S6 AC1)', async () => {
  localStorage.removeItem('memory_helper_seen_at');
  hkFetchMock.mockResolvedValue({
    nodes: [makeNode({ id: NODE_ID })],
  });
  renderRoute();

  await waitFor(() => {
    expect(
      screen.getByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
    ).toBeDefined();
  });
});

it('does NOT show the helper tooltip when localStorage already has memory_helper_seen_at (7-S6 AC4)', async () => {
  localStorage.setItem('memory_helper_seen_at', '2026-01-01T00:00:00.000Z');
  hkFetchMock.mockResolvedValue({
    nodes: [makeNode({ id: NODE_ID })],
  });
  renderRoute();

  await waitFor(() => {
    expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined();
  });
  expect(
    screen.queryByText('Tap ⋯ to see where this came from or ask Lumi to forget it'),
  ).toBeNull();
});
```

**Important:** These tests render the full route which renders the REAL `ProvenancePopover` (not mocked). The helper tooltip appears at the `ProvenancePopover` level.

**Add to `afterEach`:**
```tsx
afterEach(() => {
  cleanup();
  useAuthStore.getState().clearSession();
  localStorage.removeItem('memory_helper_seen_at');  // ← add this
});
```

**Test count:** 2 new tests added to the existing 6 → 8 in `memory.test.tsx`.

---

## Dev Notes

### Scope guardrails — do NOT build these

- **No API changes.** This is pure client-side UX — no endpoints, no DB, no contracts.
- **No new npm dependencies.** `localStorage` is the Web API. `animate-pulse` is Tailwind built-in. No `cn`/`clsx` needed (use string concatenation with `+` as done in existing code).
- **No Zustand store.** `localStorage` is the right persistence layer for a one-time UI seen-state. A Zustand store would survive only the current browser session — localStorage persists across sessions, which is the intent.
- **No custom CSS or keyframes.** Tailwind's `animate-pulse` is sufficient.
- **No E2E Playwright spec.** This is a UI helper with a 4s timer — unit tests with fake timers are the right gate. No new `.spec.ts` file needed.
- **No second helper on re-visit.** Once `memory_helper_seen_at` is set in localStorage, `useState(!!showHelper)` initializes to `false` — the helper never re-renders.

### localStorage API in jsdom (Vitest)

jsdom provides a working `localStorage` implementation. Tests can call `localStorage.setItem` / `localStorage.removeItem` / `localStorage.getItem` directly — no mocking needed. **Critical:** Always call `localStorage.removeItem('memory_helper_seen_at')` in `afterEach` to prevent cross-test contamination (jsdom persists localStorage across tests in the same module).

### Fake timers in Vitest

Use `vi.useFakeTimers()` in the test that checks the 4s auto-dismiss. Call `vi.useRealTimers()` in `afterEach` to restore. `vi.advanceTimersByTime(4000)` fires the `setTimeout` synchronously — no `await` needed for the assertion.

**Caution:** `vi.useFakeTimers()` replaces `Date`, `setTimeout`, and `setInterval`. Since the 4s test doesn't `await` any React state updates, verify via `screen.queryByText` after `advanceTimersByTime`. If React batches the state update, wrap the assertion in `waitFor`.

### `useRef(...).current` pattern in `memory.tsx`

```tsx
const showHelper = useRef(!localStorage.getItem('memory_helper_seen_at')).current;
```

This reads localStorage exactly once — at component creation time, before the first render. Using `.current` directly (not as a mutable ref) is the pattern for "read once, never re-read" initialization. Do NOT use `useState` (triggers re-render when set) or a plain variable (recomputes on every render, though harmless here).

### Why the helper effect depends on `[helperVisible]`

The `useEffect` depends on `[helperVisible]` so that:
1. When the component first mounts with `helperVisible=true`, the timer + listener attach.
2. When `setHelperVisible(false)` fires (from either path), the cleanup runs (clears the timer, removes the listener).
3. The effect does NOT re-run for subsequent renders where `helperVisible` is already `false`.

This is correct React dependency hygiene — the `dismiss` function closure is recreated inside the effect each time, so there's no stale-closure risk.

### Positioning of the tooltip

The `⋯` button sits at the **right edge** of each memory row, inside `<span className="relative inline-block shrink-0">`. The tooltip uses `absolute end-full top-0 me-2` which positions it to the **left** of the button.

On narrow screens (< ~400px), `w-48` (192px) could overflow the left edge of the viewport if the button itself is near the left. This is acceptable at MVP — the `/app/memory` route has a `max-w-3xl` container with `px-4` padding, so the `⋯` column is always ≥4px from the left. The tooltip is `pointer-events-none` so it doesn't block taps even if it partially overflows.

### Color token for honey-amber pulse

The Tailwind config (via `packages/design-system/src/tokens/index.ts`) maps:
```ts
'honey-amber': colorScale('honey-amber'),  // honey-amber-50 through honey-amber-900
```

Use `text-honey-amber-500` for the pulse color — mid-scale amber, warm and visible against the oat/off-white background, not overly saturated. Do NOT use `text-amber` (that's the semantic token for the design system's `amber.DEFAULT`) or `text-honey-accent` (too specialized). Stick to `honey-amber-500`.

### Motion-reduce contract (AC5)

Per `apps/web/CLAUDE.md` and `docs/DESIGN.md`: `motion-reduce:animate-none` on the button suppresses `animate-pulse` for reduced-motion users. The tooltip text itself (a plain `<span>`) has no animation to suppress. The auto-dismiss timer still fires after 4s for all users — `prefers-reduced-motion` only affects the CSS animation, not JavaScript timers.

### Test baseline (do not introduce NEW failures)

- **Web tests before this slice:** 436/436
- **After this slice:** 436 + 5 (ProvenancePopover) + 2 (memory route) = **443/443**
- **API/contracts tests:** Untouched — baseline must hold (20 pre-existing failures, all documented)
- **TypeScript:** 3 pre-existing web errors in untouched files. Zero new errors allowed.
- **Lint:** Changed files must be lint-clean (`pnpm lint`). No new `// eslint-disable` comments.

### File List

**Modified (no new files):**
- `apps/web/src/routes/(app)/memory.tsx` — `useRef` for `showHelper` + index-based prop threading
- `apps/web/src/components/VisibleMemorySentence.tsx` — `showHelper?: boolean` prop + pass-through
- `apps/web/src/components/ProvenancePopover.tsx` — `showHelper` prop + helper state + pulse + tooltip
- `apps/web/src/components/ProvenancePopover.test.tsx` — 5 new helper tests
- `apps/web/src/routes/(app)/memory.test.tsx` — 2 new helper tests + `localStorage` cleanup in `afterEach`

### References

- [Source: `_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S6`] — demo path, layers, PRD code FR65
- [Source: `apps/web/src/routes/(app)/memory.tsx`] — current route; add `useRef` + index prop
- [Source: `apps/web/src/components/VisibleMemorySentence.tsx`] — current component; add `showHelper?` prop
- [Source: `apps/web/src/components/ProvenancePopover.tsx`] — existing `pointerdown` click-outside pattern (lines 85-94) mirrors the helper dismiss listener; follow the same `containerRef` + `document.addEventListener` shape
- [Source: `apps/web/src/components/ProvenancePopover.test.tsx`] — 12 existing tests; append 5 new in a new `describe('helper pulse (7-S6)')` block
- [Source: `apps/web/src/routes/(app)/memory.test.tsx`] — 6 existing tests; append 2 new + add localStorage cleanup
- [Source: `packages/design-system/src/tokens/index.ts:38`] — `'honey-amber': colorScale('honey-amber')` — confirms `text-honey-amber-500` is a valid Tailwind token

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

### Completion Notes List

- Implemented all 7 ACs across the 5 specified files — no API/contracts/migrations (pure client-side UX), no new deps, no Zustand store, no E2E spec (per scope guardrails).
- **Task 1 (`memory.tsx`):** `const showHelper = useRef(!localStorage.getItem('memory_helper_seen_at')).current;` reads localStorage once at construction; threaded `showHelper={index === 0 && showHelper}` to the first row only (AC1, AC4, AC6, AC7 — empty/loading/error branches render no rows so no helper).
- **Task 2 (`VisibleMemorySentence.tsx`):** added optional `showHelper?: boolean` prop, destructured it, passed it through to `<ProvenancePopover>`. No other call sites touched (prop optional, defaults falsy). Existing test mock untouched.
- **Task 3 (`ProvenancePopover.tsx`):** `helperVisible` state initialized from `!!showHelper`; one `useEffect([helperVisible])` runs BOTH the 4s `setTimeout` and a `{ once: true }` document `pointerdown` listener firing the same `dismiss` closure (localStorage written exactly once); trigger button className now appends `text-honey-amber-500 animate-pulse motion-reduce:animate-none` when `helperVisible` else `text-fg-muted` (AC5 — motion-reduce suppresses only the animation, color still applies); tooltip rendered as `<span role="tooltip" aria-live="polite" ... pointer-events-none>` inside the existing `relative` container so AC3's document pointerdown still fires beneath it.
- **Tests:** +5 in `ProvenancePopover.test.tsx` (`describe('helper pulse (7-S6)')`) and +2 in `memory.test.tsx`. **SPEC RECONCILIATION:** the AC2 fake-timers test wraps `vi.advanceTimersByTime(4000)` in `act(...)` (imported from `@testing-library/react`) — advancing the timer triggers a React state update (`setHelperVisible(false)`) that must be flushed inside `act` to avoid the not-wrapped-in-act warning and to make the synchronous `queryByText` assertion see the unmounted tooltip. The story snippet omitted `act`; without it the assertion is flaky. Added `localStorage.removeItem('memory_helper_seen_at')` cleanup in both files' `afterEach`.
- **Baseline note:** the story's stated test baselines ("12 ProvenancePopover / 6 memory route → 17/8") are stale — they predate the tests 7-S3/7-S4 added. Actual baseline was 14 + 8 = 22; after +5/+2 it is 19 + 10 = 29 in these two files. Full web suite is 443/443, which matches the story's headline target.

### File List

**Modified (no new files):**
- `apps/web/src/routes/(app)/memory.tsx`
- `apps/web/src/components/VisibleMemorySentence.tsx`
- `apps/web/src/components/ProvenancePopover.tsx`
- `apps/web/src/components/ProvenancePopover.test.tsx`
- `apps/web/src/routes/(app)/memory.test.tsx`

## Review Findings

- [x] [Review][Patch] Unguarded `localStorage` access crashes page in private browsing / restricted storage [`apps/web/src/routes/(app)/memory.tsx:25`, `apps/web/src/components/ProvenancePopover.tsx` — dismiss closure] — fixed: IIFE try/catch on getItem (defaults false); try/catch on setItem in dismiss
- [x] [Review][Patch] `role="tooltip"` not associated with trigger button — missing `id` on tooltip + `aria-describedby` on trigger [`apps/web/src/components/ProvenancePopover.tsx` — tooltip span + trigger button] — fixed: helperId = useId(); id={helperId} on span; aria-describedby={helperVisible ? helperId : undefined} on trigger
- [x] [Review][Defer] First node soft-forgotten mid-pulse: cleanup runs but `localStorage` key never written → helper re-arms on next visit [`apps/web/src/components/ProvenancePopover.tsx` — useEffect cleanup] — deferred, edge case
- [x] [Review][Defer] AC5 test gap: no unit test for `motion-reduce:animate-none` suppressing animation (jsdom `matchMedia` mocking required; spec does not mandate) [`apps/web/src/components/ProvenancePopover.test.tsx`] — deferred, low risk
- [x] [Review][Defer] AC6 test gap: no test asserts non-first-row triggers stay `text-fg-muted` [`apps/web/src/routes/(app)/memory.test.tsx`] — deferred, logic is trivially correct

## Change Log

| Date       | Change                                                               |
| ---------- | -------------------------------------------------------------------- |
| 2026-06-04 | Story file authored for 7-S6 First-time Helper Pulse. Status → ready-for-dev. |
| 2026-06-04 | Implemented 7-S6 across 5 files (all 7 ACs). +7 tests (5 ProvenancePopover, 2 memory route); web 443/443. Zero new typecheck/lint errors (3 pre-existing baseline TS errors + 3 pre-existing baseline lint errors untouched). Status → review. |
