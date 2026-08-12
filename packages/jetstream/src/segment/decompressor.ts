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

let node: Decompressor | undefined

type ZstdDecompressSync = (
  frame: Uint8Array,
  opts: { maxOutputLength: number },
) => Uint8Array

// Non-literal specifier: src type-checks without Node types, and bundlers
// won't try to resolve node:zlib for the browser.
const NODE_ZLIB = 'node:zlib'

/**
 * The default zstd decompressor, backed by node:zlib. Loaded lazily via
 * dynamic import so this module stays importable outside Node; non-Node
 * runtimes must supply their own Decompressor, and this throws rather than
 * falling back if node:zlib is unavailable.
 */
export async function nodeDecompressor(): Promise<Decompressor> {
  if (node) return node
  let zlib: { zstdDecompressSync?: ZstdDecompressSync }
  try {
    zlib = (await import(NODE_ZLIB)) as {
      zstdDecompressSync?: ZstdDecompressSync
    }
  } catch (cause) {
    throw new Error(
      'node:zlib is unavailable in this runtime: supply your own zstd Decompressor',
      { cause },
    )
  }
  const { zstdDecompressSync } = zlib
  if (typeof zstdDecompressSync !== 'function') {
    throw new Error(
      'node:zlib lacks zstdDecompressSync (requires Node >= 22.15): supply your own zstd Decompressor',
    )
  }
  node = {
    decompress(frame, maxDecodedBytes = MAX_DECODED_BLOCK_BYTES) {
      let out
      try {
        // maxOutputLength aborts rather than ballooning memory on a hostile frame.
        out = zstdDecompressSync(frame, { maxOutputLength: maxDecodedBytes })
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
  return node
}
