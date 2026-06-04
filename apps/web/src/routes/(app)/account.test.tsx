import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
const hkFetchBlobMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  hkFetchBlob: (path: string, init: unknown) => hkFetchBlobMock(path, init),
  HkApiError: class HkApiError extends Error {},
}));

vi.mock('@hivekitchen/ui', () => ({
  useScope: vi.fn(),
}));

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { useAuthStore } from '@/stores/auth.store.js';
import AccountPage from './account.js';

type Role = 'primary_parent' | 'secondary_caregiver' | 'guest_author' | 'ops';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

function sampleProfile(): UserProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'parent@example.com',
    display_name: 'Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    auth_providers: ['email'],
    notification_prefs: { weekly_plan_ready: true, grocery_list_ready: true },
    cultural_language: 'default',
    parental_notice_acknowledged_at: null,
    parental_notice_acknowledged_version: null,
    is_onboarded: true,
    is_onboarding_in_progress: false,
  } as UserProfile;
}

function setAuthenticated(role: Role) {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'parent@example.com',
      display_name: 'Parent',
      current_household_id: HOUSEHOLD_ID,
      role,
    },
  });
}

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/app/account']}>
      <AccountPage />
    </MemoryRouter>,
  );
}

describe('AccountPage — Allergy safety log section', () => {
  let clickedDownloads: string[] = [];

  beforeEach(() => {
    hkFetchMock.mockReset();
    hkFetchBlobMock.mockReset();
    navigateSpy.mockClear();
    hkFetchMock.mockResolvedValue(sampleProfile());
    hkFetchBlobMock.mockResolvedValue(new Blob(['{}'], { type: 'application/json' }));
    // jsdom has no Blob URL implementation — stub it.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    // Stub the anchor click so jsdom doesn't attempt (unimplemented) navigation,
    // and record the download filename it would have produced.
    clickedDownloads = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownloads.push(this.download);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ user: null });
  });

  it('Download JSON button posts { format: "json" } via hkFetchBlob', async () => {
    setAuthenticated('primary_parent');
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Download JSON' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(hkFetchBlobMock).toHaveBeenCalledWith('/v1/heart-notes/transparency-log', {
        method: 'POST',
        body: { format: 'json' },
      });
    });
  });

  it('Download PDF button posts { format: "pdf" } via hkFetchBlob', async () => {
    setAuthenticated('primary_parent');
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Download PDF' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(hkFetchBlobMock).toHaveBeenCalledWith('/v1/heart-notes/transparency-log', {
        method: 'POST',
        body: { format: 'pdf' },
      });
    });
  });

  it('triggers a download anchor named allergy-log-YYYY-MM-DD.json', async () => {
    setAuthenticated('primary_parent');
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Download JSON' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(clickedDownloads.some((n) => /^allergy-log-\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true);
    });
  });

  it('shows the section for a secondary_caregiver', async () => {
    setAuthenticated('secondary_caregiver');
    hkFetchMock.mockResolvedValue({ ...sampleProfile(), role: 'secondary_caregiver' });
    renderRoute();

    await screen.findByRole('button', { name: 'Download JSON' });
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy();
  });

  it('hides the section for a guest_author', async () => {
    setAuthenticated('guest_author');
    hkFetchMock.mockResolvedValue({ ...sampleProfile(), role: 'guest_author' });
    renderRoute();

    // Wait for the profile to finish loading (the page heading renders once
    // ready), then assert the allergy section is absent.
    await screen.findByText('Your account');

    expect(screen.queryByText('Allergy safety log')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
  });
});
