import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noAssistantFiller } from './no-assistant-filler.js';

const globalWithHooks = globalThis as unknown as {
  describe: typeof describe;
  it: typeof it;
};
globalWithHooks.describe = describe;
globalWithHooks.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('no-assistant-filler', noAssistantFiller, {
  valid: [
    {
      name: 'sanctioned "one sec." early-ack copy passes (AC#2)',
      code: `const EARLY_ACK_COPY = 'one sec.';`,
    },
    {
      name: 'revised LUMI_FALLBACK_REPLY genuine-cognition copy passes (AC#3)',
      code: `const LUMI_FALLBACK_REPLY = 'Let me think that through.';`,
    },
    {
      name: 'an innocuous string passes',
      code: `const label = 'Send a note';`,
    },
    {
      name: 'a template literal with no filler passes',
      code: 'const greeting = `Hi ${name}, your week is ready.`;',
    },
  ],
  invalid: [
    {
      name: '"Let me pull that up" fires',
      code: `const msg = 'Let me pull that up for you';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: '"Just a moment" fires',
      code: `const msg = 'Just a moment...';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: '"Hang on a sec" fires',
      code: `const msg = 'Hang on a sec';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: '"Bear with me" fires',
      code: `const msg = 'Bear with me while I check';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: '"Let me look that up" fires',
      code: `const msg = 'Let me look that up';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: '"Give me a moment" fires',
      code: `const msg = 'Give me a moment';`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'filler inside a template literal fires (TemplateElement)',
      code: 'const msg = `Let me pull that up for ${name}`;',
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
