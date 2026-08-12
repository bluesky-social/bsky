import { createHash } from 'node:crypto'
import * as zlib from 'node:zlib'
import {
  type Decompressor,
  type JetstreamRuntime,
  type Sha256,
  boundedDecompressor,
} from './interface.js'

let decompressor: Decompressor | undefined
let sha256: Sha256 | undefined

/**
 * zstd via node:zlib. zstdDecompressSync arrived in Node 22.15 while the
 * package floor is what package.json says — engines is advisory, so the
 * existence check stays at call time: a live()-only consumer on an older
 * Node must not crash, and an archive consumer gets told exactly what to do.
 */
export function defaultDecompressor(): Decompressor {
  if (decompressor) return decompressor
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error(
      'node:zlib lacks zstdDecompressSync (requires Node >= 22.15): supply your own zstd Decompressor',
    )
  }
  return (decompressor = boundedDecompressor((frame, maxOutputLength) =>
    zlib.zstdDecompressSync(frame, { maxOutputLength }),
  ))
}

export function defaultSha256(): Sha256 {
  return (sha256 ??= (bytes) =>
    new Uint8Array(createHash('sha256').update(bytes).digest()))
}

export const runtime = {
  defaultDecompressor,
  defaultSha256,
} satisfies JetstreamRuntime
