import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noHeartNoteFrequencyReference } from './no-heart-note-frequency-reference.js';

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

tester.run('no-heart-note-frequency-reference', noHeartNoteFrequencyReference, {
  valid: [
    {
      name: 'heart_note context with no forbidden strings passes',
      code: `import { HeartNoteRepository } from './heart-note.repository'; const label = "Send a note";`,
    },
    {
      name: 'forbidden string without heart_note context passes',
      code: `const msg = "You haven't written anything in a while";`,
    },
    {
      name: 'forbidden string in a completely unrelated file passes',
      code: `const x = "streak bonus";`,
    },
    {
      name: 'heart_note identifier with innocuous string passes',
      code: `const heartNoteId = '123'; const copy = "Have a great lunch!";`,
    },
  ],
  invalid: [
    {
      name: "import + haven't written fires",
      code: `import HeartNoteRepo from './heart-note.repository';
             const msg = "You haven't written Layla a note this week";`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'identifier + streak fires',
      code: `const heartNoteCount = 3; const copy = "You're on a 3-note streak!";`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'import + absence fires',
      code: `import { heartNoteService } from './heart-note.service'; const s = "Layla noticed your absence";`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'identifier + been quiet fires',
      code: `const HeartNoteStatus = {}; const t = "It's been quiet — Layla is waiting";`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'identifier + reminder fires',
      code: `const heart_notes = []; const s = "Reminder: send a Heart Note today";`,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'multiple forbidden strings in same file all report',
      code: `import HeartNote from './heart-note'; const a = "streak"; const b = "absence";`,
      errors: [{ messageId: 'forbidden' }, { messageId: 'forbidden' }],
    },
  ],
});
