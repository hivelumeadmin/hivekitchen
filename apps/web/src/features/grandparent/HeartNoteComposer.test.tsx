import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { HeartNoteComposer } from './HeartNoteComposer.js';

// useScopeGuard console.errors in DEV when .grandparent-scope is absent on
// <html>; add it so the render is clean.
beforeEach(() => {
  document.documentElement.classList.add('grandparent-scope');
});
afterEach(() => {
  document.documentElement.classList.remove('grandparent-scope');
  cleanup();
});

const baseProps = {
  childId: '33333333-3333-4333-8333-333333333333',
  childName: 'Asha',
  grandparentName: 'Nani',
  grandparentTerm: null,
  notesUsed: 0,
  cap: 2,
  nextMonthOpens: '2026-07-01',
};

// 4-S16 AC10 — dir="auto" on the grandparent composer textareas.
describe('HeartNoteComposer — dir="auto" on Heart Note textareas (4-S16)', () => {
  it('active composing textarea carries dir="auto"', () => {
    render(<HeartNoteComposer {...baseProps} />);
    expect(screen.getByLabelText('Heart Note').getAttribute('dir')).toBe('auto');
  });

  it('read-only at-cap textarea carries dir="auto"', () => {
    render(<HeartNoteComposer {...baseProps} notesUsed={2} />);
    expect(
      screen
        .getByLabelText('Heart Note (read-only — monthly cap reached)')
        .getAttribute('dir'),
    ).toBe('auto');
  });
});
