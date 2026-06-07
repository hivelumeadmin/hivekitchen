import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { PresencePartner } from '@hivekitchen/types';
import { PresenceIndicator } from './PresenceIndicator.js';

vi.mock('@/hooks/usePresence.js', () => ({
  usePresence: vi.fn(),
}));

function partner(overrides: Partial<PresencePartner> = {}): PresencePartner {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    display_name: 'Priya',
    surface: 'brief',
    expires_at: '2026-06-06T12:00:00.000Z',
    ...overrides,
  };
}

async function mockPartners(partners: PresencePartner[]): Promise<void> {
  const { usePresence } = await import('@/hooks/usePresence.js');
  vi.mocked(usePresence).mockReturnValue({ partners });
}

const SURFACE = { kind: 'brief', id: 'household-1' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('PresenceIndicator', () => {
  it('renders nothing when there are no partners', async () => {
    await mockPartners([]);
    const { container } = render(<PresenceIndicator surface={SURFACE} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "{name} is also on Brief" for one partner with a display name', async () => {
    await mockPartners([partner({ display_name: 'Priya' })]);
    render(<PresenceIndicator surface={SURFACE} />);
    expect(screen.getByText('Priya is also on Brief')).toBeDefined();
  });

  it('renders "Someone is also on Brief" for one partner with a null display name', async () => {
    await mockPartners([partner({ display_name: null })]);
    render(<PresenceIndicator surface={SURFACE} />);
    expect(screen.getByText('Someone is also on Brief')).toBeDefined();
  });

  it('renders "2 others on Brief" for two partners', async () => {
    await mockPartners([
      partner({ user_id: '11111111-1111-4111-8111-111111111111' }),
      partner({ user_id: '22222222-2222-4222-8222-222222222222' }),
    ]);
    render(<PresenceIndicator surface={SURFACE} />);
    expect(screen.getByText('2 others on Brief')).toBeDefined();
  });

  it('exposes role="status" with aria-live=polite when partners are present', async () => {
    await mockPartners([partner()]);
    render(<PresenceIndicator surface={SURFACE} />);
    const indicator = screen.getByRole('status');
    expect(indicator.getAttribute('aria-live')).toBe('polite');
  });
});
