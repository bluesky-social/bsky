import { MalformedError } from '../errors.js'

/**
 * Decompresses a single zstd frame. Throws if the frame is invalid or the
 * decoded size would exceed maxDecodedBytes (zstd-bomb guard).
 */
export interface Decompressor {
  decompress(frame: Uint8Array, maxDecodedBytes?: number): Uint8Array
}

// Generous vs the ~256 MB segment target, tight enough to bound a hostile
// frame. Mirrors the Go server's maxDecodedBlockBytes.
export const MAX_DECODED_BLOCK_BYTES = 1 << 30 // 1 GiB

/**
 * Synchronous SHA-256. Must be sync: the lazy `cid` getter on archive put
 * commits computes on first property read (WebCrypto is async-only, which is
 * why the browser runtime has no default).
 */
export type Sha256 = (bytes: Uint8Array) => Uint8Array

/**
 * The platform defaults behind the `#runtime` imports condition. Both
 * branches (node/browser) export a `defaultRuntime` of this shape; injection
 * via JetstreamOpts always wins over these defaults.
 */
export interface JetstreamRuntime {
  /** May throw where the platform has no zstd (browser default). */
  zstdDecompressor(): Decompressor
  /** May throw where the platform has no sync sha256 (browser default). */
  sha256(): Sha256
}

/**
 * Wraps a raw one-frame zstd decompress in the shared bomb-guard semantics:
 * the raw call gets maxDecodedBytes as its output cap (abort mid-inflate),
 * an ERR_BUFFER_TOO_LARGE abort and any oversized result both become
 * MalformedError, and the result is normalized to a plain Uint8Array view.
 */
export function boundedDecompressor(
  raw: (frame: Uint8Array, maxOutputLength: number) => Uint8Array,
): Decompressor {
  return {
    decompress(frame, maxDecodedBytes = MAX_DECODED_BLOCK_BYTES) {
      let out
      try {
        out = raw(frame, maxDecodedBytes)
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new MalformedError('decompressed block exceeds size cap', {
            cause: err,
          })
        }
        throw err
      }
      if (out.length > maxDecodedBytes) {
        throw new MalformedError('decompressed block exceeds size cap')
      }
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
    },
  }
}
