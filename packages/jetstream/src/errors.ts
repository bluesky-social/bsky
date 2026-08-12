import { LexError } from '@atproto/lex'

// Deliberately a plain Error, not a LexError: malformed wire data is a
// client-side decode failure, not part of any lex/xrpc error taxonomy.
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
export class XrpcSubscriptionError extends LexError {
  constructor(error: string, message: string) {
    super(error, message)
    this.name = 'XrpcSubscriptionError'
  }
}
