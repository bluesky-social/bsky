import { expect, test } from 'vitest'
import { MalformedError } from '../../src/errors.js'
import { SegKind, isCommitKind, isValidKind } from '../../src/segment/kind.js'
import { ReadCursor } from '../../src/segment/read-cursor.js'

test('reads little-endian integers and varints', () => {
  const buf = new Uint8Array([
    0x01, // u8
    0x02,
    0x00, // u16le = 2
    0x03,
    0x00,
    0x00,
    0x00, // u32le = 3
    0xac,
    0x02, // uvarint = 300
  ])
  const c = new ReadCursor(buf)
  expect(c.u8()).toBe(1)
  expect(c.u16le()).toBe(2)
  expect(c.u32le()).toBe(3)
  expect(c.uvarint()).toBe(300)
  expect(c.bytesLeft()).toBe(0)
})

test('take past end throws MalformedError', () => {
  const c = new ReadCursor(new Uint8Array([0x01]))
  expect(() => c.take(2)).toThrow(MalformedError)
})

test('lenBytes reads a length-prefixed slice', () => {
  const c = new ReadCursor(new Uint8Array([0x03, 0x61, 0x62, 0x63]))
  expect(new TextDecoder().decode(c.lenBytes())).toBe('abc')
})

test('kind helpers', () => {
  expect(isValidKind(SegKind.Create)).toBe(true)
  expect(isValidKind(0)).toBe(false)
  expect(isValidKind(8)).toBe(false)
  expect(isCommitKind(SegKind.Identity)).toBe(false)
  expect(isCommitKind(SegKind.CreateResync)).toBe(true)
})

test('uvarint overflow throws instead of losing precision', () => {
  // 10th byte at shift 63 may only contribute the top bit (Go semantics)...
  const tooBig = new ReadCursor(new Uint8Array([...Array(9).fill(0xff), 0x02]))
  expect(() => tooBig.uvarint()).toThrow(MalformedError)
  // ...and an 11th byte is always overflow.
  const tooLong = new ReadCursor(
    new Uint8Array([...Array(10).fill(0x80), 0x01]),
  )
  expect(() => tooLong.uvarint()).toThrow(MalformedError)
})
