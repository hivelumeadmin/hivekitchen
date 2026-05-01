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

  it('text input is rendered but disabled (stub for Story 12.10)', () => {
    useLumiStore.getState().openPanel();
    render(<LumiPanel />);

    const input = screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it('voice mode shows the "tap orb to end" hint and keeps input disabled', () => {
    useLumiStore.getState().openPanel('voice');
    render(<LumiPanel />);

    expect(screen.getByText(/tap the orb to end voice session/i)).toBeDefined();
    expect((screen.getByLabelText(/ask lumi/i) as HTMLTextAreaElement).disabled).toBe(true);
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
});

