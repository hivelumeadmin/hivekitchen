import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MomentHeadline } from './MomentHeadline.js';

afterEach(() => {
  cleanup();
});

describe('MomentHeadline', () => {
  it('renders an <h1> containing the provided text', () => {
    render(<MomentHeadline text="A quiet week, with one small surprise." />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('A quiet week, with one small surprise.');
  });

  it('renders a visually-hidden <h1> landmark when text is empty', () => {
    render(<MomentHeadline text="" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('sr-only');
  });

  it('always renders an <h1> regardless of text content', () => {
    const { rerender } = render(<MomentHeadline text="" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();

    rerender(<MomentHeadline text="Headline" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});
