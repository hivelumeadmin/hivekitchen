import type { Rule } from 'eslint';

const CSS_MAP: Record<string, string> = {
  marginLeft: 'marginInlineStart',
  marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart',
  paddingRight: 'paddingInlineEnd',
};

const TAILWIND_MAP: Record<string, string> = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
};

// Match ml-4, sm:ml-4, hover:ml-4, group-hover:ml-4, !ml-4, -ml-4, etc.
// Preceded by start/whitespace/(/:/!/-, so variants like `sm:ml-4` and quotes don't block it.
const TAILWIND_PATTERN = /(?:^|[\s'"`(!:-])(ml|mr|pl|pr)-[^\s'"`)\]]+/g;

const CLASSNAME_HELPERS = new Set(['clsx', 'cn', 'classnames', 'twMerge', 'twJoin']);

type Reporter = (node: Rule.Node, physical: string, logical: string) => void;

interface PropertyLike {
  type: string;
  key?: { type?: string; name?: string; value?: unknown };
}

function scanClassString(value: string, onMatch: (physical: string, logical: string) => void): void {
  TAILWIND_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = TAILWIND_PATTERN.exec(value);
  while (match !== null) {
    const prefix: string | undefined = match[1];
    if (prefix !== undefined) {
      const logical = TAILWIND_MAP[prefix];
      if (logical !== undefined) {
        // Capture group 0 has the leading char; strip it.
        const raw = match[0];
        const physicalToken = raw.slice(raw.indexOf(prefix));
        const logicalToken = physicalToken.replace(`${prefix}-`, `${logical}-`);
        onMatch(physicalToken, logicalToken);
      }
    }
    match = TAILWIND_PATTERN.exec(value);
  }
}

function walkClassValue(
  node: unknown,
  reporter: (physical: string, logical: string) => void,
): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  const n = node as { type?: string };
  if (n.type === 'Literal') {
    const literal = n as { value?: unknown };
    if (typeof literal.value === 'string') scanClassString(literal.value, reporter);
    return;
  }
  if (n.type === 'TemplateLiteral') {
    const tpl = n as { quasis?: ReadonlyArray<{ value?: { cooked?: unknown } }> };
    for (const quasi of tpl.quasis ?? []) {
      const cooked = quasi.value?.cooked;
      if (typeof cooked === 'string') scanClassString(cooked, reporter);
    }
    return;
  }
  if (n.type === 'ConditionalExpression') {
    const cond = n as { consequent?: unknown; alternate?: unknown };
    walkClassValue(cond.consequent, reporter);
    walkClassValue(cond.alternate, reporter);
    return;
  }
  if (n.type === 'LogicalExpression') {
    const log = n as { left?: unknown; right?: unknown };
    walkClassValue(log.left, reporter);
    walkClassValue(log.right, reporter);
    return;
  }
  if (n.type === 'CallExpression') {
    const call = n as {
      callee?: { type?: string; name?: string };
      arguments?: ReadonlyArray<unknown>;
    };
    const callee = call.callee;
    const helperName = callee?.type === 'Identifier' ? callee.name : undefined;
    if (helperName !== undefined && CLASSNAME_HELPERS.has(helperName)) {
      for (const arg of call.arguments ?? []) walkClassValue(arg, reporter);
    }
    return;
  }
  if (n.type === 'ArrayExpression') {
    const arr = n as { elements?: ReadonlyArray<unknown> };
    for (const el of arr.elements ?? []) walkClassValue(el, reporter);
  }
}

function checkStyleObject(
  objectExpr: { properties?: ReadonlyArray<PropertyLike> } | null | undefined,
  report: Reporter,
  anchor: Rule.Node,
): void {
  if (!objectExpr?.properties) return;
  for (const prop of objectExpr.properties) {
    if (prop.type !== 'Property') continue;
    const key = prop.key;
    if (!key) continue;
    let physical: string | undefined;
    if (key.type === 'Identifier' && typeof key.name === 'string') {
      physical = key.name;
    } else if (key.type === 'Literal' && typeof key.value === 'string') {
      physical = key.value;
    }
    if (physical === undefined) continue;
    const logical = CSS_MAP[physical];
    if (logical !== undefined) {
      report(anchor, physical, logical);
    }
  }
}

export const logicalPropertiesOnly: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require CSS logical properties over physical left/right properties for RTL/LTR support.',
    },
    schema: [],
    messages: {
      cssPhysical: "Use '{{logical}}' instead of '{{physical}}' for RTL/LTR support",
      tailwindPhysical: "Use Tailwind logical class '{{logical}}' instead of '{{physical}}'",
    },
  },
  create(context) {
    const reportCss: Reporter = (node, physical, logical) => {
      context.report({ node, messageId: 'cssPhysical', data: { physical, logical } });
    };
    const reportTailwind = (node: Rule.Node, physical: string, logical: string) => {
      context.report({ node, messageId: 'tailwindPhysical', data: { physical, logical } });
    };

    return {
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as {
          name: { type: string; name?: string };
          value: unknown;
        };
        if (attr.name?.type !== 'JSXIdentifier') return;
        const attrName = attr.name.name;

        if (attrName === 'style') {
          const value = attr.value as {
            type?: string;
            expression?: { type?: string; properties?: ReadonlyArray<PropertyLike> };
          } | null;
          if (
            !value ||
            value.type !== 'JSXExpressionContainer' ||
            value.expression?.type !== 'ObjectExpression'
          ) {
            return;
          }
          checkStyleObject(value.expression, reportCss, node as Rule.Node);
          return;
        }

        if (attrName === 'className') {
          const value = attr.value as
            | { type?: string; value?: unknown; expression?: unknown }
            | null;
          if (!value) return;
          if (value.type === 'Literal') {
            if (typeof value.value === 'string') {
              scanClassString(value.value, (physical, logical) =>
                reportTailwind(node as Rule.Node, physical, logical),
              );
            }
            return;
          }
          if (value.type === 'JSXExpressionContainer') {
            walkClassValue(value.expression, (physical, logical) =>
              reportTailwind(node as Rule.Node, physical, logical),
            );
          }
        }
      },
      JSXSpreadAttribute(node: Rule.Node) {
        const spread = node as unknown as {
          argument?: { type?: string; properties?: ReadonlyArray<PropertyLike> };
        };
        const arg = spread.argument;
        if (!arg || arg.type !== 'ObjectExpression') return;
        for (const prop of arg.properties ?? []) {
          if (prop.type !== 'Property') continue;
          const key = prop.key;
          if (!key) continue;
          const keyName =
            key.type === 'Identifier'
              ? key.name
              : key.type === 'Literal' && typeof key.value === 'string'
                ? key.value
                : undefined;
          if (keyName === 'style') {
            const propTyped = prop as unknown as {
              value?: { type?: string; properties?: ReadonlyArray<PropertyLike> };
            };
            if (propTyped.value?.type === 'ObjectExpression') {
              checkStyleObject(propTyped.value, reportCss, node as Rule.Node);
            }
          } else if (keyName === 'className') {
            const propTyped = prop as unknown as { value?: unknown };
            walkClassValue(propTyped.value, (physical, logical) =>
              reportTailwind(node as Rule.Node, physical, logical),
            );
          }
        }
      },
    };
  },
};

export default logicalPropertiesOnly;
