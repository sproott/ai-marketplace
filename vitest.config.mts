import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/cli/tests/**/*.test.ts'],
  },
});
