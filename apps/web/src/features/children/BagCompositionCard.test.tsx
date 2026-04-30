import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BagCompositionCard } from './BagCompositionCard.js';

const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function mockSavedResponse(snack: boolean, extra: boolean): Response {
  return new Response(
    JSON.stringify({
      child: {
        id: CHILD_ID,
        household_id: HOUSEHOLD_ID,
        name: 'Asha',
        age_band: 'child',
        school_policy_notes: null,
        declared_allergens: [],
        cultural_identifiers: [],
        dietary_preferences: [],
        allergen_rule_version: 'v1',
        bag_composition: { main: true, snack, extra },
        created_at: '2026-04-28T10:00:00.000Z',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('BagCompositionCard', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup() {
    const onSaved = vi.fn();
    const onSkip = vi.fn();
    render(
      <BagCompositionCard
        childId={CHILD_ID}
        childName="Asha"
        onSaved={onSaved}
        onSkip={onSkip}
      />,
    );
    return { onSaved, onSkip };
  }

  it('renders Main as locked, Snack on, Extra on by default', () => {
    setup();
    expect(screen.getByText("How does Asha's lunch bag look?")).toBeDefined();
    expect(screen.getByText('Main')).toBeDefined();
    expect(screen.getByText('Always included')).toBeDefined();
    expect(screen.getByText('Locked')).toBeDefined();
    const snack = screen.getByLabelText(/snack/i) as HTMLInputElement;
    const extra = screen.getByLabelText(/extra/i) as HTMLInputElement;
    expect(snack.checked).toBe(true);
    expect(extra.checked).toBe(true);
  });

  it('Skip closes immediately without making an API call', () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { onSaved, onSkip } = setup();
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Save with snack off and extra on calls onSaved with the updated child', async () => {
    const captured: CapturedRequest = { url: '', init: undefined };
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return Promise.resolve(mockSavedResponse(false, true));
    }) as unknown as typeof fetch;

    const { onSaved, onSkip } = setup();
    fireEvent.click(screen.getByLabelText(/snack/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(onSkip).not.toHaveBeenCalled();
    const child = onSaved.mock.calls[0]![0] as {
      id: string;
      bag_composition: { main: boolean; snack: boolean; extra: boolean };
    };
    expect(child.id).toBe(CHILD_ID);
    expect(child.bag_composition).toEqual({ main: true, snack: false, extra: true });

    expect(captured.url).toContain(`/v1/children/${CHILD_ID}/bag-composition`);
    expect(captured.init?.method).toBe('PATCH');
    const sentBody = JSON.parse(captured.init?.body as string) as Record<string, unknown>;
    // The hook must never put `main` on the wire — it is a server-side invariant.
    expect(sentBody).toEqual({ snack: false, extra: true });
  });

  it('Save and Skip buttons are disabled while a request is in-flight', async () => {
    let resolveRequest!: (r: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    ) as unknown as typeof fetch;

    setup();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect((screen.getByRole('button', { name: /skip/i }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    resolveRequest(mockSavedResponse(true, true));
  });

  it('renders an error message when the API rejects the save', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ type: '/errors/forbidden', status: 403, title: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    ) as unknown as typeof fetch;

    const { onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('renders an error message when the fetch promise rejects (network failure)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const { onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('renders an error message when the API returns a malformed success response (ZodError path)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ child: { id: 'not-a-uuid' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const { onSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
