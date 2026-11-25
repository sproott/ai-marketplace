import { definePlugin } from '@oxlint/plugins'
import noEffectServiceDestructuring from './rules/no-effect-service-destructuring.ts'
import noManualTag from './rules/no-manual-tag.ts'
import noThrow from './rules/no-throw.ts'

export default definePlugin({
  meta: { name: 'cli' },
  rules: {
    'no-effect-service-destructuring': noEffectServiceDestructuring,
    'no-manual-tag': noManualTag,
    'no-throw': noThrow,
  },
})
