import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StationeryCard } from './StationeryCard.js';

afterEach(cleanup);

const baseProps = {
  envelope: { toLabel: 'Asha', deliveryTime: '8:00 AM', scheduled: false },
  draftText: '',
  placeholder: 'Write something…',
  charCap: 280,
  savedHint: '',
};

// 4-S16 AC10 — dir="auto" on the parent Heart Note composer textarea.
describe('StationeryCard — dir="auto" on the Heart Note textarea (4-S16)', () => {
  it('Heart Note textarea carries dir="auto"', () => {
    render(<StationeryCard {...baseProps} />);
    expect(screen.getByLabelText('Heart Note').getAttribute('dir')).toBe('auto');
  });
});
