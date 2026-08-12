export class MalformedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MalformedError'
  }
}

/**
 * A terminal error frame on the v2 subscription
 * (`{"$type":"error","error":…,"message":…}`). The server closes right after
 * sending one. This is a legitimate server signal (e.g. ConsumerTooSlow), not
 * malformed data — v2 only, since the v1 wire has no error frames.
 */
export class XrpcSubscriptionError extends Error {
  readonly error: string
  constructor(error: string, message: string) {
    super(message)
    this.name = 'XrpcSubscriptionError'
    this.error = error
  }
}
