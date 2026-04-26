import { useAuthStore } from '@/stores/auth.store.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export interface HkFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export class HkApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: unknown,
  ) {
    super(`HK API error ${status}`);
  }
}

export async function hkFetch<T = unknown>(path: string, init: HkFetchInit): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method,
    headers,
    credentials: 'include',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

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
