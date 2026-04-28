import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingConsent } from './OnboardingConsent.js';

const SAMPLE_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const originalFetch = globalThis.fetch;
const originalIO = globalThis.IntersectionObserver;

function consentDeclarationResponse(opts: { content?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      document_version: 'v1',
      content: opts.content ?? '# HiveKitchen Beta\n\nDeclaration text…',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function vpcConsentResponse(): Response {
  return new Response(
    JSON.stringify({
      household_id: SAMPLE_HOUSEHOLD_ID,
      signed_at: '2026-04-27T12:00:00.000Z',
      mechanism: 'soft_signed_declaration',
      document_version: 'v1',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function installImmediateIntersectionObserver(): void {
  // jsdom does not provide IntersectionObserver. Install a constructable stub
  // whose observe() fires the callback synchronously with isIntersecting=true,
  // so the scroll-gate resolves immediately in tests.
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

describe('OnboardingConsent', () => {
  beforeEach(() => {
    installImmediateIntersectionObserver();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    uninstallIntersectionObserver();
    vi.clearAllMocks();
  });

  it('renders loading state on mount', () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;

    render(<OnboardingConsent onConsented={() => undefined} />);

    expect(screen.getByText(/Loading/i)).toBeDefined();
  });

  it('renders the declaration content after a successful GET', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      consentDeclarationResponse({ content: 'Declaration body for testing.' }),
    ) as unknown as typeof fetch;

    render(<OnboardingConsent onConsented={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText(/Declaration body for testing/i)).toBeDefined();
    });
    // Sign button is enabled because our mocked IntersectionObserver fires
    // isIntersecting=true synchronously on observe().
    const signBtn = screen.getByRole('button', { name: /I agree and sign/i }) as HTMLButtonElement;
    await waitFor(() => {
      expect(signBtn.disabled).toBe(false);
    });
  });

  it('clicking the sign button POSTs and calls onConsented on success', async () => {
    let callIndex = 0;
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callIndex++;
      if (callIndex === 1) return consentDeclarationResponse();
      // Assert the POST shape.
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string) as { document_version: string };
      expect(body.document_version).toBe('v1');
      return vpcConsentResponse();
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onConsented = vi.fn();
    render(<OnboardingConsent onConsented={onConsented} />);

    const signBtn = await screen.findByRole('button', { name: /I agree and sign/i });
    await waitFor(() => {
      expect((signBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(signBtn);

    await waitFor(() => {
      expect(onConsented).toHaveBeenCalled();
    });
  });

  it('GET failure shows an error and a working retry button', async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return new Response(JSON.stringify({ type: '/errors/internal' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return consentDeclarationResponse();
    }) as unknown as typeof fetch;

    render(<OnboardingConsent onConsented={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /I agree and sign/i })).toBeDefined();
    });
  });

  it('renders markdown headings and lists (not raw markup)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      consentDeclarationResponse({
        content: '# HiveKitchen Beta\n\n## Section\n\n- **bold** item\n- second item',
      }),
    ) as unknown as typeof fetch;

    render(<OnboardingConsent onConsented={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /HiveKitchen Beta/i })).toBeDefined();
    });
    expect(screen.getByRole('heading', { level: 2, name: /Section/i })).toBeDefined();
    // Raw markdown syntax must not appear in the rendered DOM.
    expect(screen.queryByText(/^#\s/)).toBeNull();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
    // Lists render with strong-styled emphasis.
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('POST failure shows an inline error and re-enables the sign button', async () => {
    let callIndex = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return consentDeclarationResponse();
      return new Response(JSON.stringify({ type: '/errors/internal' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const onConsented = vi.fn();
    render(<OnboardingConsent onConsented={onConsented} />);

    const signBtn = await screen.findByRole('button', { name: /I agree and sign/i });
    await waitFor(() => {
      expect((signBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(signBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(onConsented).not.toHaveBeenCalled();
    // Sign button re-enabled so the user can retry.
    expect((signBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
