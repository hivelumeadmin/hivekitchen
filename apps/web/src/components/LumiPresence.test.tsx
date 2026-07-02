import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import { VoiceSessionContext } from '@/contexts/VoiceSessionContext.js';
import { LumiPresence } from './LumiPresence.js';

const fakeTurn: Turn = {
  id: '00000000-0000-4000-8000-000000000001',
  thread_id: '00000000-0000-4000-8000-000000000000',
  server_seq: 1,
  created_at: '2026-04-30T00:00:00.000Z',
  role: 'lumi',
  body: { type: 'message', content: 'hi' },
};

let queryClient: QueryClient;

function renderPresence(
  endSession: () => Promise<void> = async () => {},
  startSession: (sig: never) => Promise<void> = async () => {},
): ReturnType<typeof render> {
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <VoiceSessionContext.Provider value={{ startSession: startSession as never, endSession }}>
        <LumiPresence />
      </VoiceSessionContext.Provider>
    </QueryClientProvider>
  );
  return render(ui);
}

describe('LumiPresence (valet dot)', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an accessible dot labeled "Open Lumi" at rest, with aria-controls', () => {
    renderPresence();

    const dot = screen.getByRole('button', { name: /open lumi/i });
    expect(dot.getAttribute('aria-expanded')).toBe('false');
    expect(dot.getAttribute('aria-controls')).toBe('lumi-sheet');
  });

  it('tapping the dot summons the sheet via the store', () => {
    renderPresence();

    fireEvent.click(screen.getByRole('button', { name: /open lumi/i }));

    expect(useLumiStore.getState().presenceState).toBe('summoned');
  });

  it('relabels to "Lumi is open" and recedes when tapped while summoned', () => {
    useLumiStore.getState().summon();
    renderPresence();

    const dot = screen.getByRole('button', { name: /lumi is open/i });
    expect(dot.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(dot);

    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('breathes a quiet pulse when a nudge is pending (12-S12 AC#4), motion-reduce safe', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    renderPresence();

    const dot = screen.getByRole('button', { name: /open lumi/i });
    expect(dot.className).toContain('animate-pulse');
    expect(dot.className).toContain('motion-reduce:animate-none');
  });

  it('is calm (no pulse) at rest with no pending nudge', () => {
    renderPresence();

    const dot = screen.getByRole('button', { name: /open lumi/i });
    expect(dot.className).not.toContain('animate-pulse');
    // The transition still collapses to none under reduced motion (13-s1 AC4 gate).
    expect(dot.className).toContain('motion-reduce:transition-none');
  });

  it('does not breathe while summoned even with a pending nudge (the sheet is the focus)', () => {
    useLumiStore.setState({ presenceState: 'summoned', pendingNudge: fakeTurn });
    renderPresence();

    const dot = screen.getByRole('button', { name: /lumi is open/i });
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('does not breathe while whispering — the whisper line is the nudge surface (13-s3 AC4)', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    useLumiStore.getState().whisper();
    renderPresence();

    // Dot is still visible in whisper state but without the breath animation
    const dot = screen.getByRole('button', { name: /open lumi/i });
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('renders LumiWhisper when presenceState is whisper with a pending nudge (13-s3 AC4)', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    useLumiStore.getState().whisper();
    renderPresence();

    // LumiWhisper renders the nudge text 'hi'
    expect(screen.getByText('hi')).not.toBeNull();
  });

  it('shows the voice-active ping overlay (not on the button itself) when voice is active', () => {
    useLumiStore.getState().setVoiceStatus('active');
    const { container } = renderPresence();

    const dot = screen.getByRole('button');
    expect(dot.className).not.toContain('animate-ping');
    const overlay = container.querySelector('button > span[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain('animate-ping');
    expect(overlay!.className).toContain('motion-reduce:animate-none');
  });

  it('when voice is active, dot is labeled "End voice session" and tapping it ends the session', () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    useLumiStore.getState().setVoiceStatus('active');

    renderPresence(endSession);

    // aria-label reflects the action correctly (AC2 + P1 fix).
    const dot = screen.getByRole('button', { name: /end voice session/i });
    fireEvent.click(dot);

    expect(endSession).toHaveBeenCalledTimes(1);
    // endSession handles teardown; the tap does not summon the sheet.
    expect(useLumiStore.getState().presenceState).toBe('atRest');
  });

  it('renders the thinking pulse when lumiThinking is true, static under reduced motion', () => {
    useLumiStore.getState().setLumiThinking(true);
    const { container } = renderPresence();

    const pulse = container.querySelector('[data-testid="lumi-thinking-pulse"]');
    expect(pulse).not.toBeNull();
    expect(pulse!.className).toContain('animate-pulse');
    expect(pulse!.className).toContain('motion-reduce:animate-none');
    expect(pulse!.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not render the thinking pulse when lumiThinking is false', () => {
    useLumiStore.getState().setNudge(fakeTurn);
    const { container } = renderPresence();

    expect(container.querySelector('[data-testid="lumi-thinking-pulse"]')).toBeNull();
  });

  it('restores focus to the dot when the summoned sheet closes (AC8)', () => {
    renderPresence();

    // Focus the dot before clicking — Dialog.tsx records document.activeElement at
    // open time as the restore target; jsdom does not auto-focus on fireEvent.click.
    const dot = screen.getByRole('button', { name: /open lumi/i });
    dot.focus();
    fireEvent.click(dot);
    expect(useLumiStore.getState().presenceState).toBe('summoned');

    // Close via Escape — Dialog.tsx restores focus to the previously-focused element.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useLumiStore.getState().presenceState).toBe('atRest');
    expect(document.activeElement).toBe(dot);
  });
});
