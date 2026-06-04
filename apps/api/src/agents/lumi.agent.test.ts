import { describe, it, expect } from 'vitest';
import { LumiAgent } from './lumi.agent.js';

describe('LumiAgent (stub — Story 12-S8)', () => {
  it('respond() resolves the fixed "Got it." reply for any message', async () => {
    const agent = new LumiAgent();

    const a = await agent.respond({ message: 'What did Maya have yesterday?' });
    const b = await agent.respond({ message: '' });

    expect(a).toBe('Got it.');
    expect(b).toBe('Got it.');
  });
});
