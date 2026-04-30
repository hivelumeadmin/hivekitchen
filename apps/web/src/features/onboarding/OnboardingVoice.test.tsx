import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OnboardingVoice } from './OnboardingVoice.js';
import type { UseVoiceSessionResult } from '@/hooks/useVoiceSession.js';

// Mock the entire hook — its internals (VAD, WebSocket, audio) are tested at
// a lower level; here we only care about how the component renders each state.
vi.mock('@/hooks/useVoiceSession.js', () => ({
  useVoiceSession: vi.fn(),
}));

import { useVoiceSession } from '@/hooks/useVoiceSession.js';

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();

function setHookState(
  status: UseVoiceSessionResult['status'],
  errorMessage: string | null = null,
): {
  capturedOnError: { current: ((message: string) => void) | undefined };
} {
  const capturedOnError: { current: ((message: string) => void) | undefined } = {
    current: undefined,
  };
  vi.mocked(useVoiceSession).mockImplementation((opts) => {
    capturedOnError.current = opts.onError;
    return {
      status,
      transcriptLines: [],
      lumiLines: [],
      errorMessage,
      start: mockStart,
      stop: mockStop,
    };
  });
  return { capturedOnError };
}

describe('OnboardingVoice', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows "Connecting…" status text while connecting', () => {
    setHookState('connecting');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByText(/connecting/i)).toBeDefined();
  });

  it('shows "Listening…" when session is ready', () => {
    setHookState('ready');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByText(/listening/i)).toBeDefined();
  });

  it('shows amber orb and "Lumi is speaking" text while TTS plays', () => {
    setHookState('speaking');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    const orb = screen.getByRole('img', { name: /lumi is speaking/i });
    expect(orb).toBeDefined();
    expect(orb.className).toContain('bg-amber-500');
    expect(screen.getByText(/lumi is speaking/i)).toBeDefined();
  });

  it('shows "Thinking…" text while processing', () => {
    setHookState('processing');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByText(/thinking/i)).toBeDefined();
  });

  it('shows error message when status is error', () => {
    setHookState('error', 'Could not connect to voice service');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByText(/could not connect to voice service/i)).toBeDefined();
  });

  it('shows fallback text when status is error but errorMessage is null', () => {
    setHookState('error', null);
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it('renders "End session" button visible in all non-error states', () => {
    setHookState('ready');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(screen.getByRole('button', { name: /end session/i })).toBeDefined();
  });

  it('"End session" button calls stop()', () => {
    setHookState('ready');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('orb has neutral colour and "Listening" aria-label when not speaking', () => {
    setHookState('ready');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    const orb = screen.getByRole('img', { name: /listening/i });
    expect(orb).toBeDefined();
    expect(orb.className).toContain('bg-stone-200');
    expect(orb.className).not.toContain('bg-amber-500');
  });

  it('calls start() on mount', () => {
    setHookState('connecting');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(mockStart).toHaveBeenCalledOnce();
  });

  it('forwards hook errors to the onError prop', () => {
    const { capturedOnError } = setHookState('connecting');
    const onError = vi.fn();
    render(<OnboardingVoice onComplete={vi.fn()} onError={onError} />);

    capturedOnError.current?.('Microphone permission denied');

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('Microphone permission denied');
  });

  it('does not throw when onError prop is omitted and hook reports an error', () => {
    const { capturedOnError } = setHookState('connecting');
    render(<OnboardingVoice onComplete={vi.fn()} />);

    expect(() => capturedOnError.current?.('boom')).not.toThrow();
  });
});
