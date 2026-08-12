import { expect, test } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { nodeDecompressor } from '../../src/segment/decompressor.js'
import { MalformedError } from '../../src/errors.js'

const d = await nodeDecompressor()

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

test('resolves to a cached instance', async () => {
  expect(await nodeDecompressor()).toBe(d)
})
