import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import { LumiPanel } from './LumiPanel.js';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';

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

describe('LumiPanel', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('returns null when the panel is closed', () => {
    const { container } = render(<LumiPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders panel chrome (label + dismiss) when the panel is open', () => {
    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    expect(screen.getByRole('complementary', { name: /lumi panel/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /close lumi panel/i })).toBeDefined();
  });

  it('dismiss button calls closePanel via the store', () => {
    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    fireEvent.click(screen.getByRole('button', { name: /close lumi panel/i }));

    expect(useLumiStore.getState().isPanelOpen).toBe(false);
  });

  it('renders message turns with sender label and body content', () => {
    useLumiStore.setState({
      isPanelOpen: true,
      turns: [
        turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hello there', 'user'),
        turn('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Hi back', 'lumi'),
      ],
    });
    render(<LumiPanel />);

    expect(screen.getByText('Hello there')).toBeDefined();
    expect(screen.getByText('Hi back')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
    // Two "Lumi" labels expected: the panel chrome header + the sender label on the lumi turn.
    expect(screen.getAllByText('Lumi')).toHaveLength(2);
  });

  it('caps the rendered turns at the most recent 8 (newest at the bottom)', () => {
    const turns: Turn[] = Array.from({ length: 12 }, (_, i) =>
      turn(`turn-${i}-id-pad-pad-pad-pad-pad-pad-${i.toString().padStart(2, '0')}`, `msg-${i}`),
    );
    // Use unique UUID-shaped IDs so React keys remain unique.
    const validTurns = turns.map((t, i) => ({
      ...t,
      id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
    }));

    useLumiStore.setState({ isPanelOpen: true, turns: validTurns });
    render(<LumiPanel />);

    expect(screen.queryByText('msg-0')).toBeNull();
    expect(screen.queryByText('msg-3')).toBeNull();
    expect(screen.getByText('msg-4')).toBeDefined();
    expect(screen.getByText('msg-11')).toBeDefined();
  });

  it('shows the loading state while hydrating with no turns', () => {
    useLumiStore.setState({ isPanelOpen: true, isHydrating: true, turns: [] });
    render(<LumiPanel />);

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/catching up with lumi/i)).toBeDefined();
  });

  it('text input is enabled (composer wired in Story 12-S8)', () => {
    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
  });

  it('voice mode shows the "tap orb to end" hint and leaves the composer usable', () => {
    useLumiStore.getState().openPanel('voice');
    render(<LumiPanel />);

    expect(screen.getByText(/tap the orb to end voice session/i)).toBeDefined();
    expect((screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('renders voiceError as an alert when set', () => {
    useLumiStore.getState().openPanel('voice');
    useLumiStore.getState().setVoiceError('mic blocked');
    render(<LumiPanel />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('mic blocked');
  });

  it('hydrates the thread on open when threadId is known and turns are empty', async () => {
    useLumiStore.setState({
      surface: 'planning',
      threadIds: { planning: THREAD_ID },
    });
    const fetched: Turn = turn('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Server hello', 'lumi');
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ thread_id: THREAD_ID, turns: [fetched] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    await waitFor(() => {
      expect(screen.getByText('Server hello')).toBeDefined();
    });
    expect(useLumiStore.getState().isHydrating).toBe(false);
    expect(useLumiStore.getState().turns).toHaveLength(1);
  });

  it('does not call fetch when threadIds[surface] is undefined', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call fetch when turns are already present', () => {
    useLumiStore.setState({
      surface: 'planning',
      threadIds: { planning: THREAD_ID },
      turns: [turn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cached', 'user')],
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resets isHydrating on fetch failure', async () => {
    useLumiStore.setState({
      surface: 'planning',
      threadIds: { planning: THREAD_ID },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: '/errors/upstream', status: 502 }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(false);
    });
    expect(useLumiStore.getState().turns).toEqual([]);
    warnSpy.mockRestore();
  });

  it('submitting a message POSTs to /v1/lumi/turns with the message and context signal', async () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(makeTurnResponse()));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<LumiPanel />);
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
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeTurnResponse('Hello Lumi', 'Got it.'))) as unknown as typeof fetch;

    render(<LumiPanel />);
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'Hello Lumi' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Hello Lumi')).toBeDefined();
      expect(screen.getByText('Got it.')).toBeDefined();
    });
  });

  it('pins threadIds[surface] from the response after the first submit', async () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeTurnResponse())) as unknown as typeof fetch;

    render(<LumiPanel />);
    const input = screen.getByLabelText(/ask lumi/i);
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(useLumiStore.getState().threadIds.planning).toBe(THREAD_ID);
    });
  });

  it('on a failed send, restores the draft and shows an inline error', async () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: '/errors/upstream', status: 502 }, 502)) as unknown as typeof fetch;

    render(<LumiPanel />);
    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'will fail' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain("couldn't send");
    // The draft is preserved so the user can retry or edit.
    expect(input.value).toBe('will fail');
  });

  it('disables the composer while a send is in flight (prevents double-send)', async () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.fn().mockReturnValue(pending);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<LumiPanel />);
    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(input.disabled).toBe(true));

    // A second submit while the first is in flight must not fire another request.
    fireEvent.submit(input.closest('form')!);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(makeTurnResponse()));
    await waitFor(() => expect(input.disabled).toBe(false));
  });
});

