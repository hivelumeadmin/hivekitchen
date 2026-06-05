import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';

const hkFetchMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init?: unknown) => hkFetchMock(path, init),
  HkApiError: class HkApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly problem: unknown,
    ) {
      super(`HK API error ${status}`);
    }
  },
}));

import { ProvenancePopover } from './ProvenancePopover.js';

const NODE_ID = '00000000-0000-4000-8000-000000000001';

function sampleProvenancePayload(overrides: Record<string, unknown> = {}) {
  return {
    provenance: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        memory_node_id: NODE_ID,
        source_type: 'turn',
        source_ref: {},
        captured_at: '2026-04-21T10:00:00.000Z',
        captured_by: '00000000-0000-4000-8000-000000000003',
        confidence: 0.87,
        superseded_by: null,
        ...overrides,
      },
    ],
  };
}

describe('ProvenancePopover', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the trigger button with aria-label="More options" and aria-expanded=false initially', () => {
    hkFetchMock.mockReturnValue(new Promise(() => undefined));
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    expect(button).toBeDefined();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the popover region when the trigger is clicked and sets aria-expanded=true', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('region')).toBeDefined();
    });
  });

  it('shows loading text while the fetch is in flight', () => {
    hkFetchMock.mockReturnValue(new Promise(() => undefined));
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('renders three disabled action pills (Edit, Forget, Adjust) when ready', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit/i })).toBeDefined();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit (available in a future update)' });
    const forgetBtn = screen.getByRole('button', { name: 'Forget (available in a future update)' });
    const adjustBtn = screen.getByRole('button', { name: 'Adjust (available in a future update)' });
    expect(editBtn.hasAttribute('disabled')).toBe(true);
    expect(forgetBtn.hasAttribute('disabled')).toBe(true);
    expect(adjustBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables the Edit pill and fires onEdit + closes the popover when onEdit is provided (AC1)', async () => {
    const onEdit = vi.fn();
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit this memory' })).toBeDefined();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit this memory' });
    expect(editBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(editBtn);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('enables the Forget pill and fires onForget + closes the popover when onForget is provided (AC1)', async () => {
    const onForget = vi.fn();
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} onForget={onForget} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Forget this memory' })).toBeDefined();
    });

    const forgetBtn = screen.getByRole('button', { name: 'Forget this memory' });
    expect(forgetBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(forgetBtn);

    expect(onForget).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('fetches the provenance endpoint only once across multiple open/close cycles', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(button); // open
    await waitFor(() => expect(screen.getByRole('region')).toBeDefined());
    fireEvent.click(button); // close
    fireEvent.click(button); // re-open

    await waitFor(() => expect(screen.getByRole('region')).toBeDefined());
    expect(hkFetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when the fetch fails', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByText(/couldn.?t load provenance/i)).toBeDefined();
    });
  });

  it('closes the popover and restores focus to the trigger when Escape is pressed', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('region')).toBeDefined());

    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });

    expect(screen.queryByRole('region')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('displays confidence percentage and source label when provenance is loaded', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByText(/87% confident/i)).toBeDefined();
      expect(screen.getByText(/from a conversation on/i)).toBeDefined();
    });
  });

  it('shows "Source unknown" when provenance array is empty', async () => {
    hkFetchMock.mockResolvedValue({ provenance: [] });
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByText('Source unknown')).toBeDefined();
    });
  });

  it('closes the popover on a pointerdown outside the trigger+region (AC3)', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('region')).toBeDefined());

    // A generic bubbling event avoids depending on jsdom's PointerEvent ctor;
    // the component listens on document for 'pointerdown'.
    fireEvent(document.body, new Event('pointerdown', { bubbles: true }));

    expect(screen.queryByRole('region')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the most recent non-superseded record, skipping a superseded newer one (AC1)', async () => {
    hkFetchMock.mockResolvedValue({
      provenance: [
        // Newest by captured_at (API orders DESC) but superseded → must be skipped.
        {
          id: '00000000-0000-4000-8000-00000000000a',
          memory_node_id: NODE_ID,
          source_type: 'user_edit',
          source_ref: {},
          captured_at: '2026-05-01T10:00:00.000Z',
          captured_by: '00000000-0000-4000-8000-000000000003',
          confidence: 0.99,
          superseded_by: '00000000-0000-4000-8000-00000000000b',
        },
        // Older but live → the record that must be displayed.
        {
          id: '00000000-0000-4000-8000-00000000000b',
          memory_node_id: NODE_ID,
          source_type: 'onboarding',
          source_ref: {},
          captured_at: '2026-04-01T10:00:00.000Z',
          captured_by: '00000000-0000-4000-8000-000000000003',
          confidence: 0.5,
          superseded_by: null,
        },
      ],
    });
    render(<ProvenancePopover nodeId={NODE_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    await waitFor(() => {
      expect(screen.getByText('from your setup conversation')).toBeDefined();
      expect(screen.getByText(/50% confident/i)).toBeDefined();
    });
    // The superseded 99% record must not be the one surfaced.
    expect(screen.queryByText(/99% confident/i)).toBeNull();
  });

  it('wires aria-controls on the trigger to the region id (AC9)', async () => {
    hkFetchMock.mockResolvedValue(sampleProvenancePayload());
    render(<ProvenancePopover nodeId={NODE_ID} />);

    const button = screen.getByRole('button', { name: 'More options' });
    expect(button.getAttribute('aria-controls')).toBeTruthy();

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('region')).toBeDefined());

    const region = screen.getByRole('region');
    expect(button.getAttribute('aria-controls')).toBe(region.getAttribute('id'));
  });

  describe('helper pulse (7-S6)', () => {
    const HELPER_TEXT = 'Tap ⋯ to see where this came from or ask Lumi to forget it';

    beforeEach(() => {
      localStorage.removeItem('memory_helper_seen_at');
    });

    afterEach(() => {
      vi.useRealTimers();
      localStorage.removeItem('memory_helper_seen_at');
    });

    it('shows the helper tooltip when showHelper=true (AC1)', () => {
      render(<ProvenancePopover nodeId={NODE_ID} showHelper />);
      expect(screen.getByText(HELPER_TEXT)).toBeDefined();
    });

    it('does NOT show the helper tooltip when showHelper is absent (AC4)', () => {
      render(<ProvenancePopover nodeId={NODE_ID} />);
      expect(screen.queryByText(HELPER_TEXT)).toBeNull();
    });

    it('auto-dismisses the helper after 4s and writes to localStorage (AC2)', () => {
      vi.useFakeTimers();
      render(<ProvenancePopover nodeId={NODE_ID} showHelper />);

      expect(screen.getByText(HELPER_TEXT)).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText(HELPER_TEXT)).toBeNull();
      expect(localStorage.getItem('memory_helper_seen_at')).not.toBeNull();
    });

    it('dismisses the helper on pointerdown and writes to localStorage (AC3)', () => {
      render(<ProvenancePopover nodeId={NODE_ID} showHelper />);

      expect(screen.getByText(HELPER_TEXT)).toBeDefined();

      fireEvent(document.body, new Event('pointerdown', { bubbles: true }));

      expect(screen.queryByText(HELPER_TEXT)).toBeNull();
      expect(localStorage.getItem('memory_helper_seen_at')).not.toBeNull();
    });

    it('does NOT show the helper when showHelper=false (AC4)', () => {
      render(<ProvenancePopover nodeId={NODE_ID} showHelper={false} />);
      expect(screen.queryByText(HELPER_TEXT)).toBeNull();
    });
  });
});
