import { type DidString } from '@atproto/lex'
import {
  type CollectionFilter,
  parseCollectionFilters,
} from './engine/collections.js'
import { type RawEventV1 } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventV1For, type WideTypedEventV1 } from './filter-types.js'
import { type JetstreamOpts } from './jetstream.js'
import { rawBatchStream } from './live/pipeline.js'
import { type LiveTransport } from './live/transport.js'
import { shape } from './shape.js'

/**
 * Live options for a v1 instance. No `kinds`: the frozen v1 /subscribe wire has
 * no kind filter, so the option cannot be honoured.
 */
export interface LiveV1Opts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: DidString[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  raw?: boolean
}

/**
 * A Jetstream instance speaking the frozen v1 wire — what the public
 * jetstream*.bsky.network hosts serve today. Live streaming only: v1 has no
 * sealed archive, and its cursors are `time_us` values that are not portable
 * to or from a v2 host.
 */
export class JetstreamV1 {
  readonly service: string
  readonly opts: JetstreamOpts

  constructor(service: string | JetstreamOpts) {
    const opts = typeof service === 'string' ? { service } : service
    this.service = opts.service
    this.opts = opts
  }

  live<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: LiveV1Opts<F> & { raw?: false },
  ): AsyncGenerator<TypedEventV1For<F>>
  live(opts: LiveV1Opts & { raw: true }): AsyncGenerator<RawEventV1>
  live(opts: LiveV1Opts = {}): AsyncGenerator<RawEventV1 | WideTypedEventV1> {
    const { schemasByNsid } = parseCollectionFilters(opts.collections ?? [])
    // The cast here is unrelated to rawBatchStream's overload (its call above
    // is already the honest v1-only type): shape() is version-generic, so its
    // declared return covers both wires' possible outputs and needs narrowing
    // to this class's v1-only union.
    return shape(
      rawBatchStream(this.service, opts, 1, this.opts.validateWire),
      { ...opts, validateWire: this.opts.validateWire },
      schemasByNsid,
      opts.onError,
    ) as AsyncGenerator<RawEventV1 | WideTypedEventV1>
  }
}
