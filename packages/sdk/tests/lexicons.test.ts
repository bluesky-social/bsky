import { parseCid } from '@atproto/lex'
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

  it('accepts video alt text longer than 1,000 graphemes', () => {
    const alt = 'a'.repeat(1_814)

    expect(
      app.bsky.embed.video.$matches({
        $type: 'app.bsky.embed.video',
        video: {
          $type: 'blob',
          ref: parseCid(
            'bafkreieq5jui4j25lacwomsqgjeswwl3y5zcdrresptwgmfylxo2depppq',
          ),
          mimeType: 'video/mp4',
          size: 1,
        },
        alt,
      }),
    ).toBe(true)
    expect(
      app.bsky.embed.video.view.matches({
        cid: 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq',
        playlist: 'https://example.test/video.m3u8',
        alt,
      }),
    ).toBe(true)
  })

  it('builds and validates a reference-list opt-out record', () => {
    const optOut = app.bsky.graph.referencelistoptout.$build({
      subject:
        'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.graph.list/3m2lp5zsc7422',
      createdAt: '2026-08-25T12:30:00.000Z',
    })

    expect(optOut.$type).toBe('app.bsky.graph.referencelistoptout')
    expect(app.bsky.graph.referencelistoptout.$matches(optOut)).toBe(true)
    expect(
      app.bsky.graph.referencelistoptout.$matches({
        $type: 'app.bsky.graph.referencelistoptout',
        subject: 'not-an-at-uri',
        createdAt: '2026-08-25T12:30:00.000Z',
      }),
    ).toBe(false)
  })

  it('leaves reference-list subject semantics to consuming services', () => {
    expect(
      app.bsky.graph.referencelistoptout.$matches({
        $type: 'app.bsky.graph.referencelistoptout',
        subject:
          'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3m2lp5zsc7422',
        createdAt: '2026-08-25T12:30:00.000Z',
      }),
    ).toBe(true)
  })

  it('validates reference-list opt-out view state', () => {
    expect(
      app.bsky.graph.defs.listItemView.matches({
        uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.graph.listitem/3m2lp5zsc7422',
        subject: {
          did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
          handle: 'alice.test',
        },
        subjectOptedOut: true,
      }),
    ).toBe(true)
    expect(
      app.bsky.graph.defs.listViewerState.matches({
        referenceListOptOut:
          'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.graph.referencelistoptout/3m2lp5zsc7422',
      }),
    ).toBe(true)
    expect(
      app.bsky.graph.defs.listViewerState.matches({
        referenceListOptOut: 'not-an-at-uri',
      }),
    ).toBe(false)
    expect(
      app.bsky.graph.defs.listItemView.matches({
        uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.graph.listitem/3m2lp5zsc7422',
        subject: {
          did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
          handle: 'alice.test',
        },
        subjectOptedOut: false,
      }),
    ).toBe(false)
  })
})
