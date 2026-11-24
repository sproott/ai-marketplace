import { defineRule, type ESTree, type Scope } from '@oxlint/plugins';

const services = new Map<string, readonly string[]>([
  ['effect', ['FileSystem', 'Path']],
  ['effect/FileSystem', ['FileSystem']],
  ['effect/Path', ['Path']],
  ['effect/process', ['ChildProcessSpawner']],
  ['effect/testing', ['TestConsole']],
  ['effect/crypto', ['Digest']],
]);

export default defineRule({
  meta: {
    type: 'problem',
    schema: [],
    messages: { keepService: 'Keep the Effect service intact and access its API as fields.' },
  },
  create(context) {
    function binding(node: ESTree.Node) {
      if (node.type !== 'Identifier') return undefined;

      for (let scope: Scope | null = context.sourceCode.getScope(node); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable !== undefined) return variable.defs[0]?.node;
      }
    }

    function isServiceYield(node: ESTree.Node | null | undefined): boolean {
      if (node?.type !== 'YieldExpression' || !node.delegate) return false;

      const tag = node.argument;
      const member = tag?.type === 'MemberExpression' && !tag.computed && tag.property.type === 'Identifier' ? tag : undefined;
      const name = member?.property.type === 'Identifier' ? member.property.name : undefined;
      const imported = binding(member?.object ?? tag ?? node);
      const declaration = imported?.parent;
      if (imported === undefined || declaration?.type !== 'ImportDeclaration') return false;

      const module = declaration.source.value;
      const allowed = services.get(module) ?? [];

      if (imported.type === 'ImportNamespaceSpecifier') return name !== undefined && allowed.includes(name);
      if (imported.type !== 'ImportSpecifier' || imported.imported.type !== 'Identifier') return false;

      const symbol = imported.imported.name;
      return allowed.includes(symbol) && (name === symbol || (name === undefined && module === `effect/${symbol}`));
    }

    function isService(node: ESTree.Node | null | undefined): boolean {
      if (isServiceYield(node)) return true;
      const declared = node === null || node === undefined ? undefined : binding(node);
      return declared?.type === 'VariableDeclarator' && isServiceYield(declared.init);
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type === 'ObjectPattern' && isService(node.init)) {
          context.report({ node: node.id, messageId: 'keepService' });
        }
      },
      AssignmentExpression(node) {
        if (node.left.type === 'ObjectPattern' && isService(node.right)) {
          context.report({ node: node.left, messageId: 'keepService' });
        }
      },
    };
  },
});
