// src/jetstream.ts
import { type JetstreamConsumer } from './consumer.js'
import { type CollectionFilter, resolveNsids } from './engine/collections.js'
import { type EventBatch, type RawEventV1, type TypedEvent } from './event.js'
import { type CursorStore } from './execute/cursor-store.js'
import { type TypedEventFor } from './filter-types.js'
import { batchEvents, liveEvents } from './live/source.js'
import { type LiveTransport } from './live/transport.js'
import { JetstreamRunner } from './runner.js'
import { shape } from './shape.js'

export interface JetstreamOpts {
  service: string
}

export interface LiveOpts<
  F extends readonly CollectionFilter[] = readonly CollectionFilter[],
> {
  collections?: F
  dids?: string[]
  cursor?: CursorStore
  signal?: AbortSignal
  onError?: (err: Error) => void
  liveTransport?: LiveTransport
  liveBatchSize?: number
  raw?: boolean
}

export class Jetstream {
  readonly service: string
  readonly opts: JetstreamOpts

  constructor(service: string | JetstreamOpts) {
    const opts = typeof service === 'string' ? { service } : service
    this.service = opts.service
    this.opts = opts
  }

  live<const F extends readonly CollectionFilter[] = readonly []>(
    opts?: LiveOpts<F> & { raw?: false },
  ): AsyncGenerator<TypedEventFor<F>>
  live(opts: LiveOpts & { raw: true }): AsyncGenerator<RawEventV1>
  live(opts: LiveOpts = {}): AsyncGenerator<RawEventV1 | TypedEvent> {
    const { schemasByNsid } = resolveNsids(opts.collections ?? [])
    return shape(this.liveRawBatches(opts), opts, schemasByNsid, opts.onError)
  }

  runner(consumer: JetstreamConsumer): JetstreamRunner {
    return new JetstreamRunner(this, consumer)
  }

  // The raw batch stream underlying live(); the runner drives it directly
  // (the source package reached it through live()'s batched mode, which is
  // not part of this package's public surface).
  async *liveRawBatches(
    opts: LiveOpts,
  ): AsyncGenerator<EventBatch<RawEventV1>> {
    const host = this.service
    const { nsids } = resolveNsids(opts.collections ?? [])
    const batchSize = opts.liveBatchSize ?? 64
    const start = await opts.cursor?.load()
    yield* batchEvents(
      liveEvents({
        host,
        collections: nsids,
        dids: opts.dids,
        cursor: start,
        dedupFloor: start, // a resume cursor is also the dedup floor
        transport: opts.liveTransport,
        signal: opts.signal,
        onError: opts.onError,
      }),
      batchSize,
    )
  }
}
