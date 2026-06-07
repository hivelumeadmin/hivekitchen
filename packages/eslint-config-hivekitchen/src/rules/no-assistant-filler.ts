import type { Rule } from 'eslint';

// Assistant-theatrical waiting-filler / fetch-theatrical copy. Lumi waits like a
// person thinking, not a chatbot performing (AR-14 / §3.5). The ONE sanctioned
// waiting phrase is "one sec." (EARLY_ACK_COPY) — the bare form is intentionally
// NOT matched here (it has no "moment"/"just a"/"hang on" theatrics).
const FORBIDDEN =
  /let me pull (that|this|it) up|let me (look|check) (that|this|it) up|just a (moment|sec(ond)?)|one moment|hang on( a (sec|moment|minute))?|bear with me|give me a (moment|second|minute)|hold on( a (sec|moment))?/i;

export const noAssistantFiller: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid assistant-theatrical waiting-filler copy (AR-14 / §3.5). Lumi waits like a person, not a chatbot performing.',
    },
    messages: {
      forbidden:
        'AR-14 / §3.5: "{{value}}" is an assistant-theatrical waiting filler. ' +
        'Lumi waits like a person, not a chatbot performing. Use the sanctioned ' +
        'non-verbal pulse, or EARLY_ACK_COPY ("one sec.") for the rare >6s case.',
    },
    schema: [],
  },
  create(context) {
    function check(node: Rule.Node, value: string): void {
      if (FORBIDDEN.test(value)) {
        context.report({
          node,
          messageId: 'forbidden',
          data: { value: value.length > 60 ? `${value.slice(0, 60)}…` : value },
        });
      }
    }

    return {
      Literal(node) {
        const v = node.value;
        if (typeof v === 'string') {
          check(node as unknown as Rule.Node, v);
        }
      },
      TemplateElement(node) {
        const v = node.value.cooked ?? node.value.raw;
        if (typeof v === 'string') {
          check(node as unknown as Rule.Node, v);
        }
      },
    };
  },
};

export default noAssistantFiller;
