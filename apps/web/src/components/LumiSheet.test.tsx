import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { VoiceSessionContext } from '@/contexts/VoiceSessionContext.js';
import { LumiSheet } from './LumiSheet.js';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';

let queryClient: QueryClient;
function renderSheet(ui: ReactElement = <LumiSheet />) {
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function turn(id: string, text: string, role: 'user' | 'lumi' = 'user'): Turn {
  return {
    id,
    thread_id: THREAD_ID,
    server_seq: 1,
    created_at: '2026-04-30T00:00:00.000Z',
    role,
    body: { type: 'message', content: text },
  };
}

function makeTurnResponse(userText = 'hi', lumiText = 'Got it.') {
  return {
    thread_id: THREAD_ID,
    user_turn: turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userText, 'user'),
    lumi_turn: turn('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lumiText, 'lumi'),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

describe('LumiSheet (summoned valet sheet)', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
    useAuthStore.setState({ user: null, accessToken: null });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ── Presence lifecycle ────────────────────────────────────────────────────

  it('renders nothing when at rest', () => {
    renderSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a focus-trapped dialog named "Lumi" with a close button when summoned', () => {
    useLumiStore.getState().summon();
    renderSheet();

    const dialog = screen.getByRole('dialog', { name: /lumi/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('id')).toBe('lumi-sheet');
    expect(screen.getByRole('button', { name: /close lumi/i })).toBeDefined();
  });

  it('Escape recedes the sheet (Epic 13-s2 improvement — Escape now closes)', () => {
    useLumiStore.getState().summon();
    renderSheet();
    expect(screen.getByRole('dialog', { name: /lumi/i })).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useLumiStore.getState().presenceState).toBe('atRest');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the close button recedes the sheet', () => {
    useLumiStore.getState().summon();
    renderSheet();

    fireEvent.click(screen.getByRole('button', { name: /close lumi/i }));

    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('clicking the scrim recedes the sheet', () => {
    useLumiStore.getState().summon();
    renderSheet();

    const scrim = document.querySelector('[aria-hidden="true"]')!;
    fireEvent.click(scrim);

    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('moves focus into the sheet when summoned', () => {
    useLumiStore.getState().summon();
    renderSheet();

    // Epic 13-s11 — the mode toggle moved into the shared <LumiConversation>, so
    // the close button is now the first focusable in the header. What matters for
    // the focus-trap contract is that focus lands inside the dialog.
    const dialog = screen.getByRole('dialog', { name: /lumi/i });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /close lumi/i }));
  });

  // ── Turn rendering ─────────────────────────────────────────────────────────

  it('renders message turns with sender label and body content', () => {
    useLumiStore.setState({
      presenceState: 'summoned',
      turns: [
        turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hello there', 'user'),
        turn('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Hi back', 'lumi'),
      ],
    });
    renderSheet();

    expect(screen.getByText('Hello there')).toBeDefined();
    expect(screen.getByText('Hi back')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
    // Two "Lumi" labels: the sheet title + the sender label on the lumi turn.
    expect(screen.getAllByText('Lumi')).toHaveLength(2);
  });

  it('caps the rendered turns at the most recent 8', () => {
    const validTurns: Turn[] = Array.from({ length: 12 }, (_, i) =>
      turn(`00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`, `msg-${i}`),
    );
    useLumiStore.setState({ presenceState: 'summoned', turns: validTurns });
    renderSheet();

    expect(screen.queryByText('msg-3')).toBeNull();
    expect(screen.getByText('msg-4')).toBeDefined();
    expect(screen.getByText('msg-11')).toBeDefined();
  });

  it('shows the loading state while hydrating with no turns', () => {
    useLumiStore.setState({ presenceState: 'summoned', isHydrating: true, turns: [] });
    renderSheet();

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/catching up with lumi/i)).toBeDefined();
  });

  // ── Hydration on summon ────────────────────────────────────────────────────

  it('hydrates the thread on summon when threadId is known and turns are empty', async () => {
    useLumiStore.setState({ surface: 'planning', threadIds: { planning: THREAD_ID } });
    const fetched: Turn = turn('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Server hello', 'lumi');
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ thread_id: THREAD_ID, turns: [fetched] }),
    ) as unknown as typeof fetch;

    useLumiStore.getState().summon();
    renderSheet();

    await waitFor(() => expect(screen.getByText('Server hello')).toBeDefined());
    expect(useLumiStore.getState().isHydrating).toBe(false);
  });

  it('does not call fetch when threadIds[surface] is undefined', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    useLumiStore.getState().summon();
    renderSheet();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Composer / turn submission ─────────────────────────────────────────────

  it('submitting POSTs to /v1/lumi/turns with the message and context signal', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(makeTurnResponse()));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'hello lumi' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/lumi/turns');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'hello lumi',
      context_signal: { surface: 'planning' },
    });
  });

  it('appends both the user turn and the Lumi reply after a successful submit', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeTurnResponse('Hello Lumi', 'Got it.'))) as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'Hello Lumi' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Hello Lumi')).toBeDefined();
      expect(screen.getByText('Got it.')).toBeDefined();
    });
  });

  it('pins threadIds[surface] from the response after the first submit', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeTurnResponse())) as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(useLumiStore.getState().threadIds.planning).toBe(THREAD_ID));
  });

  it('on a failed send, restores the draft and shows an inline error', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: '/errors/upstream', status: 502 }, 502)) as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'will fail' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain("couldn't send");
    expect(input.value).toBe('will fail');
  });

  it('disables the composer while a send is in flight (prevents double-send)', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.fn().mockReturnValue(pending);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(input.disabled).toBe(true));
    fireEvent.submit(input.closest('form')!);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(makeTurnResponse()));
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  // ── Voice (5-S5) ───────────────────────────────────────────────────────────

  it('mode toggle renders Text and Voice buttons when summoned', () => {
    useLumiStore.getState().summon();
    renderSheet();

    expect(screen.getByRole('button', { name: /text mode/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /voice mode/i })).toBeDefined();
  });

  it('clicking Voice when idle calls startSession via context', () => {
    const startSession = vi.fn().mockResolvedValue(undefined);
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });

    renderSheet(
      <VoiceSessionContext.Provider value={{ startSession, endSession: async () => {} }}>
        <LumiSheet />
      </VoiceSessionContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /voice mode/i }));

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ surface: 'planning' }));
  });

  it('renders voiceError as an alert when set', () => {
    useLumiStore.getState().summon();
    useLumiStore.getState().setVoiceError('mic blocked');
    renderSheet();

    expect(screen.getByRole('alert').textContent).toContain('mic blocked');
  });

  it('"Listening…" hint renders when voiceStatus is active', () => {
    useLumiStore.setState({ presenceState: 'summoned', voiceStatus: 'active' });
    renderSheet();

    expect(screen.getByText(/listening/i)).toBeDefined();
  });

  // ── Captions (5-S13) ───────────────────────────────────────────────────────

  it('renders the CaptionRibbon when voiceStatus is active and captions are present', () => {
    useLumiStore.setState({
      presenceState: 'summoned',
      voiceStatus: 'active',
      captionTranscript: 'pasta please',
      captionLumiReply: 'On it — pasta Tuesday.',
    });
    renderSheet();

    expect(screen.getByRole('region', { name: /voice captions/i })).toBeDefined();
    expect(screen.getByText('pasta please')).toBeDefined();
  });

  it('clears captions and unmounts the ribbon when the voice session ends', () => {
    useLumiStore.setState({
      presenceState: 'summoned',
      voiceStatus: 'active',
      captionTranscript: 'pasta please',
      captionLumiReply: 'On it.',
    });
    renderSheet();
    expect(screen.getByRole('region', { name: /voice captions/i })).toBeDefined();

    act(() => {
      useLumiStore.getState().endTalkSession();
    });

    expect(screen.queryByRole('region', { name: /voice captions/i })).toBeNull();
  });

  // ── Proactive-nudge opt-out (12-S12) ───────────────────────────────────────

  it('renders "Pause nudges" when proactiveNudges is true', () => {
    useLumiStore.setState({ presenceState: 'summoned', proactiveNudges: true });
    renderSheet();

    expect(screen.getByRole('button', { name: /pause nudges/i })).toBeDefined();
  });

  it('clicking the toggle PATCHes notifications with the flipped value and updates the store', async () => {
    useLumiStore.setState({ presenceState: 'summoned', proactiveNudges: true });
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /pause nudges/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/users/me/notifications');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ proactive_lumi_nudges: false });
    expect(useLumiStore.getState().proactiveNudges).toBe(false);
  });

  it('reverts the optimistic toggle when the PATCH fails', async () => {
    useLumiStore.setState({ presenceState: 'summoned', proactiveNudges: true });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: '/errors/upstream', status: 502 }, 502)) as unknown as typeof fetch;

    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /pause nudges/i }));

    await waitFor(() => expect(useLumiStore.getState().proactiveNudges).toBe(true));
  });

  // ── Family-language ratification (5-S10) ───────────────────────────────────

  function familyLanguageTurn(id: string): Turn {
    return {
      id,
      thread_id: THREAD_ID,
      server_seq: 3,
      created_at: '2026-06-08T00:00:00.000Z',
      role: 'lumi',
      body: { type: 'family_language_prompt', term: 'Nani', maps_to: 'grandmother' },
    };
  }

  it('renders a family_language_prompt turn as the ratification card', () => {
    useLumiStore.setState({
      presenceState: 'summoned',
      turns: [familyLanguageTurn('dddddddd-dddd-4ddd-8ddd-dddddddddddd')],
    });
    renderSheet();

    expect(screen.getByText(/I noticed you call them/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /yes, keep it in mind/i })).toBeDefined();
  });

  it('suppresses a persisted family_language_prompt card whose term is already active', async () => {
    const HH = '99999999-9999-4999-8999-999999999999';
    useAuthStore.setState({ user: { current_household_id: HH } as AuthUser });
    useLumiStore.setState({
      presenceState: 'summoned',
      turns: [familyLanguageTurn('ffffffff-ffff-4fff-8fff-ffffffffffff')],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        terms: [
          {
            term: 'Nani',
            maps_to: 'grandmother',
            usage_count: 2,
            state: 'active',
            first_seen_at: '2026-06-08T10:00:00.000Z',
            ratified_at: '2026-06-08T10:05:00.000Z',
          },
        ],
      }),
    ) as unknown as typeof fetch;

    renderSheet();

    await waitFor(() => expect(screen.queryByText(/I noticed you call them/i)).toBeNull());
  });

  it('appends a ratification_turn from the POST response so the card shows', async () => {
    useLumiStore.setState({ presenceState: 'summoned', surface: 'planning' });
    const response = {
      ...makeTurnResponse('I called Nani', 'Lovely.'),
      ratification_turn: familyLanguageTurn('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(response)) as unknown as typeof fetch;

    renderSheet();
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'I called Nani' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByText(/I noticed you call them/i)).toBeDefined());
  });
});
