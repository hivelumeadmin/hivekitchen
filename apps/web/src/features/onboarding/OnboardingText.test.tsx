import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { OnboardingText } from './OnboardingText.js';
import { formatUserEcho } from './onboarding-conversation.js';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
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
  required_set_complete?: boolean | null;
  missing_required_set?: string[];
  cold_start_mode?: boolean;
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
          ...(opts.required_set_complete !== undefined
            ? { required_set_complete: opts.required_set_complete }
            : {}),
          ...(opts.missing_required_set !== undefined
            ? { missing_required_set: opts.missing_required_set }
            : {}),
          ...(opts.cold_start_mode !== undefined ? { cold_start_mode: opts.cold_start_mode } : {}),
        }
      : (opts.errorBody ?? { type: '/errors/upstream', status, title: 'Upstream' });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <OnboardingText />
    </MemoryRouter>,
  );
}

function sendText(value: string): void {
  fireEvent.change(screen.getByLabelText(/your message to lumi/i), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);
}

const M2_CHIP_CONFIG = {
  mode: 'choice',
  options: [
    { key: 'none', label: 'No known allergens' },
    { key: 'peanut', label: 'Peanut' },
    { key: 'tree_nut', label: 'Tree nuts' },
    { key: 'dairy', label: 'Dairy' },
    { key: 'egg', label: 'Eggs' },
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

  renderOnboarding();
  sendText('Just my daughter Layla, 10.');
  await waitFor(() => {
    expect(screen.getByText(/What do we need to keep safe/i)).toBeDefined();
  });
}

describe('formatUserEcho', () => {
  it('strips the wire chip sentinel, keeping the readable selections', () => {
    expect(formatUserEcho('[Chips selected: Peanut, Dairy]')).toBe('Peanut, Dairy');
    expect(formatUserEcho('[Chips selected: Peanut] and a note')).toBe('Peanut — and a note');
    expect(formatUserEcho('plain free text')).toBe('plain free text');
  });

  it('strips an empty sentinel and multiple sentinels (P5)', () => {
    expect(formatUserEcho('[Chips selected: ]')).toBe('');
    expect(formatUserEcho('[Chips selected: ] just a note')).toBe('just a note');
    expect(formatUserEcho('[Chips selected: A] [Chips selected: B]')).toBe('A');
  });
});

describe('OnboardingText', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders the opening Lumi greeting and the input on mount', () => {
    renderOnboarding();
    expect(screen.getByText(/planning lunches/i)).toBeDefined();
    expect(screen.getByLabelText(/your message to lumi/i)).toBeDefined();
  });

  it('is one calm mode — no conversation-history toggle', () => {
    renderOnboarding();
    expect(screen.queryByTitle(/conversation history/i)).toBeNull();
  });

  it('disables the input while a turn is in flight, then appends the Lumi reply', async () => {
    let resolveFetch: (v: Response) => void = () => undefined;
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    const textarea = screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement;
    sendText('Grandma made dal every Sunday.');

    await waitFor(() => {
      expect(textarea.value).toBe('');
      expect(textarea.disabled).toBe(true);
    });

    resolveFetch(mockTurnResponse({ lumi_response: "What's a Friday in your house?" }));

    await waitFor(() => {
      expect(screen.getByText(/Friday in your house/i)).toBeDefined();
    });
    await waitFor(() => {
      expect((screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement).disabled).toBe(false);
    });
  });

  it('echoes a chip turn cleanly — never the [Chips selected: …] sentinel', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'Pick a cuisine.',
          moment_key: 'm3_taste',
          chip_config: { mode: 'action', options: [{ key: 'south_indian', label: 'South Indian' }] },
        }),
      )
      .mockResolvedValueOnce(mockTurnResponse({ lumi_response: 'Lovely.', moment_key: 'm3_taste' })) as unknown as typeof fetch;

    renderOnboarding();
    sendText('first');
    fireEvent.click(await screen.findByText('South Indian'));
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Lovely\./)).toBeDefined();
    });
    expect(screen.queryByText(/\[Chips selected/)).toBeNull();
  });

  it('on 502, keeps the turn, leaves the draft empty, re-enables input, shows an error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({ status: 502, errorBody: { type: '/errors/upstream', status: 502 } }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('Sometimes she made roti.');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const textarea = screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    expect(textarea.disabled).toBe(false);
  });

  it('on a non-502 error, restores the draft so the parent can re-send', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockTurnResponse({ status: 500, errorBody: { type: '/errors/internal', status: 500 } }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('roti and dal');

    await waitFor(() => {
      expect((screen.getByLabelText(/your message to lumi/i) as HTMLTextAreaElement).value).toBe('roti and dal');
    });
  });

  it('renders the legacy "Finish onboarding" CTA when is_complete=true and no moment_key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({ lumi_response: 'All done.', is_complete: true }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('done');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /finish onboarding/i })).toBeDefined();
    });
  });

  it('clicking "Finish onboarding" finalizes and navigates to /app', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(mockTurnResponse({ lumi_response: 'All done.', is_complete: true }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            thread_id: SAMPLE_THREAD_ID,
            summary: { cultural_templates: [], palate_notes: [], allergens_mentioned: [] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('done');
    fireEvent.click(await screen.findByRole('button', { name: /finish onboarding/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app');
    });
  });

  it('renders the moment-based header subtitle when moment_key is m1_table', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({ lumi_response: 'Who is at the table?', moment_key: 'm1_table' }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('hi');

    await waitFor(() => {
      expect(screen.getByText(/moment 1 of 5 · who's at the table/i)).toBeDefined();
    });
  });

  it('falls back to the step counter when the response omits moment_key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({ lumi_response: 'Tell me more.' }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('hi');

    await waitFor(() => {
      expect(screen.getByText(/step \d of ~8/i)).toBeDefined();
    });
  });

  it('clicking the SkipChip submits a chip turn with ["skip"]', async () => {
    let firstCall = true;
    const fetchMock = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

    renderOnboarding();
    sendText('first turn');
    fireEvent.click(await screen.findByText(/Skip this moment/i));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondCallBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(JSON.parse(secondCallBody as string)).toEqual({ chip_selections: ['skip'] });
  });

  // --- Moment 2 — the safety wall ------------------------------------------

  it('shows the 10 M2 allergen chips with "No known allergens" first', async () => {
    await arriveAtM2();
    expect(screen.getByText('No known allergens')).toBeDefined();
    expect(screen.getByText('Peanut')).toBeDefined();
    expect(screen.getByText('Sesame')).toBeDefined();
  });

  it('makes "No known allergens" mutually exclusive with allergen chips', async () => {
    await arriveAtM2();

    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/1 selection/);
    });

    fireEvent.click(screen.getByText('No known allergens'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/No known allergens — confirmed/);
    });

    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/1 selection/);
    });
  });

  it('shows the Required status line with no chips and no draft in M2', async () => {
    await arriveAtM2();
    expect(screen.getByTestId('m2-status-line').textContent).toMatch(/Required —/);
  });

  it('updates the status line to a count after selecting multiple chips', async () => {
    await arriveAtM2();
    fireEvent.click(screen.getByText('Peanut'));
    fireEvent.click(screen.getByText('Dairy'));
    await waitFor(() => {
      expect(screen.getByTestId('m2-status-line').textContent).toMatch(/2 selections/);
    });
  });

  it('disables Send in M2 with no selection and no text, enables it after a chip', async () => {
    await arriveAtM2();
    const sendBtn = screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(screen.getByText('Peanut'));
    await waitFor(() => {
      expect(sendBtn.disabled).toBe(false);
    });
  });

  it('shows the safety card (never a premature "All clear") after M2 with no loaded projection', async () => {
    // No household is seeded, so GET /kitchen-map never runs and the projection
    // stays null. Post-fix, the hero must NOT fabricate "All clear" from an
    // unloaded map — it shows the placeholder. (The affirmative "All clear" path
    // is covered in KitchenMapHero.test.tsx with a real projection.)
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockTurnResponse({
          lumi_response: 'What do we need to keep safe?',
          moment_key: 'm2_safe',
          chip_config: M2_CHIP_CONFIG,
        }),
      )
      .mockResolvedValueOnce(
        mockTurnResponse({ lumi_response: 'Got it.', moment_key: 'm3_taste', chip_config: null }),
      ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('Hi.');
    await waitFor(() => {
      expect(screen.getByText(/What do we need to keep safe/i)).toBeDefined();
    });

    fireEvent.click(screen.getByText('No known allergens'));
    fireEvent.submit(screen.getByRole('button', { name: /send/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getAllByTestId('m2-safety-card').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/all clear/i)).toBeNull();
    expect(screen.getAllByText(/noting what to keep safe/i).length).toBeGreaterThan(0);
  });

  it('renders M3 elevation action chips with single-select behaviour', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'How strict is that?',
        moment_key: 'm3_taste',
        chip_config: {
          mode: 'action',
          options: [
            { key: 'always-respect', label: 'Always respect' },
            { key: 'prefer', label: 'Prefer' },
            { key: 'just-context', label: 'Just context' },
          ],
        },
      }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('halal');
    fireEvent.click(await screen.findByText('Always respect'));
    fireEvent.click(screen.getByText('Prefer'));

    // Single-select: exactly one chip is aria-checked.
    await waitFor(() => {
      const checked = screen.getAllByRole('radio').filter((el) => el.getAttribute('aria-checked') === 'true');
      expect(checked.length).toBe(1);
      expect(checked[0]!.textContent).toMatch(/Prefer/);
    });
  });

  it('renders a ＋ badge on chips with provenance="parent_added"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'Your starting line?',
        moment_key: 'm5_starting_line',
        chip_config: {
          mode: 'choice',
          options: [{ key: 'x', label: 'Paratha roll', provenance: 'parent_added' }],
        },
      }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('go');
    await screen.findByText('Paratha roll');
    expect(screen.getByTestId('chip-parent-added-badge')).toBeDefined();
  });

  it('renders no badge on chips without a parent_added provenance', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'Your starting line?',
        moment_key: 'm5_starting_line',
        chip_config: {
          mode: 'choice',
          options: [
            { key: 'a', label: 'Wrap', provenance: 'inferred' },
            { key: 'b', label: 'Pasta' },
          ],
        },
      }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('go');
    await screen.findByText('Wrap');
    expect(screen.queryByTestId('chip-parent-added-badge')).toBeNull();
  });

  it('shows the cold-start gate line in M5 cold-start mode', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockTurnResponse({
        lumi_response: 'Tell me some dishes.',
        moment_key: 'm5_starting_line',
        chip_config: null,
        cold_start_mode: true,
      }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('go');

    await waitFor(() => {
      expect(screen.getByTestId('cold-start-gate-line').textContent).toMatch(/three dishes/i);
    });
  });

  // --- Summary + finalize gate ---------------------------------------------

  function mockSummary(opts: {
    required_set_complete: boolean | null;
    missing_required_set?: string[];
  }): Response {
    return mockTurnResponse({
      lumi_response: "Here's what I have.",
      moment_key: 'summary',
      required_set_complete: opts.required_set_complete,
      missing_required_set: opts.missing_required_set ?? [],
      chip_config: null,
    });
  }

  it('renders the finalize gate in the summary moment', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockSummary({ required_set_complete: true }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('all set');

    await waitFor(() => {
      expect(screen.getByTestId('finalize-gate')).toBeDefined();
    });
  });

  it('enables Finalize when the required set is complete', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockSummary({ required_set_complete: true }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('all set');

    await waitFor(() => {
      expect((screen.getByTestId('finalize-button') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('renders a gap callout and disables Finalize when a required moment is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockSummary({ required_set_complete: false, missing_required_set: ['m5_starting_line'] }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('skip ahead');

    await waitFor(() => {
      expect(screen.getByTestId('gap-callout-m5_starting_line')).toBeDefined();
    });
    expect((screen.getByTestId('finalize-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('jumps back to the named moment from a gap callout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockSummary({ required_set_complete: false, missing_required_set: ['m5_starting_line'] }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('skip ahead');

    fireEvent.click(await screen.findByRole('button', { name: /back to moment 5/i }));

    await waitFor(() => {
      expect(screen.getByText(/moment 5 of 5 · a starting line for lumi/i)).toBeDefined();
    });
    expect(screen.queryByTestId('finalize-gate')).toBeNull();
  });

  it('shows the summary subtitle in the summary moment', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      mockSummary({ required_set_complete: true }),
    ) as unknown as typeof fetch;

    renderOnboarding();
    sendText('all set');

    await waitFor(() => {
      expect(screen.getByText(/summary · lock in your kitchen/i)).toBeDefined();
    });
  });
});
