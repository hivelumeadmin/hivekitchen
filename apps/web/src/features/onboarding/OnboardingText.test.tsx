import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingText } from './OnboardingText.js';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const SAMPLE_THREAD_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_TURN_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_LUMI_TURN_ID = '33333333-3333-4333-8333-333333333333';

const originalFetch = globalThis.fetch;

function mockTurnResponse(opts: {
  lumi_response?: string;
  is_complete?: boolean;
  status?: number;
  errorBody?: object;
  moment_key?: string | null;
  chip_config?: unknown;
}): Response {
  const status = opts.status ?? 200;
  const body =
    status === 200
      ? {
          thread_id: SAMPLE_THREAD_ID,
          turn_id: SAMPLE_TURN_ID,
          lumi_turn_id: SAMPLE_LUMI_TURN_ID,
          lumi_response: opts.lumi_response ?? "What's a Friday in your house?",
          is_complete: opts.is_complete ?? false,
          ...(opts.moment_key !== undefined ? { moment_key: opts.moment_key } : {}),
          ...(opts.chip_config !== undefined ? { chip_config: opts.chip_config } : {}),
        }
      : (opts.errorBody ?? { type: '/errors/upstream', status, title: 'Upstream' });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OnboardingText', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders the opening Lumi greeting on mount', () => {
    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    expect(screen.getByText(/planning lunches/i)).toBeDefined();
    expect(screen.getByLabelText(/your message to lumi/i)).toBeDefined();
  });

  it('disables the input while a turn is in flight, then appends both turns', async () => {
    let resolveFetch: (v: Response) => void = () => undefined;
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    const textarea = screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Grandma made dal every Sunday.' } });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    // Optimistic turn fired: textarea cleared and input disabled while in flight.
    // User turns are intentionally hidden in focused mode (history-only).
    await waitFor(() => {
      expect(textarea.value).toBe('');
      expect(textarea.disabled).toBe(true);
    });

    // Resolve the fetch with a Lumi reply
    resolveFetch(mockTurnResponse({ lumi_response: "What's a Friday in your house?" }));

    await waitFor(() => {
      expect(screen.getByText(/Friday in your house/i)).toBeDefined();
    });
    await waitFor(() => {
      expect((screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement).disabled).toBe(false);
    });
  });

  it('on 502 error, re-enables input and shows inline error; user turn stays', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({ status: 502, errorBody: { type: '/errors/upstream', status: 502 } }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Sometimes she made roti.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    // 502 path: draft stays empty (turn was persisted server-side — not restored).
    // Non-upstream errors restore the draft so the user can re-send without retyping.
    // User turns are hidden in focused mode (visible via history toggle).
    expect((screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement).value).toBe('');
    // Input re-enabled
    expect((screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('renders "Finish onboarding" when is_complete=true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({
        lumi_response: 'Sounds like a South Asian household. Does that sound right?',
        is_complete: true,
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Yes that sounds right.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /finish onboarding/i })).toBeDefined();
    });
  });

  it('renders moment-based header when moment_key is m1_table', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({
        lumi_response: 'Tell me about your household.',
        moment_key: 'm1_table',
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    // Initial mount: no moment_key yet — falls back to the legacy step counter.
    expect(screen.getByText(/Step \d of ~8/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: "We're the Sharma kitchen." },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Moment 1 of 5 · Who's at the table/i)).toBeDefined();
    });
  });

  it('keeps the step-counter fallback when the response omits moment_key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({ lumi_response: 'Tell me more.' }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Hi.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Tell me more/i)).toBeDefined();
    });
    // No moment_key → legacy step header remains.
    expect(screen.getByText(/Step \d of ~8/i)).toBeDefined();
  });

  it('clicking SkipChip submits a chip turn with ["skip"]', async () => {
    // Need to seed an initial turn so chip_config (with skip_label) is present.
    let firstCall = true;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (firstCall) {
        firstCall = false;
        return mockTurnResponse({
          lumi_response: 'Pick a cuisine or skip.',
          moment_key: 'm3_taste',
          chip_config: {
            mode: 'action',
            options: [{ key: 'south_indian', label: 'South Indian' }],
            skip_label: 'Skip this moment',
          },
        });
      }
      // Capture the SkipChip POST body for assertion.
      const reqBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(
        JSON.stringify({
          thread_id: SAMPLE_THREAD_ID,
          turn_id: SAMPLE_TURN_ID,
          lumi_turn_id: SAMPLE_LUMI_TURN_ID,
          lumi_response: `Got it. body=${JSON.stringify(reqBody)}`,
          is_complete: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    // Trigger the first turn so chip_config (with a skip chip) appears.
    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'first turn' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    const skipBtn = await screen.findByText(/Skip this moment/i);
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondCallBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(secondCallBody).toBeDefined();
    const parsed = JSON.parse(secondCallBody as string);
    expect(parsed).toEqual({ chip_selections: ['skip'] });
  });

  // -------------------------------------------------------------------------
  // Slice 2.5-s6 — Moment 2 ("What I need to keep safe")
  // -------------------------------------------------------------------------

  const M2_CHIP_CONFIG = {
    mode: 'choice',
    options: [
      { key: 'none', label: 'No known allergens' },
      { key: 'peanut', label: 'Peanut' },
      { key: 'tree-nuts', label: 'Tree nuts' },
      { key: 'dairy', label: 'Dairy' },
      { key: 'eggs', label: 'Eggs' },
      { key: 'soy', label: 'Soy' },
      { key: 'wheat', label: 'Wheat / gluten' },
      { key: 'fish', label: 'Fish' },
      { key: 'shellfish', label: 'Shellfish' },
      { key: 'sesame', label: 'Sesame' },
    ],
  };

  async function arriveAtM2(): Promise<void> {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'What do we need to keep safe?',
        moment_key: 'm2_safe',
        chip_config: M2_CHIP_CONFIG,
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Just my daughter Layla, 10.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/What do we need to keep safe/i)).toBeDefined();
    });
  }

  it('shows the 10 M2 allergen chips with "No known allergens" first', async () => {
    await arriveAtM2();

    expect(screen.getByText('No known allergens')).toBeDefined();
    expect(screen.getByText('Peanut')).toBeDefined();
    expect(screen.getByText('Sesame')).toBeDefined();
  });

  it('"No known allergens" is mutually exclusive with allergen chips', async () => {
    await arriveAtM2();

    // Select Peanut, then "No known allergens" — peanut should be deselected.
    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/1 selection/);
    });

    fireEvent.click(screen.getByText('No known allergens'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(
        /No known allergens — confirmed/,
      );
    });

    // Now tap Peanut again — 'none' clears, peanut selected.
    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/1 selection/);
    });
  });

  it('shows the Required status line when no chips and no draft in M2', async () => {
    await arriveAtM2();

    expect(screen.getByTestId('m2-status-line').textContent).toMatch(/Required —/);
  });

  it('updates status line to a count after selecting multiple chips', async () => {
    await arriveAtM2();

    fireEvent.click(screen.getByText('Peanut'));
    fireEvent.click(screen.getByText('Dairy'));

    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/2 selections/);
    });
  });

  it('Send is disabled in M2 with no selection + no text, enabled after a chip', async () => {
    await arriveAtM2();

    const sendBtn = screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(sendBtn.disabled).toBe(false);
    });
  });

  it('renders the M2 safety card on the profile panel after submitting "No known allergens"', async () => {
    // Two responses: first arrives in M2; second is the response to the chip turn.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'What do we need to keep safe?',
          moment_key: 'm2_safe',
          chip_config: M2_CHIP_CONFIG,
        }),
      )
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Got it.',
          moment_key: 'm3_taste',
          chip_config: null,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Hi.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/What do we need to keep safe/i)).toBeDefined();
    });

    fireEvent.click(screen.getByText('No known allergens'));
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      const cards = screen.getAllByTestId('m2-safety-card');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.textContent).toMatch(/All clear/);
    });
  });

  it('clicking "Finish onboarding" calls finalize and navigates to /app', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // turn endpoint
        return mockTurnResponse({
          lumi_response: 'Sounds about right. Does that sound right?',
          is_complete: true,
        });
      }
      // finalize endpoint
      return new Response(
        JSON.stringify({
          thread_id: SAMPLE_THREAD_ID,
          summary: {
            cultural_templates: ['South Asian'],
            palate_notes: [],
            allergens_mentioned: ['nuts'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Yes that all sounds right.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    const finishBtn = await screen.findByRole('button', { name: /finish onboarding/i });
    fireEvent.click(finishBtn);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app');
    });
  });

  // -------------------------------------------------------------------------
  // Slice 2.5-s7 — Moment 3 ("How your kitchen tastes")
  // -------------------------------------------------------------------------

  const M3_HINT_CHIP_CONFIG = {
    mode: 'hint',
    hints: [
      'Halal Punjabi household, mostly home-cooked Indian',
      'Italian heritage, kids love pasta — dairy-light for the youngest',
      'Hindu vegetarian — South Indian for me, Mexican for them',
    ],
    skip_label: 'Skip this moment',
  };

  const M3_ELEVATION_CHIP_CONFIG = {
    mode: 'action',
    options: [
      { key: 'always-respect', label: 'Always respect' },
      { key: 'prefer', label: 'Prefer when possible' },
      { key: 'just-context', label: 'Just for context' },
    ],
  };

  async function arriveAtM3(): Promise<void> {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'Tell me how your kitchen tastes.',
        moment_key: 'm3_taste',
        chip_config: M3_HINT_CHIP_CONFIG,
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'No allergens for Layla.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Tell me how your kitchen tastes/i)).toBeDefined();
    });
  }

  it('renders the M3 taste card in "capturing" state when the moment is reached', async () => {
    await arriveAtM3();

    await waitFor(() => {
      const cards = screen.getAllByTestId('m3-taste-card');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.textContent).toMatch(/Waiting on your response/);
    });
  });

  it('renders "Skipped for now" copy after the Skip chip is tapped', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Tell me how your kitchen tastes.',
          moment_key: 'm3_taste',
          chip_config: M3_HINT_CHIP_CONFIG,
        }),
      )
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Of course, we can fill that in anytime.',
          moment_key: 'm4_bag',
          chip_config: null,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'No allergens for Layla.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Tell me how your kitchen tastes/i)).toBeDefined();
    });

    // Tap the Skip chip (skip_label) — this submits ['skip'] as chip selections.
    fireEvent.click(screen.getByText('Skip this moment'));

    await waitFor(() => {
      const cards = screen.getAllByTestId('m3-taste-card');
      expect(cards[0]!.textContent).toMatch(/Skipped for now/);
    });
  });

  it('renders "Noted" copy when the agent advances out of M3 to M4', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Tell me how your kitchen tastes.',
          moment_key: 'm3_taste',
          chip_config: M3_HINT_CHIP_CONFIG,
        }),
      )
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Noted — what goes in the bag?',
          moment_key: 'm4_bag',
          chip_config: null,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    // 1st turn → arrive at M3
    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'No allergens.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(/Tell me how your kitchen tastes/i)).toBeDefined();
    });

    // 2nd turn — free-text M3 response that advances to M4
    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: "We're a Halal Punjabi household." },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      const cards = screen.getAllByTestId('m3-taste-card');
      expect(cards[0]!.textContent).toMatch(/Noted/);
    });
  });

  it('does NOT render the M3 taste card before M3 is reached', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'Tell me about your household.',
        moment_key: 'm1_table',
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Hi.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Tell me about your household/i)).toBeDefined();
    });
    expect(screen.queryAllByTestId('m3-taste-card')).toHaveLength(0);
  });

  it('renders the three elevation action chips with single-select behaviour (AC12)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response:
          "Got it — 'strictly Halal.' Should I treat that as a hard rule or more like a preference?",
        moment_key: 'm3_taste',
        chip_config: M3_ELEVATION_CHIP_CONFIG,
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: "We're strictly Halal." },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/strictly Halal/)).toBeDefined();
    });

    expect(screen.getByText('Always respect')).toBeDefined();
    expect(screen.getByText('Prefer when possible')).toBeDefined();
    expect(screen.getByText('Just for context')).toBeDefined();

    // Action mode has no skip option (no skip_label in M3 elevation config).
    expect(screen.queryByText('Skip this moment')).toBeNull();

    // Send is disabled until one is selected.
    const sendBtn = screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    fireEvent.click(screen.getByText('Always respect'));
    await waitFor(() => {
      expect(sendBtn.disabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Slice 2.5-s8 — Moment 4 ("What goes in the bag")
  // -------------------------------------------------------------------------

  const M4_BAG_CHIP_CONFIG = {
    mode: 'action',
    options: [
      { key: 'main_only', label: 'Main only' },
      { key: 'main_plus_snack', label: 'Main + snack' },
      { key: 'main_plus_extra', label: 'Main + sides' },
      { key: 'main_plus_snack_plus_extra', label: 'Full bag' },
    ],
  };

  it('renders the M4 bag card in "capturing" state when the agent advances into m4_bag', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'What goes in their bag?',
        moment_key: 'm4_bag',
        chip_config: M4_BAG_CHIP_CONFIG,
      }),
    ) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Halal household.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      const cards = screen.getAllByTestId('m4-bag-card');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.textContent).toMatch(/Still listening/);
    });
  });

  it('renders the M4 bag card in "captured" state once the agent advances out of m4_bag', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'What goes in their bag?',
          moment_key: 'm4_bag',
          chip_config: M4_BAG_CHIP_CONFIG,
        }),
      )
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: "Got it — let's pick favourites.",
          moment_key: 'm5_starting_line',
          chip_config: null,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <OnboardingText />
      </MemoryRouter>,
    );

    // 1st turn → arrive at m4_bag (card flips to "capturing")
    fireEvent.change(screen.getByLabelText(/your message to lumi/i), {
      target: { value: 'Halal household.' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(/What goes in their bag/i)).toBeDefined();
    });

    // 2nd turn — tap a bag chip; backend response advances past m4_bag,
    // flipping the card to "captured".
    fireEvent.click(screen.getByText('Main + snack'));
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      const cards = screen.getAllByTestId('m4-bag-card');
      expect(cards[0]!.textContent).toMatch(/Saved/);
    });
  });
});
