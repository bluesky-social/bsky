import { describe, expect, it } from 'vitest'
import * as external from '../src/lexicons/app/bsky/embed/external.defs.js'
import type { Label } from '../src/lexicons/com/atproto/label/defs.defs.js'
import {
  type ModerationOpts,
  type ModerationSubjectExternalView,
  moderateExternalView,
  moderateViewExternal,
} from '../src/moderation/index.js'

const VIEWER_DID = 'did:web:alice.test'
const OWNER_DID = 'did:web:bob.test'
const LABELER_DID = 'did:web:labeler.test'
const FAKE_CID = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'
const base = {
  uri: 'https://example.com/article',
  title: 'Example content',
  description: 'An example external view',
} as const
const views = [
  external.viewExternal.build(base),
  external.viewArticle.build(base),
  external.viewArticlePublication.build(base),
  external.viewGallery.build({ ...base, items: [] }),
  external.viewLivestream.build({ ...base, active: true }),
] satisfies ModerationSubjectExternalView[]

const opts: ModerationOpts = {
  userDid: VIEWER_DID,
  prefs: {
    adultContentEnabled: true,
    labels: { porn: 'hide' },
    labelers: [{ did: LABELER_DID, labels: {} }],
    hiddenPosts: [],
    mutedWords: [],
  },
}

const ownerRefs = [
  { uri: `at://${OWNER_DID}/example.content/item` as const, cid: FAKE_CID },
]
const mutedOpts: ModerationOpts = {
  ...opts,
  prefs: {
    ...opts.prefs,
    mutedWords: [
      {
        value: 'example',
        targets: ['content'],
        actorTarget: 'exclude-following',
      },
    ],
  },
}

function label(val: string, src: Label['src'] = LABELER_DID): Label {
  return { val, src, uri: base.uri, cts: '2026-10-16T12:00:00.000Z' }
}

describe.each(views)('moderateExternalView ($$type)', (view) => {
  it('accepts the view without labels or backing records', () => {
    const res = moderateExternalView(view, opts)
    expect(res.did).toBe('')
    expect(res.isMe).toBe(false)
    expect(res.causes).toHaveLength(0)
  })

  it.each([
    { val: 'porn', contentView: false, contentMedia: true },
    { val: '!warn', contentView: true, contentMedia: false },
  ])(
    'applies $val as a content label',
    ({ val, contentView, contentMedia }) => {
      const res = moderateExternalView({ ...view, labels: [label(val)] }, opts)
      expect(res.ui('contentView').blur).toBe(contentView)
      expect(res.ui('contentMedia').blur).toBe(contentMedia)
      expect(res.causes[0]).toMatchObject({ target: 'content' })
    },
  )

  it('ignores labels from unsubscribed labelers', () => {
    const res = moderateExternalView(
      { ...view, labels: [label('porn', 'did:web:unknown.test')] },
      opts,
    )
    expect(res.causes).toHaveLength(0)
  })

  it('applies self-labels only from the primary backing record owner', () => {
    const subject = {
      ...view,
      labels: [label('porn', OWNER_DID), label('porn', VIEWER_DID)],
      associatedRefs: [
        { uri: `at://${OWNER_DID}/example.content/item`, cid: FAKE_CID },
        { uri: `at://${VIEWER_DID}/example.content/item`, cid: FAKE_CID },
      ],
      associatedProfiles: [{ did: VIEWER_DID, handle: 'alice.test' }],
    } satisfies ModerationSubjectExternalView
    const res = moderateExternalView(subject, opts)
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
    expect(res.ui('contentMedia').blur).toBe(true)
    expect(res.causes).toHaveLength(1)
    expect(res.causes[0]).toMatchObject({ source: { type: 'user' } })

    const ownRes = moderateExternalView(subject, {
      ...opts,
      userDid: OWNER_DID,
    })
    expect(ownRes.isMe).toBe(true)
    expect(ownRes.ui('contentList').filter).toBe(false)
  })

  it('combines content labels with owner account and profile moderation', () => {
    const res = moderateExternalView(
      {
        ...view,
        labels: [label('!warn')],
        associatedRefs: ownerRefs,
        associatedProfiles: [
          {
            did: OWNER_DID,
            handle: 'bob.test',
            viewer: {
              muted: true,
              blocking: `at://${VIEWER_DID}/app.bsky.graph.block/item`,
              blockedBy: true,
            },
            labels: [
              { ...label('!hide'), uri: OWNER_DID },
              {
                ...label('porn'),
                uri: `at://${OWNER_DID}/app.bsky.actor.profile/self`,
              },
            ],
          },
        ],
      },
      opts,
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
    expect(res.causes).toMatchObject([
      { type: 'label', target: 'content' },
      { type: 'muted' },
      { type: 'blocking' },
      { type: 'blocked-by' },
      { type: 'label', target: 'account' },
      { type: 'label', target: 'profile' },
    ])
    expect(res.ui('contentList').filter).toBe(true)
    expect(res.ui('contentView').noOverride).toBe(true)
    expect(res.ui('avatar').blur).toBe(true)
  })

  it.each([undefined, {}, { texts: [] }, { texts: ['unrelated text'] }])(
    'does not extract muted-word text from the view with options %j',
    (externalOpts) => {
      expect(
        moderateExternalView(view, mutedOpts, externalOpts).causes,
      ).toHaveLength(0)
    },
  )

  it('adds matches from the first matching client-supplied text', () => {
    const res = moderateExternalView(view, mutedOpts, {
      texts: ['unrelated text', 'An example of matching', 'example again'],
    })
    expect(res.causes).toMatchObject([
      {
        type: 'mute-word',
        matches: [
          { word: mutedOpts.prefs.mutedWords[0], predicate: 'example' },
        ],
      },
    ])
    expect(res.ui('contentList').filter).toBe(true)
    expect(res.ui('contentList').blur).toBe(true)
    expect(res.ui('contentView').blur).toBe(true)
  })

  it('exempts your own content even without an owner profile', () => {
    const res = moderateExternalView(
      { ...view, associatedRefs: ownerRefs },
      { ...mutedOpts, userDid: OWNER_DID },
      { texts: ['example'] },
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(true)
    expect(res.causes).toHaveLength(0)
  })

  it.each([false, true])(
    'uses the matching owner profile for the following exemption (following=%s)',
    (following) => {
      const res = moderateExternalView(
        {
          ...view,
          associatedRefs: ownerRefs,
          associatedProfiles: [
            {
              did: VIEWER_DID,
              handle: 'alice.test',
              viewer: {
                muted: true,
                following: following
                  ? undefined
                  : `at://${VIEWER_DID}/app.bsky.graph.follow/other`,
              },
            },
            {
              did: OWNER_DID,
              handle: 'bob.test',
              viewer: {
                following: following
                  ? `at://${VIEWER_DID}/app.bsky.graph.follow/owner`
                  : undefined,
              },
            },
          ],
        },
        mutedOpts,
        { texts: ['example'] },
      )
      expect(res.did).toBe(OWNER_DID)
      expect(res.isMe).toBe(false)
      expect(res.causes.map((cause) => cause.type)).toEqual(
        following ? [] : ['mute-word'],
      )
    },
  )

  it.each([
    undefined,
    'at://bob.test/example.content/item',
    `at://${OWNER_DID}/example.content/item`,
  ] as const)(
    'does not use an unrelated profile for owner moderation or word-mute exemptions (ref=%s)',
    (uri) => {
      const res = moderateExternalView(
        {
          ...view,
          associatedRefs: uri ? [{ uri, cid: FAKE_CID }] : undefined,
          associatedProfiles: [
            {
              did: VIEWER_DID,
              handle: 'alice.test',
              viewer: {
                muted: true,
                following: `at://${VIEWER_DID}/app.bsky.graph.follow/other`,
              },
            },
          ],
        },
        mutedOpts,
        { texts: ['example'] },
      )
      expect(res.isMe).toBe(false)
      expect(res.causes.map((cause) => cause.type)).toEqual(['mute-word'])
    },
  )
})

it('preserves the legacy moderateViewExternal API', () => {
  const view = external.viewExternal.build({
    ...base,
    labels: [label('porn', OWNER_DID)],
    associatedRefs: [
      { uri: `at://${OWNER_DID}/example.content/item`, cid: FAKE_CID },
    ],
  })
  expect(moderateViewExternal(view, opts)).toEqual(
    moderateExternalView(view, opts),
  )
  const externalOpts = { texts: ['example'] }
  const res = moderateViewExternal(view, mutedOpts, externalOpts)
  expect(res).toEqual(moderateExternalView(view, mutedOpts, externalOpts))
  expect(res.causes.map((cause) => cause.type)).toEqual(['label', 'mute-word'])
})

it('matches supplied strings independently rather than joining them', () => {
  const res = moderateExternalView(
    views[0],
    {
      ...opts,
      prefs: {
        ...opts.prefs,
        mutedWords: [{ value: 'an example', targets: ['content'] }],
      },
    },
    { texts: ['an', 'example'] },
  )
  expect(res.causes).toHaveLength(0)
})

it('only checks gallery image alt text when supplied by the client', () => {
  const alt = 'example image'
  const view = external.viewGallery.build({
    ...base,
    items: [
      external.viewGalleryImage.build({
        thumbnail: 'https://example.com/thumb.jpg',
        fullsize: 'https://example.com/image.jpg',
        alt,
      }),
    ],
  })
  expect(moderateExternalView(view, mutedOpts).causes).toHaveLength(0)
  expect(
    moderateExternalView(view, mutedOpts, { texts: [alt] }).causes,
  ).toMatchObject([{ type: 'mute-word' }])
})
