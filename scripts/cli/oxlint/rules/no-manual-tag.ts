import { defineRule } from '@oxlint/plugins'

export default defineRule({
  meta: {
    type: 'problem',
    schema: [],
    messages: { useConstructor: 'Use a tagged variant constructor instead of setting _tag in an object literal.' },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        for (const property of node.properties) {
          if (property.type !== 'Property') continue

          const key = property.key
          const manualTag =
            (key.type === 'Identifier' && !property.computed && key.name === '_tag') ||
            (key.type === 'Literal' && key.value === '_tag')
          if (manualTag) context.report({ node: key, messageId: 'useConstructor' })
        }
      },
    }
  },
})
