import { CloseError, HeartbeatTimeoutError } from '@atproto/ws-client'
import { describe, expect, it } from 'vitest'
import {
  jetstreamShouldReconnect,
  resolveWebsocketOptions,
} from '../../src/live/transport.js'

// The pure option/policy layer of websocketTransport. Timing behavior
// (60s default idle, etc.) is untestable over a real socket in reasonable
// time, so the defaults are pinned here; real-socket semantics live in
// transport.test.ts.

describe('jetstreamShouldReconnect', () => {
  it('reconnects on a clean 1000 close (jetstream override)', () => {
    expect(jetstreamShouldReconnect(new CloseError(1000, '', true))).toBe(true)
  })
  it('protocol closes stay fatal (ws-client classification)', () => {
    expect(jetstreamShouldReconnect(new CloseError(1002, '', true))).toBe(false)
  })
  it('abnormal closes (1006) reconnect', () => {
    expect(jetstreamShouldReconnect(new CloseError(1006, '', false))).toBe(true)
  })
  it('defers to typed-error self-classification', () => {
    expect(jetstreamShouldReconnect(new HeartbeatTimeoutError())).toBe(true)
  })
  it('errors outside the taxonomy are fatal', () => {
    expect(jetstreamShouldReconnect(new Error('nope'))).toBe(false)
  })
})

describe('resolveWebsocketOptions', () => {
  it('defaults: text dataMode, 60s idle timeout, jetstream reconnect policy', () => {
    const o = resolveWebsocketOptions()
    expect(o.dataMode).toBe('text')
    expect(o.idleTimeoutMs).toBe(60_000)
    expect(o.shouldReconnect).toBe(jetstreamShouldReconnect)
  })
  it('idleTimeoutMs: false disables idle detection (maps to unset)', () => {
    const o = resolveWebsocketOptions({ idleTimeoutMs: false })
    expect(o.idleTimeoutMs).toBeUndefined()
  })
  it('idleTimeoutMs override passes through', () => {
    expect(resolveWebsocketOptions({ idleTimeoutMs: 5000 }).idleTimeoutMs).toBe(
      5000,
    )
  })
  it('shouldReconnect override passes through (false = never)', () => {
    const o = resolveWebsocketOptions({ shouldReconnect: false })
    expect(o.shouldReconnect).toBe(false)
  })
  it('other websocket options pass through verbatim', () => {
    const onReconnect = () => {}
    const o = resolveWebsocketOptions({ onReconnect, maxReconnectSeconds: 32 })
    expect(o.onReconnect).toBe(onReconnect)
    expect(o.maxReconnectSeconds).toBe(32)
  })
})
