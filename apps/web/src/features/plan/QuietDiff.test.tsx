import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QuietDiff } from './QuietDiff.js';

afterEach(() => cleanup());

describe('QuietDiff', () => {
  it('renders nothing when summary is null', () => {
    const { container } = render(<QuietDiff summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the summary text when summary is non-null', () => {
    render(<QuietDiff summary="Swapped Tuesday's protein to match pantry" />);
    expect(
      screen.getByText("Swapped Tuesday's protein to match pantry"),
    ).toBeDefined();
  });

  it('does not render the ⋯ button when explanation is undefined', () => {
    render(<QuietDiff summary="Swapped protein" />);
    expect(screen.queryByRole('button', { name: /why/i })).toBeNull();
  });

  it('renders the ⋯ button when explanation is provided', () => {
    render(
      <QuietDiff
        summary="Swapped protein"
        explanation="Pantry had no chicken this week."
      />,
    );
    expect(
      screen.getByRole('button', { name: /why this change/i }),
    ).toBeDefined();
  });

  it('clicking ⋯ opens the explanation dialog', () => {
    render(
      <QuietDiff summary="Swapped protein" explanation="Pantry had no chicken." />,
    );
    const btn = screen.getByRole('button', { name: /why this change/i });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Pantry had no chicken.')).toBeDefined();
  });

  it('clicking ⋯ again closes the dialog', () => {
    render(
      <QuietDiff summary="Swapped protein" explanation="Pantry had no chicken." />,
    );
    const btn = screen.getByRole('button', { name: /why this change/i });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pressing Escape on the trigger closes the dialog and restores focus', () => {
    render(
      <QuietDiff summary="Swapped protein" explanation="Pantry had no chicken." />,
    );
    const btn = screen.getByRole('button', { name: /why this change/i });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('pressing Escape inside the dialog also closes it and restores focus to trigger', () => {
    render(
      <QuietDiff summary="Swapped protein" explanation="Pantry had no chicken." />,
    );
    const btn = screen.getByRole('button', { name: /why this change/i });
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('⋯ button has aria-expanded=false when closed and true when open', () => {
    render(
      <QuietDiff summary="Swapped protein" explanation="Pantry had no chicken." />,
    );
    const btn = screen.getByRole('button', { name: /why this change/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
