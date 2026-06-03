import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { HeartNoteCard } from './HeartNoteCard.js';

afterEach(cleanup);

// 4-S16 AC10 — dir="auto" on the user-authored text nodes. jsdom has no bidi
// engine, so we assert the attribute is present (the browser infers direction
// from it); we do NOT assert visual RTL flow.
describe('HeartNoteCard — dir="auto" on user-authored text (4-S16)', () => {
  it('body <p> carries dir="auto" for a Hebrew (RTL) note', () => {
    render(<HeartNoteCard body="תהנה היום בבית הספר" from="— אבא" />);
    expect(screen.getByText('תהנה היום בבית הספר').getAttribute('dir')).toBe('auto');
  });

  it('body <p> still carries dir="auto" for an English note (attribute is unconditional)', () => {
    render(<HeartNoteCard body="Have a great day at school" from="— Mum" />);
    expect(screen.getByText('Have a great day at school').getAttribute('dir')).toBe('auto');
  });

  it('author attribution <span> carries dir="auto" (author names can be non-Latin)', () => {
    render(<HeartNoteCard body="hi" from="— סבתא" />);
    expect(screen.getByText('— סבתא').getAttribute('dir')).toBe('auto');
  });
});
