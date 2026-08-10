import { describe, expect, it } from 'vitest'
import { app } from '../src/lexicons/index.js'

describe('generated lexicons', () => {
  it('builds and validates a post record', () => {
    const post = app.bsky.feed.post.$build({
      text: 'hello world',
      createdAt: '2024-01-15T12:30:00.000Z',
    })
    expect(post.$type).toBe('app.bsky.feed.post')
    expect(app.bsky.feed.post.$matches(post)).toBe(true)
  })

  it('rejects invalid data', () => {
    expect(
      app.bsky.feed.post.$matches({ $type: 'app.bsky.feed.post', text: 42 }),
    ).toBe(false)
  })
})
