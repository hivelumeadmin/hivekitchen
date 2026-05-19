import { tavily } from '@tavily/core';
import type { TavilyClient } from '@tavily/core';

// Story 3-31 — thin factory so the plugin layer and tests can both
// construct a Tavily client without importing the @tavily/core symbol
// directly. The client is otherwise stateless; one per process is fine.

export function createTavilyClient(apiKey: string): TavilyClient {
  return tavily({ apiKey });
}

export type { TavilyClient };
