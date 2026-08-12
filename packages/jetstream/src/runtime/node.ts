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

export const defaultRuntime: JetstreamRuntime = {
  /**
   * zstd via node:zlib. zstdDecompressSync arrived in Node 22.15 while
   * engines is advisory, so the existence check stays at call time: a
   * live()-only consumer on an older Node must not crash, and a snapshot
   * consumer gets told exactly what to do.
   */
  zstdDecompressor(): Decompressor {
    if (decompressor) return decompressor
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error(
        'node:zlib lacks zstdDecompressSync (requires Node >= 22.15): supply your own zstd Decompressor',
      )
    }
    return (decompressor = boundedDecompressor((frame, maxOutputLength) =>
      zlib.zstdDecompressSync(frame, { maxOutputLength }),
    ))
  },

  sha256(): Sha256 {
    return (sha256 ??= (bytes) =>
      new Uint8Array(createHash('sha256').update(bytes).digest()))
  },
}
