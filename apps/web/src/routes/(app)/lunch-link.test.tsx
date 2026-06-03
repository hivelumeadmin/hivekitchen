import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const publicGetMock = vi.fn();
const publicPostMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
  publicGet: (path: string) => publicGetMock(path),
  publicPost: (path: string, body: unknown) => publicPostMock(path, body),
}));

import LunchLinkRoute from './lunch-link.js';

// Valid HMAC token shape: {base64url}.{64 hex}. Not a 52-char `test-` stub.
const HMAC_TOKEN = `abc.${'a'.repeat(64)}`;

const PAYLOAD = {
  childName: 'Asha',
  date: '2026-06-03',
  heartNote: { body: 'Have a great day', authorDisplayName: 'Mum' },
  bag: { name: 'Pita pocket', sub: 'with hummus', safetyNote: 'Nut-free' },
  rating: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  publicGetMock.mockResolvedValue({ status: 200, body: PAYLOAD });
  publicPostMock.mockResolvedValue({ status: 201, body: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 4-S16 AC10 — the child "Tell {parent} back" request textarea carries
// dir="auto" so a child writing in the family's home script flows correctly.
describe('LunchLink route — dir="auto" on the child-request input (4-S16)', () => {
  it('#child-request-input carries dir="auto"', async () => {
    render(
      <MemoryRouter initialEntries={[`/lunch/${HMAC_TOKEN}`]}>
        <Routes>
          <Route path="/lunch/:linkId" element={<LunchLinkRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    const textarea = await screen.findByLabelText('Tell Mum back');
    expect(textarea.getAttribute('id')).toBe('child-request-input');
    expect(textarea.getAttribute('dir')).toBe('auto');
  });
});
