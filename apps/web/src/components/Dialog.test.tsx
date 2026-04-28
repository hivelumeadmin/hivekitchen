import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from './Dialog.js';

afterEach(() => cleanup());

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} titleId="t" descriptionId="d">
        <h2 id="t">Title</h2>
        <p id="d">Description</p>
        <button type="button" data-testid="first">First</button>
        <button type="button" data-testid="second">Second</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('does not render when closed', () => {
    render(
      <Dialog open={false} onClose={() => undefined} titleId="t">
        <p>hidden</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders with role="dialog" + aria attributes when open', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
    expect(dialog.getAttribute('aria-describedby')).toBe('d');
  });

  it('focuses the first focusable element on mount', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('fires onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} titleId="t">
        <button type="button">First</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab inside the dialog (Tab from last → first)', () => {
    render(<Harness />);
    const first = screen.getByTestId('first');
    const second = screen.getByTestId('second');
    second.focus();
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('traps Shift+Tab inside the dialog (Shift+Tab from first → last)', () => {
    render(<Harness />);
    const first = screen.getByTestId('first');
    const second = screen.getByTestId('second');
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('closes on scrim click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} titleId="t">
        <p id="t">x</p>
      </Dialog>,
    );
    const scrim = document.querySelector('[aria-hidden="true"]')!;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger element on close', () => {
    render(<Harness initialOpen={false} />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId('first'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses the dialog container when there are no focusable elements', () => {
    render(
      <Dialog open onClose={() => undefined} titleId="t">
        <p id="t">No interactive elements</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('swallows Tab when there are no focusable elements', () => {
    render(
      <Dialog open onClose={() => undefined} titleId="t">
        <p id="t">No interactive elements</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });
});
