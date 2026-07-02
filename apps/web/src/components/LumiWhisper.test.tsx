import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import { LumiWhisper } from './LumiWhisper.js';

const nudgeTurn: Turn = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  thread_id: '11111111-1111-4111-8111-111111111111',
  server_seq: 1,
  created_at: '2026-06-29T00:00:00.000Z',
  role: 'lumi',
  body: { type: 'message', content: 'Your plan has been updated for next week.' },
};

const nonMessageTurn: Turn = {
  ...nudgeTurn,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  body: { type: 'system_event', event: 'plan_started' } as Turn['body'],
};

describe('LumiWhisper', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  // The container is always mounted (so the aria-live region exists before
  // content changes). In non-whisper states it renders as sr-only with no content.
  it('is mounted but sr-only with no content when presenceState is atRest', () => {
    useLumiStore.setState({ presenceState: 'atRest', pendingNudge: nudgeTurn });
    const { container } = render(<LumiWhisper />);

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.className).toContain('sr-only');
    expect(screen.queryByText('Your plan has been updated for next week.')).toBeNull();
  });

  it('is mounted but sr-only with no content when presenceState is summoned', () => {
    useLumiStore.setState({ presenceState: 'summoned', pendingNudge: nudgeTurn });
    const { container } = render(<LumiWhisper />);

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.className).toContain('sr-only');
    expect(screen.queryByText('Your plan has been updated for next week.')).toBeNull();
  });

  it('is mounted but sr-only with no content when whisper state but no pendingNudge', () => {
    useLumiStore.getState().whisper();
    const { container } = render(<LumiWhisper />);

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.className).toContain('sr-only');
  });

  it('renders the nudge text when presenceState is whisper with a pending message nudge', () => {
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    render(<LumiWhisper />);

    expect(screen.getByText('Your plan has been updated for next week.')).not.toBeNull();
  });

  it('renders generic text when the nudge body is not a message type', () => {
    useLumiStore.getState().setNudge(nonMessageTurn);
    useLumiStore.getState().whisper();
    render(<LumiWhisper />);

    expect(screen.getByText('Lumi has an update')).not.toBeNull();
  });

  it('has role="status", aria-live="polite", aria-atomic="true" so screen readers announce it', () => {
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    const { container } = render(<LumiWhisper />);

    const widget = container.querySelector('[role="status"]');
    expect(widget).not.toBeNull();
    expect(widget!.getAttribute('aria-live')).toBe('polite');
    expect(widget!.getAttribute('aria-atomic')).toBe('true');
  });

  it('Dismiss: atomically clears the nudge and recedes to atRest (dismissNudge)', () => {
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    render(<LumiWhisper />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss nudge/i }));

    const s = useLumiStore.getState();
    expect(s.pendingNudge).toBeNull();
    expect(s.presenceState).toBe('atRest');
  });

  it('See why: opens the summoned sheet (clears nudge + sets presenceState to summoned)', () => {
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    render(<LumiWhisper />);

    fireEvent.click(screen.getByRole('button', { name: /see why lumi sent this nudge/i }));

    const s = useLumiStore.getState();
    expect(s.presenceState).toBe('summoned');
    expect(s.pendingNudge).toBeNull();
  });

  it('includes reduced-motion class on the wrapper when visible (AC3)', () => {
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    const { container } = render(<LumiWhisper />);

    const wrapper = container.querySelector('[role="status"]');
    expect(wrapper!.className).toContain('motion-reduce:animate-none');
  });

  it('auto-dismisses after 10 seconds', () => {
    vi.useFakeTimers();
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    render(<LumiWhisper />);

    act(() => { vi.advanceTimersByTime(10_000); });

    const s = useLumiStore.getState();
    expect(s.pendingNudge).toBeNull();
    expect(s.presenceState).toBe('atRest');
    vi.useRealTimers();
  });

  it('timer resets on mouseenter — nudge does not dismiss if hovered', () => {
    vi.useFakeTimers();
    useLumiStore.getState().setNudge(nudgeTurn);
    useLumiStore.getState().whisper();
    const { container } = render(<LumiWhisper />);

    // Advance 8 s then hover — should clear the in-progress timer
    act(() => { vi.advanceTimersByTime(8_000); });
    fireEvent.mouseEnter(container.querySelector('[role="status"]')!);

    // Timer was cleared; advancing another 5 s should NOT dismiss
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(useLumiStore.getState().presenceState).toBe('whisper');
    vi.useRealTimers();
  });
});
