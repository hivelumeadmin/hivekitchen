import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './use-reduced-motion.js';
import { useReducedTransparency } from './use-reduced-transparency.js';

type ChangeHandler = (e: MediaQueryListEvent) => void;

function makeMockMql(initialMatches: boolean) {
  const handlers: ChangeHandler[] = [];
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((type: string, handler: ChangeHandler) => {
      if (type === 'change') handlers.push(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: ChangeHandler) => {
      if (type === 'change') {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    }),
    __fireChange: (matches: boolean) => {
      mql.matches = matches;
      handlers.forEach((fn) => fn({ matches } as MediaQueryListEvent));
    },
    __listenerCount: () => handlers.length,
  };
  return mql;
}

type MockMql = ReturnType<typeof makeMockMql>;

function installMatchMediaSpy(mql: MockMql): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => mql as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useReducedMotion', () => {
  let motionMql: MockMql;

  beforeEach(() => {
    motionMql = makeMockMql(false);
    installMatchMediaSpy(motionMql);
  });

  it('returns false when OS prefers-reduced-motion is off', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when OS prefers-reduced-motion is on', () => {
    motionMql = makeMockMql(true);
    installMatchMediaSpy(motionMql);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates to true when OS preference changes to reduce-motion', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      motionMql.__fireChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('updates back to false when OS preference reverts', () => {
    motionMql = makeMockMql(true);
    installMatchMediaSpy(motionMql);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    act(() => {
      motionMql.__fireChange(false);
    });

    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    const { unmount } = renderHook(() => useReducedMotion());

    expect(motionMql.__listenerCount()).toBe(1);
    unmount();
    expect(motionMql.__listenerCount()).toBe(0);
  });
});

describe('useReducedTransparency', () => {
  let transparencyMql: MockMql;

  beforeEach(() => {
    transparencyMql = makeMockMql(false);
    installMatchMediaSpy(transparencyMql);
  });

  it('returns false when OS prefers-reduced-transparency is off', () => {
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(false);
  });

  it('returns true when OS prefers-reduced-transparency is on', () => {
    transparencyMql = makeMockMql(true);
    installMatchMediaSpy(transparencyMql);
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(true);
  });

  it('updates to true when OS preference changes to reduce-transparency', () => {
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(false);

    act(() => {
      transparencyMql.__fireChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('updates back to false when OS preference reverts', () => {
    transparencyMql = makeMockMql(true);
    installMatchMediaSpy(transparencyMql);
    const { result } = renderHook(() => useReducedTransparency());
    expect(result.current).toBe(true);

    act(() => {
      transparencyMql.__fireChange(false);
    });

    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    const { unmount } = renderHook(() => useReducedTransparency());

    expect(transparencyMql.__listenerCount()).toBe(1);
    unmount();
    expect(transparencyMql.__listenerCount()).toBe(0);
  });
});
