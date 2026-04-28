import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ParentalNoticeDialog } from './ParentalNoticeDialog.js';
import { useComplianceStore } from '@/stores/compliance.store.js';

const originalFetch = globalThis.fetch;
const originalIO = globalThis.IntersectionObserver;

function buildSixProcessors() {
  return ['supabase', 'elevenlabs', 'sendgrid', 'twilio', 'stripe', 'openai'].map((name) => ({
    name,
    display_name: name,
    purpose: 'p',
    data_categories: ['c'],
    retention_label: 'r',
  }));
}

function noticeResponse(opts: { content?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      document_version: 'v1',
      content: opts.content ?? '# Notice\n\n## Section\n\n- **bold** item',
      processors: buildSixProcessors(),
      data_categories: ['household profile'],
      retention: [{ category: 'voice', horizon_days: 90, label: '90 days' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function ackResponse(): Response {
  return new Response(
    JSON.stringify({
      acknowledged_at: '2026-04-27T12:00:00.000Z',
      document_version: 'v1',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function installImmediateIntersectionObserver(): void {
  class ImmediateIntersectionObserver {
    private readonly callback: (
      entries: { isIntersecting: boolean; target: Element }[],
    ) => void;
    constructor(
      cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
    ) {
      this.callback = cb;
    }
    observe(target: Element): void {
      this.callback([{ isIntersecting: true, target }]);
    }
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root: Element | null = null;
    rootMargin = '';
    thresholds: number[] = [];
  }
  // @ts-expect-error — test-only global override for jsdom.
  globalThis.IntersectionObserver = ImmediateIntersectionObserver;
}

function uninstallIntersectionObserver(): void {
  globalThis.IntersectionObserver = originalIO;
}

describe('ParentalNoticeDialog', () => {
  beforeEach(() => {
    installImmediateIntersectionObserver();
    useComplianceStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    uninstallIntersectionObserver();
    vi.clearAllMocks();
  });

  it('does not fetch or render content while closed', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(
      <ParentalNoticeDialog
        open={false}
        onAcknowledged={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fetches notice on open and renders markdown headings + processors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(noticeResponse()) as unknown as typeof fetch;

    render(
      <ParentalNoticeDialog
        open
        onAcknowledged={() => undefined}
        onClose={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /^Notice$/ })).toBeDefined();
    });
    expect(screen.getByRole('heading', { level: 4, name: /Section/i })).toBeDefined();
    // Raw markdown syntax must not appear.
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    // Six processors at-a-glance — Supabase first, openai last (case-insensitive).
    expect(screen.getAllByText(/supabase/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/openai/i).length).toBeGreaterThan(0);
  });

  it('clicking acknowledge POSTs and fires onAcknowledged on success', async () => {
    let callIndex = 0;
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callIndex++;
      if (callIndex === 1) return noticeResponse();
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string) as { document_version: string };
      expect(body.document_version).toBe('v1');
      return ackResponse();
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onAcknowledged = vi.fn();
    render(
      <ParentalNoticeDialog
        open
        onAcknowledged={onAcknowledged}
        onClose={() => undefined}
      />,
    );

    const ackBtn = await screen.findByRole('button', {
      name: /I've read this — start adding my child/i,
    });
    await waitFor(() => {
      expect((ackBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(ackBtn);

    await waitFor(() => {
      expect(onAcknowledged).toHaveBeenCalledWith('2026-04-27T12:00:00.000Z', 'v1');
    });
  });

  it('GET failure shows alert + retry button that re-fetches', async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify({}), { status: 500 });
      }
      return noticeResponse();
    }) as unknown as typeof fetch;

    render(
      <ParentalNoticeDialog
        open
        onAcknowledged={() => undefined}
        onClose={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /I've read this — start adding my child/i }),
      ).toBeDefined();
    });
  });

  it('POST failure shows inline alert + re-enables button + does not fire onAcknowledged', async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return noticeResponse();
      return new Response(JSON.stringify({}), { status: 500 });
    }) as unknown as typeof fetch;

    const onAcknowledged = vi.fn();
    render(
      <ParentalNoticeDialog
        open
        onAcknowledged={onAcknowledged}
        onClose={() => undefined}
      />,
    );

    const ackBtn = await screen.findByRole('button', {
      name: /I've read this — start adding my child/i,
    });
    await waitFor(() => {
      expect((ackBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(ackBtn);

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect((ackBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
