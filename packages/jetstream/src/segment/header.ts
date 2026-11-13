import { MalformedError } from '../errors.js'
import { type FormatVersion } from './block.js'

export const RESERVED_HEADER_BYTES = 256
const MAGIC = 'jss0'

export interface SegHeader {
  version: FormatVersion
  blockCount: number
  eventCount: number
  footerOffset: number
  blockIndexOffset: number
}

/**
 * Parses the fixed 256-byte header of a sealed .jss segment. A zero checksum
 * marks an active (unsealed) segment, which is never served — reject it. The
 * header's version field is the segment format; anything other than
 * `expectedFormat` (default 1, the public archive) is rejected.
 */
export function readSealedHeader(
  buf: Uint8Array,
  expectedFormat: FormatVersion = 1,
): SegHeader {
  if (buf.length < RESERVED_HEADER_BYTES) {
    throw new MalformedError('segment shorter than fixed header')
  }
  const td = new TextDecoder()
  if (td.decode(buf.subarray(0, 4)) !== MAGIC) {
    throw new MalformedError('bad segment magic')
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const checksum = view.getBigUint64(4, true)
  if (checksum === 0n) {
    throw new MalformedError(
      'active (unsealed) segment: checksum field is zero',
    )
  }
  const version = view.getUint16(12, true)
  if (version !== 1 && version !== 2) {
    throw new MalformedError(`unsupported segment version ${version}`)
  }
  if (version !== expectedFormat) {
    throw new MalformedError(
      `segment format ${version} does not match expected format ${expectedFormat}`,
    )
  }
  return {
    version,
    blockCount: view.getUint32(14, true),
    eventCount: view.getUint32(18, true),
    footerOffset: Number(view.getBigUint64(58, true)),
    blockIndexOffset: Number(view.getBigUint64(90, true)),
  }
}
