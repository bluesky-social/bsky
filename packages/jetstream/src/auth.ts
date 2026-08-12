/** The `Authorization` header value for an API key. */
export function bearerAuth(apiKey: string): string {
  return `Bearer ${apiKey}`
}

// Header-field-value per RFC 9110 §5.5: HTAB, SP, visible ASCII, obs-text.
// This is what Headers accepts; anything else (notably CR, LF, NUL) makes
// Headers.set() throw — and that TypeError echoes the offending value, which
// is exactly the leak this validator exists to prevent.
const VALID_HEADER_VALUE_CHARS = /^[\t\x20-\x7e\x80-\xff]+$/

/**
 * Validates that `apiKey` is safe to use as an `Authorization` header value,
 * so a malformed or empty key fails fast at construction time rather than
 * throwing mid-stream from Headers.set() with the raw key embedded in the
 * error (a multi-line key does this), or silently sending every request
 * unauthenticated (an empty string is falsy, so naive branches skip auth).
 *
 * Throws an Error whose message never contains any part of `apiKey`.
 */
export function assertValidApiKey(apiKey: string): void {
  if (apiKey.trim().length === 0) {
    throw new Error(
      'jetstream: apiKey must be a non-empty string (got an empty or whitespace-only string)',
    )
  }
  if (!VALID_HEADER_VALUE_CHARS.test(apiKey)) {
    throw new Error(
      'jetstream: apiKey contains a character that is not valid in an HTTP header value (e.g. a newline, carriage return, or NUL byte) — check for a multi-line or wrapped key',
    )
  }
}

/**
 * Wraps a fetch so every request carries `Authorization: Bearer <apiKey>`.
 *
 * Set-if-absent: a request that already carries an Authorization header
 * keeps it — an explicitly set header wins over the client-level key. Never
 * append()s, which would comma-join two credentials into an unparseable
 * value.
 */
export function withBearer(f: typeof fetch, apiKey: string): typeof fetch {
  return (input, init) => {
    // Mirrors WHATWG precedence: when init.headers is present it replaces the
    // Request's headers entirely, so seed from init first and fall back to
    // the Request only when init carries none.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    if (!headers.has('authorization')) {
      headers.set('authorization', bearerAuth(apiKey))
    }
    return f(input, { ...init, headers })
  }
}
