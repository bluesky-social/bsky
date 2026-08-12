import { LexError } from '@atproto/lex'

// The one wire-frame malformation code this package reports; there is no
// server taxonomy to match here, so a single fixed code is enough.
const MALFORMED_CODE = 'Malformed'

export class MalformedError extends LexError<typeof MALFORMED_CODE> {
  constructor(message: string, options?: ErrorOptions) {
    super(MALFORMED_CODE, message, options)
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
