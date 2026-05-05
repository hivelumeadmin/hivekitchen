import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LumiNote } from './LumiNote.js';

afterEach(() => {
  cleanup();
});

describe('LumiNote', () => {
  it('renders a <p> containing the provided text', () => {
    render(<LumiNote text="Tuesday looks like leftovers." />);
    const p = screen.getByText('Tuesday looks like leftovers.');
    expect(p.tagName).toBe('P');
  });

  it('renders nothing (returns null) when text is empty', () => {
    const { container } = render(<LumiNote text="" />);
    expect(container.firstChild).toBeNull();
  });

  it('rendered <p> has a leading-side border class', () => {
    render(<LumiNote text="Body" />);
    const p = screen.getByText('Body');
    expect(p.className).toMatch(/border-s|border-l/);
  });
});
