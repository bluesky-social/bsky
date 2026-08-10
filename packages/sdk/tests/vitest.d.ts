import type {} from 'vitest'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toBeModerationResult(
      expected:
        | import('./util/moderation-behavior.js').ModerationTestSuiteResultFlag[]
        | undefined,
      context?: string,
      stringifiedResult?: string,
      ignoreCause?: boolean,
    ): void
  }
}
