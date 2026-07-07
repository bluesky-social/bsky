export class MalformedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedError'
  }
}
