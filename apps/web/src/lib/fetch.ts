import type { AuthUser } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export interface HkFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;  // Story 3.12: caller-provided headers (e.g. Idempotency-Key)
}

export class HkApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: unknown,
  ) {
    super(`HK API error ${status}`);
  }
}

// Deduplicated refresh — multiple concurrent 401s share one in-flight promise.
let _refreshPromise: Promise<string | null> | null = null;

function decodeJwtPayload(
  token: string,
): { sub: string; hh: string; role: AuthUser['role'] } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part)) as { sub: string; hh: string; role: AuthUser['role'] };
  } catch {
    return null;
  }
}

/**
 * Attempt a silent token refresh via the httpOnly refresh cookie.
 * On success, sets the auth store and returns the new access token.
 * On any failure (cookie expired, network error, etc.) returns null.
 * Safe to call proactively on app mount to restore a session after a page reload.
 */
export function tryRefreshSession(): Promise<string | null> {
  if (_refreshPromise !== null) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const refreshRes = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!refreshRes.ok) return null;

      const { access_token } = (await refreshRes.json()) as { access_token: string };
      const jwtClaims = decodeJwtPayload(access_token);
      if (!jwtClaims) return null;

      const meRes = await fetch(`${API_BASE_URL}/v1/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
        credentials: 'include',
      });
      if (!meRes.ok) return null;

      const profile = (await meRes.json()) as { email: string; display_name: string | null };
      const user: AuthUser = {
        id: jwtClaims.sub,
        email: profile.email,
        display_name: profile.display_name,
        current_household_id: jwtClaims.hh ?? null,
        role: jwtClaims.role,
      };
      useAuthStore.getState().setSession(access_token, user);
      return access_token;
    } catch {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/**
 * Unauthenticated GET — for public endpoints that children access without
 * logging in (e.g. the Lunch Link verify route). Returns the raw status code
 * plus a parsed JSON body so callers can route on 200 vs 410 vs 404 without
 * the hkFetch throw-on-non-2xx contract.
 */
export async function publicGet(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'omit',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body
  }
  return { status: res.status, body };
}

/**
 * Unauthenticated POST — for public endpoints that children access without
 * logging in (emoji rating, etc.). Parallel to publicGet; never throws so
 * callers can fire-and-forget.
 */
export async function publicPost(
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let respBody: unknown = null;
  try {
    respBody = await res.json();
  } catch {
    // 204 or non-JSON body — ignore
  }
  return { status: res.status, body: respBody };
}

export async function hkFetch<T = unknown>(path: string, init: HkFetchInit): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken;
  // Caller headers first; then overwrite with Content-Type and Authorization so auth always wins.
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method,
    headers,
    credentials: 'include',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

  // On 401, attempt a silent token refresh and retry the request once.
  if (res.status === 401) {
    const newToken = await tryRefreshSession();
    if (newToken !== null) {
      const retryHeaders: Record<string, string> = { ...(init.headers ?? {}) };
      if (init.body !== undefined) retryHeaders['Content-Type'] = 'application/json';
      retryHeaders['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetch(`${API_BASE_URL}${path}`, {
        method: init.method,
        headers: retryHeaders,
        credentials: 'include',
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
      if (!retryRes.ok) {
        let problem: unknown = null;
        try { problem = await retryRes.json(); } catch { /* not JSON */ }
        throw new HkApiError(retryRes.status, problem);
      }
      if (retryRes.status === 204) return undefined as T;
      return (await retryRes.json()) as T;
    }
  }

  if (!res.ok) {
    let problem: unknown = null;
    try {
      problem = await res.json();
    } catch {
      // not JSON
    }
    throw new HkApiError(res.status, problem);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
