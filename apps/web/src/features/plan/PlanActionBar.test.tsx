import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanActionBar } from './PlanActionBar.js';

// Epic 13-s10 (Task 5) — the StickyBar wiring: confirm / talk-to-lumi + the
// confirmed done-state idiom.

afterEach(cleanup);

describe('PlanActionBar', () => {
  it('fires onConfirm and onTalkToLumi', () => {
    const onConfirm = vi.fn();
    const onTalkToLumi = vi.fn();
    render(<PlanActionBar onConfirm={onConfirm} onTalkToLumi={onTalkToLumi} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm the week/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /talk to lumi/i }));
    expect(onTalkToLumi).toHaveBeenCalledTimes(1);
  });

  it('reflects the confirmed state: the primary is disabled and reads "Confirmed"', () => {
    const onConfirm = vi.fn();
    render(<PlanActionBar onConfirm={onConfirm} confirmed />);

    const button = screen.getByRole('button', { name: /confirmed/i });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a pending label while confirming', () => {
    render(<PlanActionBar onConfirm={vi.fn()} confirming />);
    expect(screen.getByRole('button', { name: /confirming/i })).toHaveProperty('disabled', true);
  });
});
