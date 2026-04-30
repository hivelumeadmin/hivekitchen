import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AddChildForm } from './AddChildForm.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';

const originalFetch = globalThis.fetch;

function mockSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      child: {
        id: CHILD_ID,
        household_id: HOUSEHOLD_ID,
        name: 'Asha',
        age_band: 'child',
        school_policy_notes: null,
        declared_allergens: ['peanut'],
        cultural_identifiers: [],
        dietary_preferences: [],
        allergen_rule_version: 'v1',
        bag_composition: { main: true, snack: true, extra: true },
        created_at: '2026-04-28T10:00:00.000Z',
      },
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockProblemResponse(status: number, type: string): Response {
  return new Response(
    JSON.stringify({ type, status, title: 'Forbidden', detail: 'gate' }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

describe('AddChildForm', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setup() {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    const onParentalNoticeRequired = vi.fn();
    render(
      <AddChildForm
        householdId={HOUSEHOLD_ID}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onParentalNoticeRequired={onParentalNoticeRequired}
      />,
    );
    return { onSuccess, onCancel, onParentalNoticeRequired };
  }

  it('renders all primary fields', () => {
    setup();
    expect(screen.getByLabelText(/name/i)).toBeDefined();
    expect(screen.getByLabelText(/age band/i)).toBeDefined();
    expect(screen.getByLabelText(/declared allergens/i)).toBeDefined();
    expect(screen.getByLabelText(/cultural identifiers/i)).toBeDefined();
    expect(screen.getByLabelText(/dietary preferences/i)).toBeDefined();
    expect(screen.getByLabelText(/school food-policy notes/i)).toBeDefined();
  });

  it('tag chip input — Enter adds a tag, Backspace on empty input removes the last', () => {
    setup();
    const allergensInput = screen.getByLabelText(/declared allergens/i) as HTMLInputElement;

    fireEvent.change(allergensInput, { target: { value: 'peanut' } });
    fireEvent.keyDown(allergensInput, { key: 'Enter' });
    expect(screen.getByText('peanut')).toBeDefined();

    fireEvent.change(allergensInput, { target: { value: 'shellfish' } });
    fireEvent.keyDown(allergensInput, { key: ',' });
    expect(screen.getByText('shellfish')).toBeDefined();

    fireEvent.keyDown(allergensInput, { key: 'Backspace' });
    expect(screen.queryByText('shellfish')).toBeNull();
    expect(screen.getByText('peanut')).toBeDefined();
  });

  it('client-side validation prevents submit when name is empty', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    setup();

    // Fill age band but leave name empty
    fireEvent.change(screen.getByLabelText(/age band/i), { target: { value: 'child' } });
    fireEvent.submit(screen.getByRole('button', { name: /save child/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBeTruthy();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('successful submit calls onSuccess with the parsed child', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockSuccessResponse()) as unknown as typeof fetch;
    const { onSuccess } = setup();

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Asha' } });
    fireEvent.change(screen.getByLabelText(/age band/i), { target: { value: 'child' } });
    fireEvent.submit(screen.getByRole('button', { name: /save child/i }).closest('form')!);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    const child = onSuccess.mock.calls[0]![0] as { id: string; name: string };
    expect(child.id).toBe(CHILD_ID);
    expect(child.name).toBe('Asha');
  });

  it('403 parental-notice-required calls onParentalNoticeRequired (not onSuccess)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockProblemResponse(403, '/errors/parental-notice-required'),
      ) as unknown as typeof fetch;
    const { onSuccess, onParentalNoticeRequired } = setup();

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Asha' } });
    fireEvent.change(screen.getByLabelText(/age band/i), { target: { value: 'child' } });
    fireEvent.submit(screen.getByRole('button', { name: /save child/i }).closest('form')!);

    await waitFor(() => {
      expect(onParentalNoticeRequired).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
