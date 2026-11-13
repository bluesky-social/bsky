import { l, xrpc } from '@atproto/lex'
import { ProtocolError } from '../errors.js'
import { type FormatVersion } from '../segment/block.js'
import { isAbortError } from './retry.js'

// Three independent version axes, never conflated: the public Jetstream v2
// wire (the endpoint family), the Spaces logical contract (protocolVersion,
// negotiated here), and the archive artifact format (formatVersion, per plan
// entry). Public mode touches none of this module.
export const PROTOCOL_HEADER = 'jetstream-protocol-version'
export const FORMAT_HEADER = 'jetstream-format-version'
export const PROGRESS_HEADER = 'jetstream-progress'

/** The protocolVersion Spaces mode requires; aggregate Spaces archives need 2. */
export const SPACES_PROTOCOL_VERSION = 2

const getCapabilitiesDef = l.query(
  'network.bsky.jetstream.getCapabilities',
  l.params(),
  l.jsonPayload({
    protocolVersions: l.array(l.integer({ minimum: 1 })),
    formatVersions: l.array(l.integer({ minimum: 1 })),
    requiredProtocolVersion: l.integer({ minimum: 1 }),
    eventKinds: l.array(l.string()),
  }),
)

/**
 * The contract one Spaces consumption operation selected at its start and
 * reuses for every request it makes — plan pages, downloads, re-plans,
 * reconnects and the live cutover alike.
 */
export interface SpacesProtocol {
  protocolVersion: typeof SPACES_PROTOCOL_VERSION
  /** Archive formats both sides support (subset of 1 and 2). */
  formats: ReadonlySet<FormatVersion>
  /** Event kinds the server advertises. */
  kinds: ReadonlySet<string>
}

/**
 * Discovers and validates the server's capabilities, selecting the highest
 * protocol this client supports that meets requiredProtocolVersion. Spaces
 * mode needs protocol 2 with scope events; anything less (including any
 * discovery failure: network, auth, a plain 404) is a ProtocolError, never a
 * fallback to the public contract.
 */
export async function negotiateSpacesProtocol(opts: {
  host: string
  fetchImpl: typeof fetch
  signal?: AbortSignal
  kinds?: readonly string[]
}): Promise<SpacesProtocol> {
  let caps
  try {
    const res = await xrpc(
      { service: opts.host, fetch: opts.fetchImpl },
      getCapabilitiesDef,
      { signal: opts.signal },
    )
    caps = res.body
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ProtocolError(
      'jetstream: Spaces capability discovery (getCapabilities) failed',
      { cause: err },
    )
  }
  if (
    caps.protocolVersions.length === 0 ||
    caps.formatVersions.length === 0 ||
    caps.eventKinds.length === 0
  ) {
    throw new ProtocolError(
      'jetstream: malformed capabilities: missing versions or event kinds',
    )
  }
  let selected = 0
  for (const v of caps.protocolVersions) {
    if (
      v <= SPACES_PROTOCOL_VERSION &&
      v >= caps.requiredProtocolVersion &&
      v > selected
    ) {
      selected = v
    }
  }
  if (selected === 0) {
    throw new ProtocolError(
      `jetstream: no supported protocol meets requiredProtocolVersion=${caps.requiredProtocolVersion}`,
    )
  }
  if (selected !== SPACES_PROTOCOL_VERSION) {
    throw new ProtocolError(
      `jetstream: server does not offer Spaces protocolVersion=${SPACES_PROTOCOL_VERSION} (best common version ${selected})`,
    )
  }
  const formats = new Set<FormatVersion>()
  for (const v of caps.formatVersions) {
    if (v === 1 || v === 2) formats.add(v)
  }
  if (formats.size === 0) {
    throw new ProtocolError('jetstream: no supported archive format')
  }
  const kinds = new Set(caps.eventKinds)
  if (!kinds.has('scope')) {
    throw new ProtocolError(
      'jetstream: protocol 2 capabilities missing scope events',
    )
  }
  for (const kind of opts.kinds ?? []) {
    if (!kinds.has(kind)) {
      throw new ProtocolError(
        `jetstream: server does not support selected event kind ${JSON.stringify(kind)}`,
      )
    }
  }
  return { protocolVersion: SPACES_PROTOCOL_VERSION, formats, kinds }
}

/**
 * Checks a successful response's negotiated headers: the protocol header must
 * echo the selected protocol, and for an archive artifact the format header
 * must name a negotiated format that the protocol permits and that agrees
 * with the plan entry's formatVersion.
 */
export function assertNegotiatedHeaders(
  headers: Headers,
  protocol: SpacesProtocol,
  what: string,
  expectedFormat?: FormatVersion,
): void {
  const rawProtocol = headers.get(PROTOCOL_HEADER)
  if (rawProtocol !== String(protocol.protocolVersion)) {
    throw new ProtocolError(
      `jetstream: ${what}: missing or mismatched Jetstream-Protocol-Version (got ${JSON.stringify(rawProtocol)}, selected ${protocol.protocolVersion})`,
    )
  }
  if (expectedFormat === undefined) return
  const rawFormat = headers.get(FORMAT_HEADER)
  const format = Number(rawFormat)
  if (
    (format !== 1 && format !== 2) ||
    !protocol.formats.has(format) ||
    format > protocol.protocolVersion
  ) {
    throw new ProtocolError(
      `jetstream: ${what}: unsupported or missing Jetstream-Format-Version ${JSON.stringify(rawFormat)}`,
    )
  }
  if (format !== expectedFormat) {
    throw new ProtocolError(
      `jetstream: ${what}: artifact formatVersion header ${format} does not match plan ${expectedFormat}`,
    )
  }
}

/**
 * A plan entry's artifact format (absent means 1), checked against the
 * negotiated formats and the selected protocol.
 */
export function planEntryFormat(
  formatVersion: number | undefined,
  protocol: SpacesProtocol,
  name: string,
): FormatVersion {
  const format = formatVersion ?? 1
  if (
    (format !== 1 && format !== 2) ||
    !protocol.formats.has(format) ||
    format > protocol.protocolVersion
  ) {
    throw new ProtocolError(
      `jetstream: plan entry ${name} has unsupported formatVersion ${format}`,
    )
  }
  return format
}
