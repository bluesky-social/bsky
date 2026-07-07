import { setTimeout as delay } from 'node:timers/promises'
import { l, record } from '@atproto/lex-schema'
import { describe, expect, it } from 'vitest'
import { type EventBatch, type RawEventV1 } from '../../src/event.js'
import { LexIndexer } from '../../src/lex-indexer.js'

const likeSchema = record(
  'tid',
  'app.test.like',
  l.object({ subject: l.string() }),
)

function rawPut(seq: number, subject: string): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      rev: 'v',
      cid: 'cid' + seq,
      record: { $type: 'app.test.like', subject },
    },
  }
}
// A create commit whose record is missing the required `subject` (typed as a
// number), so likeSchema.safeValidate fails => typed.commit.validationError set.
function rawInvalidPut(seq: number): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'create',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      rev: 'v',
      cid: 'cid' + seq,
      record: { $type: 'app.test.like', subject: 123 },
    },
  }
}
function rawDel(seq: number): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'delete',
      collection: 'app.test.like',
      rkey: 'r' + seq,
      rev: 'v',
    },
  }
}
function rawUnregistered(seq: number): RawEventV1 {
  return {
    did: 'did:plc:a',
    seq,
    timeUs: 0,
    kind: 'commit',
    commit: {
      operation: 'delete',
      collection: 'app.other.thing',
      rkey: 'x',
      rev: 'v',
    },
  }
}

async function* batches(...bs: EventBatch<RawEventV1>[]) {
  for (const b of bs) yield b
}

const SIG = () => new AbortController().signal

describe('LexIndexer.run', () => {
  it('dispatches typed put/del with operation+seq+uri and acks each handled event', async () => {
    const puts: Array<{
      uri: string
      subject: string
      op: string
      seq: number
    }> = []
    const dels: Array<{ uri: string; op: string; seq: number }> = []
    const acked: number[] = []
    const ix = new LexIndexer().commit(likeSchema, {
      put: (e, ctx) => {
        expect(ctx.signal).toBeInstanceOf(AbortSignal) // ctx always present
        puts.push({
          uri: e.uri,
          subject: e.record.subject,
          op: e.operation,
          seq: e.seq,
        })
      },
      del: (e) => {
        dels.push({ uri: e.uri, op: e.operation, seq: e.seq })
      },
    })
    await ix.run(
      batches({ events: [rawPut(1, 'at://s1'), rawDel(2)], lastCursor: 2 }),
      { ack: (evt) => acked.push(evt.seq), signal: SIG() },
    )
    expect(puts).toEqual([
      {
        uri: 'at://did:plc:a/app.test.like/r1',
        subject: 'at://s1',
        op: 'create',
        seq: 1,
      },
    ])
    expect(dels).toEqual([
      { uri: 'at://did:plc:a/app.test.like/r2', op: 'delete', seq: 2 },
    ])
    expect(acked.sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('acks and skips unregistered collections (no handler)', async () => {
    const acked: number[] = []
    const ix = new LexIndexer().commit(likeSchema, { put: () => {} })
    await ix.run(batches({ events: [rawUnregistered(5)], lastCursor: 5 }), {
      ack: (evt) => acked.push(evt.seq),
      signal: SIG(),
    })
    expect(acked).toEqual([5]) // acked despite no handler
  })

  it('a keyOf failure throws hard out of run (implementer bug, not a settled handler error)', async () => {
    const acked: number[] = []
    const ix = new LexIndexer({
      keyOf: (evt) => {
        if (evt.seq === 2) throw new Error('bad key')
        return String(evt.seq)
      },
    }).commit(likeSchema, { put: () => {} })
    await expect(
      ix.run(
        batches({
          events: [rawPut(1, 'ok'), rawPut(2, 'ok'), rawPut(3, 'ok')],
          lastCursor: 3,
        }),
        { ack: (evt) => acked.push(evt.seq), signal: SIG() },
      ),
    ).rejects.toThrow('bad key')
    expect(acked).toContain(1)
    expect(acked).not.toContain(2) // failed event never acked: watermark holds
  })

  it('fails fast: first handler error rejects run and the failed event is not acked', async () => {
    const acked: number[] = []
    const ix = new LexIndexer({ concurrency: 1 }).commit(likeSchema, {
      put: (e) => {
        if (e.record.subject === 'boom') throw new Error('handler failed')
      },
    })
    await expect(
      ix.run(
        batches({
          events: [rawPut(1, 'ok'), rawPut(2, 'boom'), rawPut(3, 'ok')],
          lastCursor: 3,
        }),
        { ack: (evt) => acked.push(evt.seq), signal: SIG() },
      ),
    ).rejects.toThrow('handler failed')
    expect(acked).toContain(1) // 1 acked before failure
    expect(acked).not.toContain(2) // failed event never acked
  })

  it('calls identity and account handlers', async () => {
    const ids: string[] = []
    const accts: Array<{ did: string; active: boolean }> = []
    const ix = new LexIndexer()
      .identity((e) => ids.push(e.did))
      .account((e) => accts.push({ did: e.did, active: e.active }))
    const idEvt: RawEventV1 = {
      did: 'did:plc:b',
      seq: 1,
      timeUs: 0,
      kind: 'identity',
      identity: { did: 'did:plc:b', handle: 'h.test' },
    }
    const acctEvt: RawEventV1 = {
      did: 'did:plc:c',
      seq: 2,
      timeUs: 0,
      kind: 'account',
      account: { did: 'did:plc:c', active: true },
    }
    await ix.run(batches({ events: [idEvt, acctEvt], lastCursor: 2 }), {
      ack: () => {},
      signal: SIG(),
    })
    expect(ids).toEqual(['did:plc:b'])
    expect(accts).toEqual([{ did: 'did:plc:c', active: true }])
  })

  it('provides a handler signal even when the seam passes none, and fires it on wind-down', async () => {
    let observed: AbortSignal | undefined
    let abortedDuringHandler = false
    const ix = new LexIndexer().commit(likeSchema, {
      put: (_e, ctx) => {
        observed = ctx.signal
        abortedDuringHandler = ctx.signal.aborted
      },
    })
    // NOTE: seam ctx has NO signal — LexIndexer must synthesize one.
    await ix.run(batches({ events: [rawPut(1, 'x')], lastCursor: 1 }), {
      ack: () => {},
    })
    expect(observed).toBeInstanceOf(AbortSignal)
    expect(abortedDuringHandler).toBe(false) // live while handler ran
    expect(observed?.aborted).toBe(true) // fired on wind-down (finally)
  })

  it('aborts the handler signal when the seam signal aborts', async () => {
    const ac = new AbortController()
    let observed: AbortSignal | undefined
    const ix = new LexIndexer().commit(likeSchema, {
      put: (_e, ctx) => {
        observed = ctx.signal
        ac.abort() // simulate caller cancellation mid-handler
      },
    })
    await ix.run(batches({ events: [rawPut(1, 'x')], lastCursor: 1 }), {
      ack: () => {},
      signal: ac.signal,
    })
    expect(observed?.aborted).toBe(true)
  })

  it('handler can consume ctx.signal to cancel in-flight work', async () => {
    // A handler that awaits an abortable operation (mimics fetch(...,{signal})).
    // The caller aborts; the operation must reject via ctx.signal, and that
    // rejection propagates as the run's fail-fast error.
    const ac = new AbortController()
    const abortable = (signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'))
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        })
      })
    const ix = new LexIndexer({ concurrency: 1 }).commit(likeSchema, {
      put: async (_e, ctx) => {
        // schedule the caller's cancellation, then block on the abortable op
        setTimeout(() => ac.abort(), 0)
        await abortable(ctx.signal) // rejects when ctx.signal fires
      },
    })
    await expect(
      ix.run(batches({ events: [rawPut(1, 'x')], lastCursor: 1 }), {
        ack: () => {},
        signal: ac.signal,
      }),
    ).rejects.toThrow('aborted')
  })

  it('routes invalid records to onValidationError (never put) and still acks', async () => {
    const puts: string[] = []
    const errs: Array<{ uri: string; isError: boolean }> = []
    const acked: number[] = []
    const ix = new LexIndexer()
      .commit(likeSchema, {
        put: (e) => {
          puts.push(e.uri)
        },
      })
      .onValidationError((e) => {
        errs.push({ uri: e.uri, isError: e.error instanceof Error })
      })
    await ix.run(batches({ events: [rawInvalidPut(7)], lastCursor: 7 }), {
      ack: (evt) => acked.push(evt.seq),
      signal: SIG(),
    })
    expect(puts).toEqual([]) // put never called for invalid record
    expect(errs).toEqual([
      { uri: 'at://did:plc:a/app.test.like/r7', isError: true },
    ])
    expect(acked).toEqual([7]) // acked => watermark advances
  })

  it('acks and skips invalid records when no onValidationError is registered (no reject)', async () => {
    const puts: string[] = []
    const acked: number[] = []
    const ix = new LexIndexer().commit(likeSchema, {
      put: (e) => {
        puts.push(e.uri)
      },
    })
    await expect(
      ix.run(batches({ events: [rawInvalidPut(8)], lastCursor: 8 }), {
        ack: (evt) => acked.push(evt.seq),
        signal: SIG(),
      }),
    ).resolves.toBeUndefined()
    expect(puts).toEqual([]) // put never called
    expect(acked).toEqual([8]) // ack-and-skip
  })

  it('sync handlers complete inline: all events processed, all acked, order preserved', async () => {
    const seen: number[] = []
    const acked: number[] = []
    const ix = new LexIndexer().commit(likeSchema, {
      put: (e) => {
        seen.push(e.seq)
      }, // synchronous
    })
    const events = [1, 2, 3, 4, 5].map((seq) => rawPut(seq, 's'))
    await ix.run(batches({ events, lastCursor: 5 }), {
      ack: (e) => acked.push(e.seq),
      signal: SIG(),
    })
    expect(seen).toEqual([1, 2, 3, 4, 5])
    expect(acked).toEqual([1, 2, 3, 4, 5])
  })

  it('a synchronous throw fails fast and does not ack the failed event', async () => {
    const acked: number[] = []
    const ix = new LexIndexer({ concurrency: 1 }).commit(likeSchema, {
      put: (e) => {
        if (e.seq === 3) throw new Error('boom')
      },
    })
    const events = [1, 2, 3, 4].map((seq) => rawPut(seq, 's'))
    await expect(
      ix.run(batches({ events, lastCursor: 4 }), {
        ack: (e) => acked.push(e.seq),
        signal: SIG(),
      }),
    ).rejects.toThrow('boom')
    expect(acked).toContain(1)
    expect(acked).toContain(2)
    expect(acked).not.toContain(3)
  })

  it('mixed sync/async handlers on the SAME key preserve per-key order', async () => {
    const order: string[] = []
    const ix = new LexIndexer({ keyOf: () => 'same-key' }).commit(likeSchema, {
      put: async (e) => {
        if (e.seq === 1) {
          await delay(10)
          order.push('slow-1')
        } else {
          order.push(`fast-${e.seq}`) // enqueued behind seq 1's pending tail
        }
      },
    })
    await ix.run(
      batches({ events: [rawPut(1, 's'), rawPut(2, 's')], lastCursor: 2 }),
      {
        ack: () => {},
        signal: SIG(),
      },
    )
    expect(order).toEqual(['slow-1', 'fast-2'])
  })

  it('runs different-key events concurrently and serializes same-key events', async () => {
    // Deferred helper for deterministic overlap/serialization observation.
    const defer = () => {
      let resolve!: () => void
      const promise = new Promise<void>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    // (a) different keys overlap under concurrency >= 2
    {
      const started: string[] = []
      const gates = new Map<string, ReturnType<typeof defer>>()
      const ix = new LexIndexer({ concurrency: 2 }).commit(likeSchema, {
        put: async (e) => {
          started.push(e.uri)
          const g = defer()
          gates.set(e.uri, g)
          await g.promise
        },
      })
      // Two creates on different rkeys => different default keys (eventUri).
      const runP = ix.run(
        batches({ events: [rawPut(1, 's1'), rawPut(2, 's2')], lastCursor: 2 }),
        { ack: () => {}, signal: SIG() },
      )
      // Let both handlers start before either completes.
      await delay(0)
      expect(started.sort()).toEqual([
        'at://did:plc:a/app.test.like/r1',
        'at://did:plc:a/app.test.like/r2',
      ]) // both started => overlapping
      gates.get('at://did:plc:a/app.test.like/r1')!.resolve()
      gates.get('at://did:plc:a/app.test.like/r2')!.resolve()
      await runP
    }

    // (b) same key serializes strictly in order
    {
      const started: number[] = []
      const completed: number[] = []
      const gates: Array<ReturnType<typeof defer>> = []
      const ix = new LexIndexer({ concurrency: 4 }).commit(likeSchema, {
        put: async (e) => {
          started.push(e.seq)
          const g = defer()
          gates[e.seq] = g
          await g.promise
          completed.push(e.seq)
        },
      })
      // Same uri (same did/collection/rkey) for both events => same key.
      const sameKey = (seq: number): RawEventV1 => ({
        did: 'did:plc:a',
        seq,
        timeUs: 0,
        kind: 'commit',
        commit: {
          operation: 'create',
          collection: 'app.test.like',
          rkey: 'shared',
          rev: 'v',
          cid: 'cid' + seq,
          record: { $type: 'app.test.like', subject: 's' },
        },
      })
      const runP = ix.run(
        batches({ events: [sameKey(1), sameKey(2)], lastCursor: 2 }),
        { ack: () => {}, signal: SIG() },
      )
      await delay(0)
      expect(started).toEqual([1]) // second blocked until first resolves
      gates[1].resolve()
      await delay(0)
      expect(started).toEqual([1, 2]) // second starts only after first completed
      expect(completed).toEqual([1])
      gates[2].resolve()
      await runP
      expect(completed).toEqual([1, 2])
    }
  })
})
