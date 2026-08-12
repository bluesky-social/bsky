import { MalformedError } from '../errors.js'

/** Sequential little-endian reader over a byte buffer. */
export class ReadCursor {
  #off = 0
  readonly #buf: Uint8Array
  readonly #view: DataView

  constructor(buf: Uint8Array) {
    this.#buf = buf
    this.#view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  bytesLeft(): number {
    return this.#buf.length - this.#off
  }

  take(n: number): Uint8Array {
    if (n < 0 || this.#off + n > this.#buf.length) {
      throw new MalformedError('truncated or malformed input')
    }
    const s = this.#buf.subarray(this.#off, this.#off + n)
    this.#off += n
    return s
  }

  u8(): number {
    return this.take(1)[0]
  }

  u16le(): number {
    const o = this.#off
    this.take(2)
    return this.#view.getUint16(o, true)
  }

  u32le(): number {
    const o = this.#off
    this.take(4)
    return this.#view.getUint32(o, true)
  }

  u64leAsNumber(): number {
    const o = this.#off
    this.take(8)
    return Number(this.#view.getBigUint64(o, true))
  }

  i64leAsNumber(): number {
    const o = this.#off
    this.take(8)
    return Number(this.#view.getBigInt64(o, true))
  }

  uvarint(): number {
    let result = 0n
    let shift = 0n
    for (;;) {
      const b = this.u8()
      // The 10th byte sits at shift 63 and may only contribute the top bit
      // (Go binary.Uvarint semantics); anything larger overflows u64.
      if (shift === 63n && (b & 0x7f) > 1) {
        throw new MalformedError('uvarint overflow')
      }
      result |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7n
      if (shift > 63n) throw new MalformedError('uvarint overflow')
    }
    return Number(result)
  }

  lenBytes(): Uint8Array {
    return this.take(this.uvarint())
  }
}
