import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { FamilyLanguageTerm } from '@hivekitchen/types';
import { FamilyLanguageRatificationCard } from './FamilyLanguageRatificationCard.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

function activeTerm(): FamilyLanguageTerm {
  return {
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: 'active',
    first_seen_at: '2026-06-08T10:00:00.000Z',
    ratified_at: '2026-06-08T10:05:00.000Z',
  };
}

const originalFetch = globalThis.fetch;

function mockOkResponse(action: 'opt_in' | 'forget' | 'tell_lumi_more'): Response {
  const body: { term: FamilyLanguageTerm; lumi_response?: string } = {
    term: { ...activeTerm(), state: action === 'forget' ? 'forgotten' : action === 'opt_in' ? 'active' : 'candidate' },
  };
  if (action === 'tell_lumi_more') {
    body.lumi_response = "Tell me — what should I call them, and I'll use your word.";
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FamilyLanguageRatificationCard', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup() {
    const onResolved = vi.fn();
    render(
      <FamilyLanguageRatificationCard
        term="Nani"
        maps_to="grandmother"
        householdId={HOUSEHOLD_ID}
        onResolved={onResolved}
      />,
    );
    return { onResolved };
  }

  it('renders the term in the heading and the three pills with exact copy', () => {
    setup();
    expect(screen.getByText(/I noticed you call them/i)).toBeDefined();
    // The term word is sacred-plum tinted.
    const termWord = screen.getByText('Nani');
    expect(termWord.className).toContain('text-sacred-700');
    expect(screen.getByRole('button', { name: /yes, keep it in mind/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /not quite — tell Lumi more/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /not for us/i })).toBeDefined();
  });

  it('opt_in tap PATCHes with action=opt_in and calls onResolved on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('opt_in')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /yes, keep it in mind/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      term: 'Nani',
      action: 'opt_in',
    });
  });

  it('tell_lumi_more renders the returned lumi_response inline and does NOT resolve', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('tell_lumi_more')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /not quite — tell Lumi more/i }));

    await waitFor(() => {
      expect(screen.getByText(/what should I call them/i)).toBeDefined();
    });
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('forget tap calls onResolved on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockOkResponse('forget')) as unknown as typeof fetch;
    const { onResolved } = setup();

    fireEvent.click(screen.getByRole('button', { name: /not for us/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
  });
});
