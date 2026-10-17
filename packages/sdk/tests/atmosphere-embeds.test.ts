import { describe, expect, it } from 'vitest'
import { app } from '../src/lexicons/index.js'

const external = app.bsky.embed.external
const getEmbedExternalView = app.bsky.embed.getEmbedExternalView
const canonicalUri =
  'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/site.standard.document/3m2lp5zsc7422'
const ref = {
  uri: canonicalUri,
  cid: 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq',
} as const
const profile = {
  did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
  handle: 'alice.test',
} as const
const base = {
  uri: 'https://example.test/article',
  title: 'An article',
  description: 'An article description',
} as const

const publication = external.viewArticlePublication.build({
  ...base,
  logo: 'https://example.test/logo.png',
  theme: { background: '#ffffff', foreground: '#000000', accent: '#ff0000' },
  subscriptionCount: 3,
  subscribers: [profile],
})
const article = external.viewArticle.build({
  ...base,
  image: 'https://example.test/article.png',
  publisher: publication,
  readingTime: 1,
  likeCount: 0,
  likers: [profile],
  associatedRefs: [ref],
  associatedProfiles: [profile],
  labels: [
    {
      src: profile.did,
      uri: canonicalUri,
      val: 'spam',
      cts: '2026-10-16T12:00:00.000Z',
    },
  ],
})
const gallery = external.viewGallery.build({
  ...base,
  items: [
    external.viewGalleryImage.build({
      thumbnail: 'https://example.test/thumb.png',
      fullsize: 'https://example.test/full.png',
      alt: 'A photograph',
      aspectRatio: { width: 4, height: 3 },
    }),
  ],
  likeCount: 0,
  likers: [profile],
})
const livestream = external.viewLivestream.build({
  ...base,
  active: false,
  startedAt: '2026-10-16T12:00:00.000Z',
  endedAt: '2026-10-16T13:00:00.000Z',
})

const views = [
  { schema: external.viewArticle, view: article },
  { schema: external.viewArticlePublication, view: publication },
  { schema: external.viewGallery, view: gallery },
  { schema: external.viewLivestream, view: livestream },
]

describe('Atmosphere external embed views', () => {
  it.each(views)(
    'validates $view.$type and its response data',
    ({ schema, view }) => {
      expect(schema.matches(view)).toBe(true)
      const body: app.bsky.embed.getEmbedExternalView.$OutputBody = {
        data: view,
      }
      expect(getEmbedExternalView.$output.schema.matches(body)).toBe(true)
    },
  )

  it.each(views)('rejects invalid $view.$type fields', ({ schema, view }) => {
    const { description: _omitted, ...missingDescription } = view
    expect(schema.matches(missingDescription)).toBe(false)
    expect(schema.matches({ ...view, uri: 'not a uri' })).toBe(false)
    expect(schema.matches({ ...view, createdAt: 'yesterday' })).toBe(false)
    expect(
      schema.matches({ ...view, associatedRefs: [{ uri: canonicalUri }] }),
    ).toBe(false)
    expect(
      schema.matches({ ...view, associatedProfiles: [{ did: profile.did }] }),
    ).toBe(false)
    expect(
      getEmbedExternalView.$output.schema.matches({ data: missingDescription }),
    ).toBe(false)
  })

  it('enforces article reading time and nested publisher fields', () => {
    expect(external.viewArticle.matches({ ...article, readingTime: 0 })).toBe(
      false,
    )
    expect(
      external.viewArticle.matches({
        ...article,
        publisher: { uri: base.uri },
      }),
    ).toBe(false)
  })

  it.each([
    {
      schema: external.viewArticle,
      view: article,
      count: 'likeCount',
      previews: 'likers',
    },
    {
      schema: external.viewArticlePublication,
      view: publication,
      count: 'subscriptionCount',
      previews: 'subscribers',
    },
    {
      schema: external.viewGallery,
      view: gallery,
      count: 'likeCount',
      previews: 'likers',
    },
  ])(
    'enforces counts and profile preview limits for $view.$type',
    ({ schema, view, count, previews }) => {
      expect(schema.matches({ ...view, [count]: -1 })).toBe(false)
      expect(
        schema.matches({
          ...view,
          [count]: 0,
          [previews]: [profile, profile, profile],
        }),
      ).toBe(true)
      expect(
        schema.matches({
          ...view,
          [previews]: [profile, profile, profile, profile],
        }),
      ).toBe(false)
    },
  )

  it('requires gallery images to have thumbnail and fullsize URLs', () => {
    expect(external.viewGallery.matches({ ...base })).toBe(false)
    expect(external.viewGalleryImage.matches({ thumbnail: base.uri })).toBe(
      false,
    )
    expect(
      external.viewGallery.matches({
        ...gallery,
        items: [
          {
            $type: 'app.bsky.embed.external#viewGalleryImage',
            thumbnail: base.uri,
          },
        ],
      }),
    ).toBe(false)
  })

  it('requires livestream active state and validates timestamps', () => {
    expect(external.viewLivestream.matches(base)).toBe(false)
    expect(
      external.viewLivestream.matches({ ...livestream, active: true }),
    ).toBe(true)
    expect(
      external.viewLivestream.matches({ ...livestream, endedAt: 'yesterday' }),
    ).toBe(false)
  })
})

describe('getEmbedExternalView', () => {
  it('accepts canonicalUri, legacy uris, or just the requested URL', () => {
    expect(
      getEmbedExternalView.$params.matches({ url: base.uri, canonicalUri }),
    ).toBe(true)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        uris: [canonicalUri],
      }),
    ).toBe(true)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        canonicalUri,
        uris: [canonicalUri],
      }),
    ).toBe(true)
    expect(getEmbedExternalView.$params.matches({ url: base.uri })).toBe(true)
  })

  it('requires a valid URL and validates record URIs and the legacy URI limit', () => {
    expect(getEmbedExternalView.$params.matches({ canonicalUri })).toBe(false)
    expect(
      getEmbedExternalView.$params.matches({ url: 'not a uri', canonicalUri }),
    ).toBe(false)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        canonicalUri: 'not-an-at-uri',
      }),
    ).toBe(false)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        uris: ['not-an-at-uri'],
      }),
    ).toBe(false)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        uris: Array.from({ length: 4 }, () => canonicalUri),
      }),
    ).toBe(true)
    expect(
      getEmbedExternalView.$params.matches({
        url: base.uri,
        uris: Array.from({ length: 5 }, () => canonicalUri),
      }),
    ).toBe(false)
  })

  it('accepts empty, legacy, verified, and unverified responses', () => {
    const schema = getEmbedExternalView.$output.schema
    expect(schema.matches({})).toBe(true)
    expect(schema.matches({ view: { external: base } })).toBe(true)
    expect(
      schema.matches({
        data: article,
        associatedRefs: [ref],
        associatedRecords: [
          { $type: 'site.standard.document', title: base.title },
        ],
      }),
    ).toBe(true)
    expect(
      schema.matches({
        unverifiedAssociatedRefs: [ref],
        unverifiedAssociatedRecords: [
          { $type: 'site.standard.document', title: base.title },
        ],
      }),
    ).toBe(true)
    expect(
      schema.matches({ unverifiedAssociatedRefs: [{ uri: canonicalUri }] }),
    ).toBe(false)
  })
})
