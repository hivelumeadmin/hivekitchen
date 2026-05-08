import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BagCompositionForm } from './BagCompositionForm.js';

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

describe('BagCompositionForm', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup(initialSnack: boolean, initialExtra: boolean) {
    render(
      <BagCompositionForm
        childId={CHILD_ID}
        childName="Asha"
        initialSnack={initialSnack}
        initialExtra={initialExtra}
      />,
    );
  }

  it('pre-selects the supplied initial values', () => {
    setup(false, true);
    const snack = screen.getByLabelText(/snack/i) as HTMLInputElement;
    const extra = screen.getByLabelText(/extra/i) as HTMLInputElement;
    expect(snack.checked).toBe(false);
    expect(extra.checked).toBe(true);
  });

  it('Save sends the toggled composition without a `main` key on the wire', async () => {
    const captured: CapturedRequest = { url: '', init: undefined };
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return Promise.resolve(mockSavedResponse(false, true));
    }) as unknown as typeof fetch;

    setup(true, true);
    fireEvent.click(screen.getByLabelText(/snack/i));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/saved/i);
    });
    expect(captured.url).toContain(`/v1/children/${CHILD_ID}/bag-composition`);
    expect(captured.init?.method).toBe('PATCH');
    const sentBody = JSON.parse(captured.init?.body as string) as Record<string, unknown>;
    expect(sentBody).toEqual({ snack: false, extra: true });
  });

  it('Save button is disabled while a request is in-flight', async () => {
    let resolveRequest!: (r: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    ) as unknown as typeof fetch;

    setup(true, true);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement).disabled).toBe(
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

    setup(true, true);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
