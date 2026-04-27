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

    expect(screen.getByText(/grandmother cook/i)).toBeDefined();
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

    // Optimistic user turn rendered immediately
    await waitFor(() => {
      expect(screen.getByText(/Grandma made dal every Sunday/)).toBeDefined();
    });
    expect(textarea.disabled).toBe(true);

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
    // User turn still rendered
    expect(screen.getByText(/Sometimes she made roti/)).toBeDefined();
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
});
