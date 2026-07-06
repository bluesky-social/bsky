import { WebSocketKeepAlive } from '@atproto/ws-client'
import { expect, test } from 'vitest'

test('ws-client WebSocketKeepAlive is importable and constructible', () => {
  const ka = new WebSocketKeepAlive({ getUrl: async () => 'ws://localhost/' })
  expect(ka).toBeInstanceOf(WebSocketKeepAlive)
  expect(typeof ka[Symbol.asyncIterator]).toBe('function')
})
