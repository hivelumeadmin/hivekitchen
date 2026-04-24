import type { Rule } from 'eslint';

export interface ScopeRestrictions {
  forbiddenComponents: string[];
}

export type ScopeClass = 'app-scope' | 'child-scope' | 'grandparent-scope' | 'ops-scope';

export interface NoCrossScopeOptions {
  scopeAllowlist: Record<string, ScopeRestrictions>;
}

const SCOPE_BY_SEGMENT: ReadonlyArray<readonly [string, ScopeClass]> = [
  ['(child)/', 'child-scope'],
  ['(grandparent)/', 'grandparent-scope'],
  ['(ops)/', 'ops-scope'],
];

function detectScope(filename: string): ScopeClass {
  const normalized = filename.replace(/\\/g, '/');
  const routesAnchor = normalized.includes('apps/web/src/routes/')
    ? normalized.slice(normalized.indexOf('apps/web/src/routes/'))
    : normalized.includes('/routes/')
      ? normalized.slice(normalized.indexOf('/routes/'))
      : normalized;
  for (const [segment, scope] of SCOPE_BY_SEGMENT) {
    if (routesAnchor.includes(`/${segment}`) || routesAnchor.startsWith(segment)) {
      return scope;
    }
  }
  return 'app-scope';
}

export const noCrossScopeComponent: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid importing scope-locked components into the wrong UX scope route tree.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          scopeAllowlist: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                forbiddenComponents: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['forbiddenComponents'],
              additionalProperties: false,
            },
          },
        },
        required: ['scopeAllowlist'],
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden: "'{{name}}' is forbidden in .{{scope}} — see SCOPE_CHARTER.md",
    },
  },
  create(context) {
    const options = (context.options[0] ?? { scopeAllowlist: {} }) as NoCrossScopeOptions;
    const scope = detectScope(context.filename);
    const restriction = options.scopeAllowlist[scope];
    if (!restriction || restriction.forbiddenComponents.length === 0) {
      return {};
    }
    const forbidden = new Set(restriction.forbiddenComponents);

    function reportName(node: Rule.Node, name: string): void {
      if (forbidden.has(name)) {
        context.report({ node, messageId: 'forbidden', data: { name, scope } });
      }
    }

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const imported = specifier.imported;
            if (imported.type === 'Identifier') {
              reportName(specifier as unknown as Rule.Node, imported.name);
            }
          } else if (
            specifier.type === 'ImportDefaultSpecifier' ||
            specifier.type === 'ImportNamespaceSpecifier'
          ) {
            reportName(specifier as unknown as Rule.Node, specifier.local.name);
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source) return;
        for (const specifier of node.specifiers) {
          const exported = specifier.exported;
          const local = specifier.local;
          const localName = local.type === 'Identifier' ? local.name : null;
          const exportedName = exported.type === 'Identifier' ? exported.name : null;
          if (localName) reportName(specifier as unknown as Rule.Node, localName);
          if (exportedName && exportedName !== localName) {
            reportName(specifier as unknown as Rule.Node, exportedName);
          }
        }
      },
    };
  },
};

export default noCrossScopeComponent;
