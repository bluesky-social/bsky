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

  describe('profile links', () => {
    const did = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz' as const
    const cid = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'
    const linkUri = `at://${did}/app.bsky.actor.link/3m2lp5zsc7422` as const
    const createdAt = '2026-08-25T12:30:00.000Z' as const
    const label = {
      src: did,
      uri: linkUri,
      val: 'spam',
      cts: createdAt,
    }

    it('builds and validates minimal and full link records', () => {
      const minimal = app.bsky.actor.link.$build({
        url: 'https://example.test/path',
        createdAt,
      })
      expect(minimal.$type).toBe('app.bsky.actor.link')
      expect(app.bsky.actor.link.$matches(minimal)).toBe(true)

      const full = app.bsky.actor.link.$build({
        url: 'https://example.test/path',
        title: 'a'.repeat(40),
        icon: {
          $type: 'blob',
          ref: parseCid(
            'bafkreieq5jui4j25lacwomsqgjeswwl3y5zcdrresptwgmfylxo2depppq',
          ),
          mimeType: 'image/png',
          size: 1,
        },
        createdAt,
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'porn' }],
        },
      })
      expect(app.bsky.actor.link.$matches(full)).toBe(true)
    })

    it('rejects invalid link records', () => {
      const $type = 'app.bsky.actor.link'
      expect(app.bsky.actor.link.$matches({ $type, createdAt })).toBe(false)
      expect(
        app.bsky.actor.link.$matches({ $type, url: 'https://example.test' }),
      ).toBe(false)
      expect(
        app.bsky.actor.link.$matches({ $type, url: 'not a uri', createdAt }),
      ).toBe(false)
      expect(
        app.bsky.actor.link.$matches({
          $type,
          url: 'https://example.test',
          createdAt: 'yesterday',
        }),
      ).toBe(false)
      expect(
        app.bsky.actor.link.$matches({
          $type,
          url: 'https://example.test',
          title: 'a'.repeat(41),
          createdAt,
        }),
      ).toBe(false)
      expect(
        app.bsky.actor.link.$matches({
          $type,
          url: 'https://example.test',
          createdAt,
          labels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ nope: true }],
          },
        }),
      ).toBe(false)
    })

    it('validates profile record link strong refs', () => {
      const ref = { uri: linkUri, cid }
      const profile = app.bsky.actor.profile.$build({
        displayName: 'Alice',
        links: [ref],
      })
      expect(app.bsky.actor.profile.$matches(profile)).toBe(true)

      const tenLinks = Array.from({ length: 10 }, () => ref)
      expect(
        app.bsky.actor.profile.$matches({
          $type: 'app.bsky.actor.profile',
          links: tenLinks,
        }),
      ).toBe(true)
      expect(
        app.bsky.actor.profile.$matches({
          $type: 'app.bsky.actor.profile',
          links: [...tenLinks, ref],
        }),
      ).toBe(false)
      expect(
        app.bsky.actor.profile.$matches({
          $type: 'app.bsky.actor.profile',
          links: [{ uri: linkUri }],
        }),
      ).toBe(false)
    })

    it('validates hydrated link views with labels', () => {
      const view = {
        uri: linkUri,
        cid,
        url: 'https://example.test/path',
        title: 'Example',
        icon: 'https://cdn.example.test/icon.png',
        labels: [label],
      }
      expect(app.bsky.actor.defs.profileLinkView.matches(view)).toBe(true)
      expect(
        app.bsky.actor.defs.profileLinkView.matches({
          uri: linkUri,
          cid,
          url: 'https://example.test/path',
        }),
      ).toBe(true)

      for (const key of ['uri', 'cid', 'url'] as const) {
        const { [key]: _omitted, ...rest } = view
        expect(app.bsky.actor.defs.profileLinkView.matches(rest)).toBe(false)
      }
      expect(
        app.bsky.actor.defs.profileLinkView.matches({
          ...view,
          uri: 'not-an-at-uri',
        }),
      ).toBe(false)
      expect(
        app.bsky.actor.defs.profileLinkView.matches({
          ...view,
          labels: [{ val: 'spam' }],
        }),
      ).toBe(false)
      expect(
        app.bsky.actor.defs.profileLinkView.matches({
          ...view,
          labels: { val: 'spam' },
        }),
      ).toBe(false)
    })

    it('puts links on detailed profile views only', () => {
      const detailed: app.bsky.actor.defs.ProfileViewDetailed = {
        did,
        handle: 'alice.test',
        links: [
          {
            uri: linkUri,
            cid,
            url: 'https://example.test/path',
            labels: [label],
          },
        ],
      }
      expect(app.bsky.actor.defs.profileViewDetailed.matches(detailed)).toBe(
        true,
      )
      expect(
        app.bsky.actor.defs.profileViewDetailed.matches({
          ...detailed,
          links: [{ uri: linkUri }],
        }),
      ).toBe(false)

      const declares = (view: { schema: unknown }) =>
        'links' in (view.schema as { shape: object }).shape
      expect(declares(app.bsky.actor.defs.profileViewDetailed)).toBe(true)
      expect(declares(app.bsky.actor.defs.profileView)).toBe(false)
      expect(declares(app.bsky.actor.defs.profileViewBasic)).toBe(false)
    })
  })
})
