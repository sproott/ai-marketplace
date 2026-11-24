import { defineRule } from '@oxlint/plugins';

export default defineRule({
  meta: {
    type: 'problem',
    schema: [],
    messages: { useTypedFailure: 'Return a typed Effect or Result failure instead of throwing.' },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: 'useTypedFailure' });
      },
    };
  },
});
