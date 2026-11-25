import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'scripts/cli/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'packages/_shared/hook-io/**/*.test.ts',
    ],
  },
})
