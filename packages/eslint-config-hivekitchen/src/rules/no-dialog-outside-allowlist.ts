import type { Rule } from 'eslint';

const DIALOG_SOURCE_EXACT = new Set([
  '@radix-ui/react-dialog',
  '@radix-ui/react-alert-dialog',
  'vaul',
  'cmdk',
]);

const DIALOG_NAME_PATTERN = /Dialog|AlertDialog|Sheet|Drawer/;

export interface NoDialogOptions {
  allowlist: string[];
}

export const noDialogOutsideAllowlist: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Restrict dialog/modal primitives to the four allowlisted feature directories (auth, safety, command-palette, memory).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['allowlist'],
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        'Dialog/modal primitives are restricted — only allowed in auth, safety, command-palette, and memory (Phase 2) features',
    },
  },
  create(context) {
    const options = (context.options[0] ?? { allowlist: [] }) as NoDialogOptions;
    const filename = context.filename.replace(/\\/g, '/');
    const isAllowed = options.allowlist.some((substr) => filename.includes(substr));
    if (isAllowed) return {};

    function sourceMatches(source: string): boolean {
      if (DIALOG_SOURCE_EXACT.has(source)) return true;
      // Any @radix-ui/* module whose specifier names suggest a dialog primitive.
      return source.startsWith('@radix-ui/');
    }

    function hasDialogNamedImport(node: {
      specifiers: ReadonlyArray<{ type: string; imported?: { type: string; name: string }; local?: { name: string } }>;
    }): boolean {
      return node.specifiers.some((specifier) => {
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported?.type === 'Identifier'
        ) {
          return DIALOG_NAME_PATTERN.test(specifier.imported.name);
        }
        if (
          (specifier.type === 'ImportDefaultSpecifier' ||
            specifier.type === 'ImportNamespaceSpecifier') &&
          specifier.local?.name
        ) {
          return DIALOG_NAME_PATTERN.test(specifier.local.name);
        }
        return false;
      });
    }

    return {
      ImportDeclaration(node) {
        const source = typeof node.source.value === 'string' ? node.source.value : '';
        if (DIALOG_SOURCE_EXACT.has(source)) {
          context.report({ node, messageId: 'forbidden' });
          return;
        }
        if (sourceMatches(source) && hasDialogNamedImport(node as unknown as {
          specifiers: ReadonlyArray<{ type: string; imported?: { type: string; name: string }; local?: { name: string } }>;
        })) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

export default noDialogOutsideAllowlist;
