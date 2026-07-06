// Ported from jetstream-sdk src/segment/read-cursor.ts (the v1-live subset
// carries no segment machinery, so the error class lives here). The `segment:`
// message prefix is preserved verbatim from the source package.
export class MalformedError extends Error {
  constructor(message: string) {
    super(`segment: ${message}`)
    this.name = 'MalformedError'
  }
}
