import type { Rule } from 'eslint';

const FORBIDDEN = /streak|reminder|absence|haven't written|been quiet/i;
const HEART_NOTE_IMPORT = /heart[-_]?note/i;
const HEART_NOTE_IDENT = /HeartNote|heartNote|heart_note/;

export const noHeartNoteFrequencyReference: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid absence-nudge, streak, or frequency-reminder copy adjacent to heart_note references (FR43, Corollary 3b).',
    },
    messages: {
      forbidden:
        'FR43 / Corollary 3b: "{{value}}" is an absence-nudge or frequency reference. ' +
        'The Heart Note sacred channel must never become a guilt engine. Remove this copy.',
    },
    schema: [],
  },
  create(context) {
    let hasHeartNoteContext = false;
    const pending: Array<{ node: Rule.Node; value: string }> = [];

    return {
      ImportDeclaration(node) {
        const src = typeof node.source.value === 'string' ? node.source.value : '';
        if (HEART_NOTE_IMPORT.test(src)) {
          hasHeartNoteContext = true;
        }
      },
      Identifier(node) {
        if (HEART_NOTE_IDENT.test(node.name)) {
          hasHeartNoteContext = true;
        }
      },
      Literal(node) {
        const v = node.value;
        if (typeof v === 'string' && FORBIDDEN.test(v)) {
          pending.push({ node: node as unknown as Rule.Node, value: v });
        }
      },
      'Program:exit'() {
        if (!hasHeartNoteContext) return;
        for (const { node, value } of pending) {
          context.report({
            node,
            messageId: 'forbidden',
            data: { value: value.length > 60 ? `${value.slice(0, 60)}…` : value },
          });
        }
      },
    };
  },
};

