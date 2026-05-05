import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrustChip, type TrustChipVariant } from './TrustChip.js';

afterEach(() => {
  cleanup();
});

describe('TrustChip', () => {
  it('renders with role="note" and aria-label matching the label prop', () => {
    render(<TrustChip variant="allergy-cleared" label="Cleared for Maya" />);
    const chip = screen.getByRole('note');
    expect(chip.getAttribute('aria-label')).toBe('Cleared for Maya');
  });

  it('renders the label text in the chip', () => {
    render(<TrustChip variant="cultural-template" label="Jollof Friday" />);
    expect(screen.getByText('Jollof Friday')).toBeDefined();
  });

  it('renders a checkmark SVG', () => {
    const { container } = render(
      <TrustChip variant="pantry-fresh" label="Pantry fresh" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  const variants: ReadonlyArray<TrustChipVariant> = [
    'cultural-template',
    'allergy-cleared',
    'pantry-fresh',
    'memory-provenance',
    'lumi-proposed',
  ];

  it.each(variants)('renders without error for variant=%s', (variant) => {
    const { container } = render(<TrustChip variant={variant} label="Label" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('applies the correct token-class block per variant', () => {
    const { rerender, container } = render(
      <TrustChip variant="allergy-cleared" label="A" />,
    );
    expect(container.firstChild).not.toBeNull();
    const first = container.firstChild as HTMLElement;
    expect(first.className).toContain('bg-safety-cleared-100');

    rerender(<TrustChip variant="lumi-proposed" label="B" />);
    expect((container.firstChild as HTMLElement).className).toContain(
      'bg-lumi-terracotta-100',
    );
  });
});
