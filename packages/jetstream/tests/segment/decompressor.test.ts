import { zstdCompressSync } from 'node:zlib'
import { expect, test } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { defaultRuntime } from '../../src/runtime/node.js'

const d = defaultRuntime.zstdDecompressor()

test('round-trips a zstd frame', () => {
  const original = new TextEncoder().encode('hello jetstream'.repeat(100))
  const frame = new Uint8Array(zstdCompressSync(original))
  const out = d.decompress(frame)
  expect(new TextDecoder().decode(out)).toBe(new TextDecoder().decode(original))
})

test('rejects output exceeding the cap', () => {
  const original = new Uint8Array(1024)
  const frame = new Uint8Array(zstdCompressSync(original))
  expect(() => d.decompress(frame, 16)).toThrow(MalformedError)
})

test('rejects a non-zstd frame', () => {
  expect(() => d.decompress(new Uint8Array([1, 2, 3]))).toThrow()
})

test('returns a cached instance', () => {
  expect(defaultRuntime.zstdDecompressor()).toBe(d)
})
