import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CaptionRibbon } from './CaptionRibbon.js';

describe('CaptionRibbon', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders null when both transcript and caption are empty', () => {
    const { container } = render(<CaptionRibbon userTranscript="" lumiCaption="" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows both the user transcript and the Lumi caption when provided', () => {
    render(<CaptionRibbon userTranscript="pasta please" lumiCaption="On it — pasta Tuesday." />);

    expect(screen.getByText('pasta please')).toBeDefined();
    expect(screen.getByText('On it — pasta Tuesday.')).toBeDefined();
    expect(screen.getByText('You:')).toBeDefined();
    expect(screen.getByText('Lumi:')).toBeDefined();
  });

  it('exposes an aria-live polite region for screen readers', () => {
    render(<CaptionRibbon userTranscript="hi" lumiCaption="hello" />);

    const region = screen.getByRole('region', { name: /voice captions/i });
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('does not bleed the Lumi caption across turns (only user transcript present)', () => {
    render(<CaptionRibbon userTranscript="next question" lumiCaption="" />);

    expect(screen.getByText('next question')).toBeDefined();
    expect(screen.queryByText('Lumi:')).toBeNull();
  });
});
