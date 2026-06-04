import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { MemoryNode } from '@hivekitchen/types';

// Mock ProvenancePopover so VisibleMemorySentence tests stay unit-level.
vi.mock('./ProvenancePopover.js', () => ({
  ProvenancePopover: ({ nodeId }: { nodeId: string }) => (
    <button type="button" aria-label="More options" data-node-id={nodeId} />
  ),
}));

import { VisibleMemorySentence } from './VisibleMemorySentence.js';

afterEach(() => cleanup());

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    node_type: 'preference',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('VisibleMemorySentence', () => {
  it('renders the node prose_text', () => {
    render(<VisibleMemorySentence node={makeNode({ prose_text: 'Family eats leftovers on Thursdays.' })} />);
    expect(screen.getByText('Family eats leftovers on Thursdays.')).toBeDefined();
  });

  it('renders a "More options" button via ProvenancePopover (type=button)', () => {
    render(<VisibleMemorySentence node={makeNode()} />);
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button).toBeDefined();
    expect(button.getAttribute('type')).toBe('button');
  });

  it('passes the node id to ProvenancePopover', () => {
    const node = makeNode({ id: '00000000-0000-4000-8000-000000000099' });
    render(<VisibleMemorySentence node={node} />);
    const button = screen.getByRole('button', { name: 'More options' });
    expect(button.getAttribute('data-node-id')).toBe(node.id);
  });
});
