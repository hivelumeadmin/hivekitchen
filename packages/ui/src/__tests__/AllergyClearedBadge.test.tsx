import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AllergyClearedBadge } from '../AllergyClearedBadge.js';

afterEach(() => {
  cleanup();
});

const AUDIT_URL = '/plans/by-week/aaaa-bbbb-cccc/audit';

describe('AllergyClearedBadge — trigger semantics', () => {
  it('renders trigger button with aria-label "Cleared for {name}\'s {allergen}" and matching visible text', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    expect(btn.textContent).toContain("Cleared for Asha's peanut");
  });

  it('trigger has type="button" so it never accidentally submits a parent form', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('trigger is a native <button> element — guarantees browser-native Enter and Space activation (AC #2)', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    // Native <button> elements fire click on Enter (keydown) and Space (keyup) in all
    // browsers. This guard prevents a future refactor from replacing it with a
    // <div role="button"> which would silently break keyboard activation.
    expect(btn.tagName).toBe('BUTTON');
  });

  it('starts with aria-expanded=false and no dialog rendered', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('AllergyClearedBadge — disclosure interactions', () => {
  it('clicking the trigger toggles aria-expanded and shows the dialog', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc on the trigger button closes the dialog and returns focus to the trigger', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeDefined();
    // Primary use case: focus stays on trigger after click; Escape must close the dialog.
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('Esc inside the dialog (focus on link) closes it and returns focus to the trigger', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('AllergyClearedBadge — popover content (UX-DR24)', () => {
  it('dialog text contains the verbatim UX-DR24 copy', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    fireEvent.click(screen.getByRole('button', { name: "Cleared for Asha's peanut" }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(
      "We checked every ingredient against Asha's peanut allergy.",
    );
    expect(dialog.textContent).toContain(
      "Nothing in today's lunch contains peanut or was made near them.",
    );
  });

  it('"View audit" link href matches the auditUrl prop', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    fireEvent.click(screen.getByRole('button', { name: "Cleared for Asha's peanut" }));
    const link = screen.getByRole('link', { name: 'View audit' });
    expect(link.getAttribute('href')).toBe(AUDIT_URL);
  });

  it('dialog has aria-modal=false (non-modal popover)', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    fireEvent.click(screen.getByRole('button', { name: "Cleared for Asha's peanut" }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
  });

  it('dialog is labelled by the trigger (aria-labelledby points to trigger id)', () => {
    render(<AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />);
    const btn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe(btn.getAttribute('id'));
  });
});

describe('AllergyClearedBadge — re-checking state (Story 3.10 AC #3)', () => {
  it('isRechecking=true adds motion-safe:animate-pulse and ring-foliage-300 to the checkmark wrapper', () => {
    const { container } = render(
      <AllergyClearedBadge
        childName="Asha"
        allergen="peanut"
        auditUrl={AUDIT_URL}
        isRechecking
      />,
    );
    const aria = container.querySelector('[aria-hidden="true"]');
    expect(aria).not.toBeNull();
    const cls = aria?.className ?? '';
    expect(cls).toContain('motion-safe:animate-pulse');
    expect(cls).toContain('ring-foliage-300');
  });

  it('isRechecking=false (default) does NOT apply animate-pulse or foliage ring', () => {
    const { container } = render(
      <AllergyClearedBadge childName="Asha" allergen="peanut" auditUrl={AUDIT_URL} />,
    );
    const aria = container.querySelector('[aria-hidden="true"]');
    const cls = aria?.className ?? '';
    expect(cls).not.toContain('animate-pulse');
    expect(cls).not.toContain('ring-foliage-300');
  });
});

describe('AllergyClearedBadge — never destructive (UX-DR24, AC #5)', () => {
  it('renders ONLY safety-cleared/foliage tokens — no destructive red/rose/destructive classes', () => {
    const { container } = render(
      <AllergyClearedBadge
        childName="Asha"
        allergen="peanut"
        auditUrl={AUDIT_URL}
        isRechecking
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: "Cleared for Asha's peanut" }));
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bred-\d/);
    expect(html).not.toMatch(/\brose-\d/);
    expect(html).not.toContain('destructive');
    expect(html).not.toMatch(/\bbg-red\b/);
  });
});
