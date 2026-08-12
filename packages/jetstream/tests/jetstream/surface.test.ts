import { describe, expect, expectTypeOf, it } from 'vitest'
import { Jetstream, JetstreamV1, type RawEventV1 } from '../../src/index.js'

describe('class surfaces', () => {
  it('Jetstream drives v2 and owns the runner path', () => {
    const js = new Jetstream('https://h')
    expect(typeof js.live).toBe('function')
    expect(typeof js.runner).toBe('function')
    expect(typeof js.liveRawBatches).toBe('function')
  })

  it('JetstreamV1 offers live() only', () => {
    const js = new JetstreamV1('https://h')
    expect(typeof js.live).toBe('function')
    // v1 cannot support the runner/consumer path, so it does not express it.
    expect('runner' in js).toBe(false)
    expect('liveRawBatches' in js).toBe(false)
    expect('snapshot' in js).toBe(false)
    expect('replay' in js).toBe(false)
  })

  it('accepts a bare service string or an options object', () => {
    expect(new JetstreamV1('https://h').service).toBe('https://h')
    expect(
      new JetstreamV1({ service: 'https://h', validateWire: true }).opts
        .validateWire,
    ).toBe(true)
  })

  it('raw yields narrow by version', () => {
    const v1 = new JetstreamV1('https://h')
    expectTypeOf(v1.live({ raw: true })).toEqualTypeOf<
      AsyncGenerator<RawEventV1>
    >()
    // The matching Jetstream/RawEvent assertion lands in Task 10: Jetstream
    // is still pinned to the v1 wire (see the TEMPORARY marker in
    // jetstream.ts) until that task flips it, so today its raw arm is also
    // typed AsyncGenerator<RawEventV1> — asserting RawEvent here would fail.
  })

  it('typed v1 events carry no sync arm', () => {
    const v1 = new JetstreamV1('https://h')
    const gen = v1.live()
    void gen // referenced only in a type position below; keep it "used"
    // Narrow to the yield branch before reading `value` — IteratorResult's
    // done branch has `value: any`, which would otherwise structurally
    // satisfy `{ kind: 'sync' }` and make the Extract below never resolve to
    // never regardless of what v1 actually yields.
    type V1Yielded = Extract<
      Awaited<ReturnType<typeof gen.next>>,
      { done?: false }
    >['value']
    // v1 never emits sync, so a v1 consumer never switches on it.
    expectTypeOf<Extract<V1Yielded, { kind: 'sync' }>>().toBeNever()
  })

  it('the kinds filter is rejected on v1', () => {
    const v1 = new JetstreamV1('https://h')
    // @ts-expect-error LiveV1Opts has no kinds — the v1 wire has no such param
    void v1.live({ kinds: ['commit'] })
  })
})
