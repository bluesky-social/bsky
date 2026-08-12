import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Tests run source files (not built dist), so mirror the package.json
      // `imports` node condition here. vitest.browser.config.ts mirrors the
      // default (browser) condition.
      '#runtime': new URL('./src/runtime/node.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/browser-runtime/**'],
  },
})
