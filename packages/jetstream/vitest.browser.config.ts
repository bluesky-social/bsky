import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Exercise the browser branch of the `#runtime` imports condition: the
      // archive defaults are throwing shims, and live() must never touch them.
      '#runtime': new URL('./src/runtime/browser.ts', import.meta.url).pathname,
    },
  },
  test: {
    name: 'jetstream:browser-runtime',
    include: ['tests/browser-runtime/**/*.test.ts'],
  },
})
