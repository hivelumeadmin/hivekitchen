import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { MemoryNode } from '@hivekitchen/types';

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

// Mock ProvenancePopover so VisibleMemorySentence tests stay unit-level. The
// mock surfaces `onEdit` and `onForget` via dedicated buttons so tests can enter
// edit / forget-confirmation mode without driving the real popover.
vi.mock('./ProvenancePopover.js', () => ({
  ProvenancePopover: ({
    nodeId,
    onEdit,
    onForget,
  }: {
    nodeId: string;
    onEdit?: () => void;
    onForget?: () => void;
  }) => (
    <>
      <button
        type="button"
        aria-label="More options"
        data-node-id={nodeId}
        onClick={() => onEdit?.()}
      />
      <button type="button" aria-label="Forget this memory" onClick={() => onForget?.()} />
    </>
  ),
}));

import { VisibleMemorySentence } from './VisibleMemorySentence.js';

afterEach(() => cleanup());

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    node_type: 'other',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    forget_reason: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('VisibleMemorySentence', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
  });

  it('renders the node prose_text', () => {
    render(
      <VisibleMemorySentence
        node={makeNode({ prose_text: 'Family eats leftovers on Thursdays.' })}
        onNodeUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Family eats leftovers on Thursdays.')).toBeDefined();
  });

  it('renders a "More options" button via ProvenancePopover (type=button)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button).toBeDefined();
    expect(button.getAttribute('type')).toBe('button');
  });

  it('passes the node id to ProvenancePopover', () => {
    const node = makeNode({ id: '00000000-0000-4000-8000-000000000099' });
    render(<VisibleMemorySentence node={node} onNodeUpdated={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button.getAttribute('data-node-id')).toBe(node.id);
  });

  it('enters edit mode with a textarea pre-filled with the current prose (AC1)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Layla avoids spicy peppers.');
  });

  it('Cancel exits edit mode without calling hkFetch and preserves the original text (AC3)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited but abandoned' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(hkFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined();
  });

  it('Escape exits edit mode without calling hkFetch (AC3)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(hkFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('disables Save when the text is unchanged or empty (AC4)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    // Unchanged → disabled.
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    // Whitespace-only → disabled.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    // Changed → enabled.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a different sentence' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('Save PATCHes the prose, lifts the updated node up, and exits edit mode (AC2)', async () => {
    const updated = makeNode({ prose_text: 'Layla now likes mild spice.' });
    hkFetchMock.mockResolvedValue({ node: updated });
    const onNodeUpdated = vi.fn();

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={onNodeUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Layla now likes mild spice.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onNodeUpdated).toHaveBeenCalledWith(updated);
    });
    expect(hkFetchMock).toHaveBeenCalledWith(
      '/v1/memory/00000000-0000-4000-8000-000000000001',
      expect.objectContaining({
        method: 'PATCH',
        body: { prose_text: 'Layla now likes mild spice.', reason: 'parent_edit' },
      }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Save button is re-enabled on the second edit after a successful save (P1 regression)', async () => {
    const updated = makeNode({ prose_text: 'Layla now likes mild spice.' });
    hkFetchMock.mockResolvedValue({ node: updated });
    const onNodeUpdated = vi.fn();

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={onNodeUpdated} />);

    // First edit → successful save.
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Layla now likes mild spice.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNodeUpdated).toHaveBeenCalledTimes(1));

    // Re-enter edit mode.
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A third version.' } });

    // Save must NOT be disabled (isSaving should have been reset).
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows an error and stays in edit mode when Save fails (AC4)', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    const onNodeUpdated = vi.fn();

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={onNodeUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a corrected sentence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(onNodeUpdated).not.toHaveBeenCalled();
    // Still in edit mode.
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  // Story 7-S4 — soft-forget flow.

  const FORGET_PLACEHOLDER = 'Why are you forgetting this? (optional)';

  it('renders the tombstone text and no `⋯` controls when soft_forget_at is set (AC4)', () => {
    render(
      <VisibleMemorySentence
        node={makeNode({ soft_forget_at: '2026-06-05T00:00:00.000Z' })}
        onNodeUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("Lumi won't use this anymore")).toBeDefined();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget this memory' })).toBeNull();
  });

  it('includes the reason in the tombstone text when forget_reason is set (AC4)', () => {
    render(
      <VisibleMemorySentence
        node={makeNode({ soft_forget_at: '2026-06-05T00:00:00.000Z', forget_reason: 'too spicy' })}
        onNodeUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("Lumi won't use this anymore — too spicy")).toBeDefined();
  });

  it('shows the forget confirmation UI when the Forget pill is tapped (AC1)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));

    expect(screen.getByPlaceholderText(FORGET_PLACEHOLDER)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm forget' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('Cancel exits the confirmation without calling hkFetch and preserves the prose (AC2)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(hkFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(FORGET_PLACEHOLDER)).toBeNull();
    expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined();
  });

  it('Escape exits the confirmation without calling hkFetch (AC2)', () => {
    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.keyDown(screen.getByPlaceholderText(FORGET_PLACEHOLDER), { key: 'Escape' });

    expect(hkFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(FORGET_PLACEHOLDER)).toBeNull();
  });

  it('Confirm forget sends an empty body when the reason is blank/whitespace (AC3)', async () => {
    const updated = makeNode({ soft_forget_at: '2026-06-05T00:00:00.000Z' });
    hkFetchMock.mockResolvedValue({ node: updated });

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.change(screen.getByPlaceholderText(FORGET_PLACEHOLDER), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));

    await waitFor(() => expect(hkFetchMock).toHaveBeenCalled());
    expect(hkFetchMock).toHaveBeenCalledWith(
      '/v1/memory/00000000-0000-4000-8000-000000000001/forget',
      expect.objectContaining({ method: 'PATCH', body: {} }),
    );
  });

  it('Confirm forget sends the trimmed reason when the input has text (AC3)', async () => {
    const updated = makeNode({
      soft_forget_at: '2026-06-05T00:00:00.000Z',
      forget_reason: 'too spicy',
    });
    hkFetchMock.mockResolvedValue({ node: updated });

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.change(screen.getByPlaceholderText(FORGET_PLACEHOLDER), {
      target: { value: '  too spicy  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));

    await waitFor(() => expect(hkFetchMock).toHaveBeenCalled());
    expect(hkFetchMock).toHaveBeenCalledWith(
      '/v1/memory/00000000-0000-4000-8000-000000000001/forget',
      expect.objectContaining({ method: 'PATCH', body: { reason: 'too spicy' } }),
    );
  });

  it('successful forget lifts the updated node and exits confirmation (AC3)', async () => {
    const updated = makeNode({ soft_forget_at: '2026-06-05T00:00:00.000Z' });
    hkFetchMock.mockResolvedValue({ node: updated });
    const onNodeUpdated = vi.fn();

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={onNodeUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));

    await waitFor(() => expect(onNodeUpdated).toHaveBeenCalledWith(updated));
    expect(screen.queryByPlaceholderText(FORGET_PLACEHOLDER)).toBeNull();
  });

  it('failed forget shows an error and stays in confirmation mode with Confirm re-enabled (AC3)', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    const onNodeUpdated = vi.fn();

    render(<VisibleMemorySentence node={makeNode()} onNodeUpdated={onNodeUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget this memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(onNodeUpdated).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(FORGET_PLACEHOLDER)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm forget' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
