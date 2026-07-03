import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import LumiPage from './lumi.js';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const originalFetch = globalThis.fetch;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/lumi']}>
        <LumiPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function messageTurn(id: string, content: string, role: 'user' | 'lumi'): Turn {
  return {
    id,
    thread_id: THREAD_ID,
    server_seq: 1,
    created_at: '2026-07-03T00:00:00.000Z',
    role,
    body: { type: 'message', content },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LumiPage (Epic 13-s11 — the full-screen thread anchor)', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders the thread heading and the composer input', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Lumi' })).toBeDefined();
    expect(screen.getByLabelText(/ask lumi/i)).toBeDefined();
  });

  it('registers the general surface for the page', () => {
    renderPage();
    expect(useLumiStore.getState().surface).toBe('general');
  });

  it('renders hydrated thread turns via the shared conversation body (no fork)', async () => {
    // Seed a known thread so useLumiContext hydrates it on mount, exactly as the
    // summoned sheet does — proving the page reuses the same conversation body.
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        thread_id: THREAD_ID,
        turns: [
          messageTurn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Plan looks calm', 'user'),
          messageTurn('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Glad you think so.', 'lumi'),
        ],
      }),
    ) as unknown as typeof fetch;

    renderPage();

    await waitFor(() => expect(screen.getByText('Plan looks calm')).toBeDefined());
    expect(screen.getByText('Glad you think so.')).toBeDefined();
  });
});
