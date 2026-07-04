import { describe, expect, it } from 'vitest'
import { api } from '../src/index.js'

describe('api constants', () => {
  it('exposes appview addresses', () => {
    expect(api.app.did).toBe('did:web:api.bsky.app')
    expect(api.app.service).toBe('did:web:api.bsky.app#bsky_appview')
    expect(api.app.url).toBe('https://api.bsky.app')
    expect(api.app.urlPublic).toBe('https://public.api.bsky.app')
  })
  it('exposes chat addresses', () => {
    expect(api.chat.did).toBe('did:web:api.bsky.chat')
    expect(api.chat.service).toBe('did:web:api.bsky.chat#bsky_chat')
    expect(api.chat.url).toBe('https://api.bsky.chat')
  })
  it('exposes moderation service addresses', () => {
    expect(api.moderation.did).toBe('did:plc:ar7c4by46qjdydhdevvrndac')
    expect(api.moderation.service).toBe(
      'did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler',
    )
  })
  it('is deeply frozen', () => {
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.app)).toBe(true)
  })
})
