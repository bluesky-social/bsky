import { describe, expect, it } from 'vitest'
import * as api from '../../src/index.js'

describe('public exports', () => {
  it('exports Jetstream and typedEventFromRaw, not Client', () => {
    expect(typeof api.Jetstream).toBe('function')
    expect(typeof api.typedEventFromRaw).toBe('function')
    expect('Client' in api).toBe(false)
  })

  it('exports the websocketTransport factory', () => {
    expect(typeof api.websocketTransport).toBe('function')
  })
})
