import { type JetstreamRuntime } from './interface.js'

// The browser has no platform default for either capability (no zstd; no
// sync sha256 — WebCrypto is async-only). These shims sit in every browser
// consumer's module graph, so they must load cleanly and only throw when a
// snapshot/replay path actually asks for the default; live() never calls
// them.
export const defaultRuntime: JetstreamRuntime = {
  zstdDecompressor(): never {
    throw new Error(
      'this runtime has no default zstd support: supply your own Decompressor via Jetstream options (decompressor) to use snapshot()/replay()',
    )
  },

  sha256(): never {
    throw new Error(
      'this runtime has no default synchronous sha256: supply your own via Jetstream options (sha256) to use snapshot()/replay()',
    )
  },
}
