import {
  type AtUriString,
  type CidString,
  type DatetimeString,
  type DidString,
  type HandleString,
  type InferOutput,
  type Main,
  type NsidString,
  type RecordKeyString,
  type RecordSchema,
  type TidString,
  atUri,
  getMain,
} from '@atproto/lex-schema'
import { type ConsumerContext, type JetstreamConsumer } from './consumer.js'
import { typedEventFromRaw } from './decode-typed.js'
import { type CollectionFilter } from './engine/collections.js'
import {
  type EventBatch,
  type RawEventV1,
  type UnvalidatedRecord,
} from './event.js'
import { eventUri } from './event.js'

// Shared per-run context handed to every handler as the second arg. Allocated
// once per run (NOT per event). `signal` is REQUIRED: LexIndexer always
// provides one and guarantees it fires at least when the run winds down (stream
// end, error, or caller abort), so handlers can pass it to cancellable work
// (fetch, etc.) unconditionally. See LexIndexer.run for how it is synthesized
// from the optional seam ConsumerContext.signal.
export interface HandlerContext {
  signal: AbortSignal
}

export type PutEvent<R> = {
  did: DidString
  seq: number
  operation: 'create' | 'update'
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  cid: CidString
  uri: AtUriString
  record: R
}
export type DelEvent = {
  did: DidString
  seq: number
  operation: 'delete'
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  uri: AtUriString
}
// Same flat shape as PutEvent but carries the decode/validation `error` instead
// of a decoded `record`. Routed here (not to `put`) when a create/update record
// fails to schema-validate, so `put`'s `record` is always a valid decoded R.
export type ValidationErrorEvent = {
  did: DidString
  seq: number
  operation: 'create' | 'update'
  collection: NsidString
  rkey: RecordKeyString
  rev: TidString
  cid: CidString
  uri: AtUriString
  error: Error
}
export type IdentityEvent = {
  did: DidString
  handle?: HandleString
  time?: DatetimeString
  seq: number
}
export type AccountEvent = {
  did: DidString
  active: boolean
  status?: string
  time?: DatetimeString
  seq: number
}

export interface CommitHandlers<R> {
  put?: (e: PutEvent<R>, ctx: HandlerContext) => unknown | Promise<unknown>
  del?: (e: DelEvent, ctx: HandlerContext) => unknown | Promise<unknown>
}

export interface LexIndexerOpts {
  concurrency?: number
  keyOf?: (evt: RawEventV1) => string
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v !== null &&
  (typeof v === 'object' || typeof v === 'function') &&
  typeof (v as { then?: unknown }).then === 'function'

// Cache slot for the lazily-computed event uri. A symbol keeps it out of the
// event's declared type (and out of JSON/spread/Object.keys).
const kUri = Symbol('jetstream.uri')

// Lazily builds and caches the validated at:// URI of a commit event. PERF:
// most handlers never read `uri`; atUri validates (and can throw on mangled
// wire components), so the cost — and the throw — happen only on first read,
// inside the handler's guarded execution. The wire carries branded values
// earned at the decode boundary; atUri's runtime assertions guard against
// mangled wire data.
// `self` is the event object (`this` inside its getter); the cast adds the
// symbol slot the event types deliberately don't declare.
function lazyUri(
  self: object,
  did: DidString,
  commit: { collection: NsidString; rkey: RecordKeyString },
): AtUriString {
  const cache = self as { [kUri]?: AtUriString }
  return (cache[kUri] ??= atUri(did, commit.collection, commit.rkey))
}

// Internal, type-erased handler record stored per commit-collection NSID.
// Retains the resolved schema so run() can build the schemasByNsid map needed
// for typed record decode.
interface AnyCommitHandlers {
  schema: RecordSchema
  validateRecord: boolean
  put?: (
    e: PutEvent<unknown>,
    ctx: HandlerContext,
  ) => unknown | Promise<unknown>
  del?: (e: DelEvent, ctx: HandlerContext) => unknown | Promise<unknown>
}

export class LexIndexer implements JetstreamConsumer {
  readonly concurrency: number
  readonly #keyOf: ((evt: RawEventV1) => string) | undefined
  readonly #collections = new Map<NsidString, AnyCommitHandlers>()
  #identityHandler:
    | ((e: IdentityEvent, ctx: HandlerContext) => unknown | Promise<unknown>)
    | undefined
  #accountHandler:
    | ((e: AccountEvent, ctx: HandlerContext) => unknown | Promise<unknown>)
    | undefined
  #validationErrorHandler:
    | ((
        e: ValidationErrorEvent,
        ctx: HandlerContext,
      ) => unknown | Promise<unknown>)
    | undefined

  constructor(opts: LexIndexerOpts = {}) {
    this.concurrency = opts.concurrency ?? 16
    this.#keyOf = opts.keyOf
  }

  get collections(): CollectionFilter[] {
    return [...this.#collections.keys()]
  }

  // Simple form: register a collection with schema-validated records
  // (validateRecord defaults to true).
  commit<S extends RecordSchema>(
    collection: Main<S>,
    handlers: CommitHandlers<InferOutput<S>>,
  ): this
  // Options form, validating (default). The literal `true` (or omission) keeps
  // the schema-inferred record typing.
  commit<S extends RecordSchema>(opts: {
    collection: Main<S>
    handlers: CommitHandlers<InferOutput<S>>
    validateRecord?: true
  }): this
  // Options form, non-validating. The literal `false` selects the
  // UnvalidatedRecord handler typing: no runtime record checks — the $type
  // floor is trusted from the server's collection routing, not verified.
  commit<S extends RecordSchema>(opts: {
    collection: Main<S>
    handlers: CommitHandlers<UnvalidatedRecord<S['$type']>>
    validateRecord: false
  }): this
  commit<S extends RecordSchema>(
    collectionOrOpts:
      | Main<S>
      | {
          collection: Main<S>
          handlers: CommitHandlers<never>
          validateRecord?: boolean
        },
    maybeHandlers?: CommitHandlers<InferOutput<S>>,
  ): this {
    // Overload discrimination: a lex Main<S> schema is itself an object, but it
    // never carries BOTH `collection` and `handlers` keys (its keys are
    // key/$type/schema/type/keySchema), so requiring both cleanly selects the
    // opts form.
    const isOptsForm =
      typeof collectionOrOpts === 'object' &&
      collectionOrOpts !== null &&
      'collection' in collectionOrOpts &&
      'handlers' in collectionOrOpts
    const collection = isOptsForm
      ? (collectionOrOpts as { collection: Main<S> }).collection
      : (collectionOrOpts as Main<S>)
    const handlers = (
      isOptsForm
        ? (collectionOrOpts as { handlers: unknown }).handlers
        : maybeHandlers
    ) as CommitHandlers<unknown>
    const validateRecord = isOptsForm
      ? ((collectionOrOpts as { validateRecord?: boolean }).validateRecord ??
        true)
      : true
    const resolved = getMain(collection) as RecordSchema
    this.#collections.set(resolved.$type, {
      schema: resolved,
      validateRecord,
      put: handlers.put as AnyCommitHandlers['put'],
      del: handlers.del as AnyCommitHandlers['del'],
    })
    return this
  }

  identity(
    fn: (e: IdentityEvent, ctx: HandlerContext) => unknown | Promise<unknown>,
  ): this {
    this.#identityHandler = fn
    return this
  }

  account(
    fn: (e: AccountEvent, ctx: HandlerContext) => unknown | Promise<unknown>,
  ): this {
    this.#accountHandler = fn
    return this
  }

  onValidationError(
    fn: (
      e: ValidationErrorEvent,
      ctx: HandlerContext,
    ) => unknown | Promise<unknown>,
  ): this {
    this.#validationErrorHandler = fn
    return this
  }

  async run(
    stream: AsyncIterable<EventBatch<RawEventV1>>,
    ctx: ConsumerContext,
  ): Promise<void> {
    const concurrency = Math.max(1, this.concurrency)
    const keyOf = this.#keyOf ?? ((evt: RawEventV1) => eventUri(evt))
    // schemasByNsid drives typedEventFromRaw's validation; a collection
    // registered with validateRecord: false is deliberately OMITTED so its
    // records skip schema.safeValidate (routing is unaffected — handlers are
    // looked up in #collections, not this map).
    const schemasByNsid = new Map<string, RecordSchema>()
    for (const [nsid, h] of this.#collections) {
      if (h.validateRecord) schemasByNsid.set(nsid, h.schema)
    }

    // Guaranteed handler signal: synthesized from the optional seam signal so
    // ctx.signal is ALWAYS present for handlers and fires at least on wind-down.
    // Chain the caller's signal in; abort in the finally (stream end / error /
    // completion). Allocated once per run, shared by every handler call.
    const runAbort = new AbortController()
    const onSeamAbort = () => runAbort.abort()
    if (ctx.signal) {
      if (ctx.signal.aborted) runAbort.abort()
      else ctx.signal.addEventListener('abort', onSeamAbort, { once: true })
    }
    const hctx: HandlerContext = { signal: runAbort.signal }

    const keyTails = new Map<string, Promise<void>>()
    let inFlight = 0
    let stopped = false
    let firstError: Error | undefined
    const slotWaiters: Array<() => void> = []
    const releaseSlot = () => {
      inFlight--
      const w = slotWaiters.shift()
      if (w) w()
    }
    // PERF: returns undefined (no promise) when a slot is free — the common
    // case. Only allocates a waiter when at capacity. The inFlight++ pairing
    // with releaseSlot() must hold on BOTH branches.
    const acquireSlot = (): Promise<void> | undefined => {
      if (inFlight < concurrency) {
        inFlight++
        return undefined
      }
      return new Promise<void>((res) => slotWaiters.push(res)).then(() => {
        inFlight++
      })
    }

    // Runs the matching handler (if any). Returning without calling a handler
    // means "handled-and-skipped" — the caller then acks.
    // PERF: plain function (not async) — a sync user handler completes without
    // any promise allocation; the CALLER inspects the return for a thenable.
    // Each branch returns the handler's result directly (may be a thenable).
    const handle = (evt: RawEventV1): unknown => {
      if (evt.kind === 'identity') {
        if (this.#identityHandler) {
          return this.#identityHandler(
            {
              did: evt.identity.did,
              handle: evt.identity.handle,
              time: evt.identity.time,
              seq: evt.seq,
            },
            hctx,
          )
        }
        return undefined
      }
      if (evt.kind === 'account') {
        if (this.#accountHandler) {
          return this.#accountHandler(
            {
              did: evt.account.did,
              active: evt.account.active,
              status: evt.account.status,
              time: evt.account.time,
              seq: evt.seq,
            },
            hctx,
          )
        }
        return undefined
      }
      if (evt.kind !== 'commit') return undefined
      const handlers = this.#collections.get(evt.commit.collection)
      if (!handlers) return undefined // unregistered collection: skip
      if (evt.commit.operation === 'delete') {
        if (handlers.del) {
          const did = evt.did
          const c = evt.commit
          return handlers.del(
            {
              did,
              seq: evt.seq,
              operation: 'delete',
              collection: c.collection,
              rkey: c.rkey,
              rev: c.rev,
              get uri(): AtUriString {
                return lazyUri(this, did, c)
              },
            },
            hctx,
          )
        }
        return undefined
      }
      // create / update: upgrade to typed, then either route an invalid record
      // to onValidationError (handled-and-skipped, never put) or dispatch put
      // with the now-guaranteed-defined record.
      const typed = typedEventFromRaw(evt, schemasByNsid)
      if (typed.kind !== 'commit' || typed.commit.operation === 'delete')
        return undefined
      if (typed.commit.validationError !== undefined) {
        // Invalid record: fails schema-validation. Never reaches put; route to
        // the optional handler, otherwise ack-and-skip.
        if (this.#validationErrorHandler) {
          const did = typed.did
          const tc = typed.commit
          const error = typed.commit.validationError
          // PERF: cid delegates to the commit getter — do not inline
          // `cid: tc.cid` here; the source package's v2 path computes it
          // lazily and the delegation keeps both ports identical.
          const errEvt: ValidationErrorEvent = {
            did,
            seq: typed.seq,
            operation: tc.operation,
            collection: tc.collection,
            rkey: tc.rkey,
            rev: tc.rev,
            get uri(): AtUriString {
              return lazyUri(this, did, tc)
            },
            get cid(): CidString {
              return tc.cid
            },
            error,
          }
          return this.#validationErrorHandler(errEvt, hctx)
        }
        return undefined
      }
      if (handlers.put) {
        const did = typed.did
        const tc = typed.commit
        // PERF: cid delegates to the commit getter (see note above). The
        // record is defined here — its static type is unknown at this
        // type-erased site (handlers are stored as PutEvent<unknown>); the
        // commit() overloads guarantee the runtime shape matches what the
        // registered handler expects.
        const putEvt: PutEvent<unknown> = {
          did,
          seq: typed.seq,
          operation: tc.operation,
          collection: tc.collection,
          rkey: tc.rkey,
          rev: tc.rev,
          get uri(): AtUriString {
            return lazyUri(this, did, tc)
          },
          get cid(): CidString {
            return tc.cid
          },
          record: tc.record,
        }
        return handlers.put(putEvt, hctx)
      }
      return undefined
    }

    // Centralized settle: on success (err === undefined && !skipAck) ack the
    // event; on error record firstError once and set stopped (never ack); a
    // stopped-skip passes skipAck=true so the slot is released WITHOUT acking
    // (acking a skipped event would advance the watermark past unprocessed
    // events). Always releases the slot exactly once.
    const settle = (evt: RawEventV1, err: unknown, skipAck = false): void => {
      if (err === undefined) {
        if (!skipAck) ctx.ack(evt)
      } else {
        const e = err instanceof Error ? err : new Error(String(err))
        if (!firstError) firstError = e
        stopped = true
        // do NOT ack: watermark holds below this seq
      }
      releaseSlot()
    }

    // PERF: sync fast path — when the event's key has no pending tail AND the
    // handler completes synchronously, the event is acked and its slot released
    // inline with ZERO promise allocations. Preserve exactly: per-key ordering
    // when a tail exists, acquire/release pairing (settle runs once per
    // dispatched event), fail-fast without acking the failed event. The async
    // fallback below is the original chain semantics.
    const dispatch = (evt: RawEventV1): void => {
      // NOTE: keyOf is deliberately NOT guarded — a key-computation failure is
      // an implementer bug (broken custom keyOf) and should throw hard out of
      // run() rather than be settled like a handler error. The default
      // (eventUri) is plain string concatenation and cannot throw.
      const key = keyOf(evt)
      const prev = keyTails.get(key)
      if (prev === undefined) {
        // No pending tail: run inline.
        if (stopped) {
          settle(evt, undefined, true) // stopped-skip: release, no ack
          return
        }
        let result: unknown
        try {
          result = handle(evt)
        } catch (err) {
          settle(evt, err) // sync throw
          return
        }
        if (!isThenable(result)) {
          settle(evt, undefined) // sync completion: zero promises
          return
        }
        // Async completion: register the tail.
        const run = Promise.resolve(result).then(
          () => settle(evt, undefined),
          (err) => settle(evt, err),
        )
        keyTails.set(key, run)
        void run.finally(() => {
          if (keyTails.get(key) === run) keyTails.delete(key)
        })
        return
      }
      // Pending tail: enqueue behind it (original semantics).
      const run = prev
        .catch(() => {})
        .then(() => {
          if (stopped) {
            settle(evt, undefined, true) // stopped-skip: release, no ack
            return
          }
          let result: unknown
          try {
            result = handle(evt)
          } catch (err) {
            settle(evt, err)
            return
          }
          if (!isThenable(result)) {
            settle(evt, undefined)
            return
          }
          return Promise.resolve(result).then(
            () => settle(evt, undefined),
            (err) => settle(evt, err),
          )
        })
      keyTails.set(key, run)
      void run.finally(() => {
        if (keyTails.get(key) === run) keyTails.delete(key)
      })
    }

    try {
      outer: for await (const batch of stream) {
        for (const evt of batch.events) {
          if (stopped) break outer
          const p = acquireSlot()
          if (p) await p
          if (stopped) {
            releaseSlot()
            break outer
          }
          dispatch(evt)
        }
      }
      await Promise.allSettled([...keyTails.values()])
      if (firstError) throw firstError
    } finally {
      if (ctx.signal) ctx.signal.removeEventListener('abort', onSeamAbort)
      runAbort.abort() // guarantee hctx.signal fires on wind-down
    }
  }
}
