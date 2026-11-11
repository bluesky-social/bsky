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
})
