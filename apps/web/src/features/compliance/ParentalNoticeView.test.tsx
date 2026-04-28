import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ParentalNoticeView } from './ParentalNoticeView.js';

const originalFetch = globalThis.fetch;

function buildSixProcessors() {
  return ['supabase', 'elevenlabs', 'sendgrid', 'twilio', 'stripe', 'openai'].map((name) => ({
    name,
    display_name: name,
    purpose: 'p',
    data_categories: ['c'],
    retention_label: 'r',
  }));
}

function noticeResponse(): Response {
  return new Response(
    JSON.stringify({
      document_version: 'v1',
      content: '# Inline view\n\nText.',
      processors: buildSixProcessors(),
      data_categories: ['household profile'],
      retention: [{ category: 'voice', horizon_days: 90, label: '90 days' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('ParentalNoticeView', () => {
  it('renders notice content after a successful GET (no scroll-gate, no acknowledge button)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(noticeResponse()) as unknown as typeof fetch;

    render(<ParentalNoticeView />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /Inline view/i })).toBeDefined();
    });
    expect(
      screen.queryByRole('button', { name: /start adding my child/i }),
    ).toBeNull();
  });

  it('GET failure shows alert + retry button', async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return new Response('{}', { status: 500 });
      return noticeResponse();
    }) as unknown as typeof fetch;

    render(<ParentalNoticeView />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /Inline view/i })).toBeDefined();
    });
  });
});
