import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as reactRouterDom from 'react-router-dom';
import type { UserProfile } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
const hkFetchBlobMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  hkFetchBlob: (path: string, init: unknown) => hkFetchBlobMock(path, init),
  HkApiError: class HkApiError extends Error {},
}));

vi.mock('@hivekitchen/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useScope: vi.fn(),
}));

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof reactRouterDom>('react-router-dom');
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
    notification_prefs: {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: true,
    },
    cultural_language: 'default',
    parental_notice_acknowledged_at: null,
    parental_notice_acknowledged_version: null,
    is_onboarded: true,
    is_onboarding_in_progress: false,
    caption_only_mode: false,
    voice_retention_mode: 'standard',
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

describe('AccountPage — Accessibility section (Slice 5-S13)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    hkFetchBlobMock.mockReset();
    navigateSpy.mockClear();
    hkFetchMock.mockResolvedValue(sampleProfile());
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ user: null });
  });

  it('renders the Text only toggle, unchecked, when the profile loads', async () => {
    setAuthenticated('primary_parent');
    renderRoute();

    const toggle = await screen.findByRole('switch', {
      name: 'Text only — captions without audio',
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });

  it('fires PATCH /v1/users/me/accessibility with caption_only_mode:true on toggle', async () => {
    setAuthenticated('primary_parent');
    // GET /me returns caption_only_mode:false; the PATCH returns the updated
    // profile. Path-based so the parallel /voice-transcripts mount fetch (5-S15)
    // does not consume an ordered mock.
    hkFetchMock.mockImplementation((path: string) =>
      path === '/v1/users/me/accessibility'
        ? Promise.resolve({ ...sampleProfile(), caption_only_mode: true })
        : Promise.resolve(sampleProfile()),
    );
    renderRoute();

    const toggle = await screen.findByRole('switch', {
      name: 'Text only — captions without audio',
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith('/v1/users/me/accessibility', {
        method: 'PATCH',
        body: { caption_only_mode: true },
      });
    });
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });
  });
});

describe('AccountPage — Voice Data section (Slice 5-S15)', () => {
  const SAMPLE_TRANSCRIPT = {
    id: '44444444-4444-4444-8444-444444444444',
    transcript: 'What is for lunch today?',
    retention_until: '2099-11-01T00:00:00.000Z',
    created_at: '2026-10-23T10:00:00.000Z',
  };

  beforeEach(() => {
    hkFetchMock.mockReset();
    hkFetchBlobMock.mockReset();
    navigateSpy.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ user: null });
  });

  it('renders the Voice Data toggle and transcript list when transcripts exist', async () => {
    setAuthenticated('primary_parent');
    hkFetchMock.mockImplementation((path: string) =>
      path === '/v1/users/me/voice-transcripts'
        ? Promise.resolve({ transcripts: [SAMPLE_TRANSCRIPT], voice_retention_mode: 'standard' })
        : Promise.resolve(sampleProfile()),
    );
    renderRoute();

    const toggle = await screen.findByRole('switch', { name: 'Delete transcripts immediately' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await screen.findByText('What is for lunch today?');
  });

  it('PATCHes immediate_delete and clears the transcript list on toggle', async () => {
    setAuthenticated('primary_parent');
    hkFetchMock.mockImplementation((path: string) =>
      path === '/v1/users/me/voice-transcripts'
        ? Promise.resolve({ transcripts: [SAMPLE_TRANSCRIPT], voice_retention_mode: 'standard' })
        : Promise.resolve(sampleProfile()),
    );
    renderRoute();

    const toggle = await screen.findByRole('switch', { name: 'Delete transcripts immediately' });
    await screen.findByText('What is for lunch today?');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith('/v1/users/me/voice-retention', {
        method: 'PATCH',
        body: { voice_retention_mode: 'immediate_delete' },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('What is for lunch today?')).toBeNull();
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it('reverts the toggle and restores the list on PATCH failure', async () => {
    setAuthenticated('primary_parent');
    hkFetchMock.mockImplementation((path: string) => {
      if (path === '/v1/users/me/voice-transcripts') {
        return Promise.resolve({ transcripts: [SAMPLE_TRANSCRIPT], voice_retention_mode: 'standard' });
      }
      if (path === '/v1/users/me/voice-retention') {
        return Promise.reject(new Error('500'));
      }
      return Promise.resolve(sampleProfile());
    });
    renderRoute();

    const toggle = await screen.findByRole('switch', { name: 'Delete transcripts immediately' });
    await screen.findByText('What is for lunch today?');
    fireEvent.click(toggle);

    await screen.findByText('Could not update voice data setting. Please try again.');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('What is for lunch today?')).toBeTruthy();
  });
});
