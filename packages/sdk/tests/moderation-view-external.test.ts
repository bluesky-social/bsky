import type { DidString } from '@atproto/syntax'
import { currentDatetimeString } from '@atproto/syntax'
import { describe, expect, it } from 'vitest'
import type { ViewExternal } from '../src/lexicons/app/bsky/embed/external.defs.js'
import type { Label } from '../src/lexicons/com/atproto/label/defs.defs.js'
import {
  ModerationOpts,
  ModerationUI,
  mergeModUIResults,
  moderateViewExternal,
} from '../src/moderation/index.js'

const LABELER_DID: DidString = 'did:web:labeler.test'
const OWNER_DID: DidString = 'did:web:bob.test'
const FAKE_CID = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'

const opts: ModerationOpts = {
  userDid: 'did:web:alice.test',
  prefs: {
    adultContentEnabled: true,
    labels: {
      porn: 'hide',
    },
    labelers: [
      {
        did: LABELER_DID,
        labels: {},
      },
    ],
    hiddenPosts: [],
    mutedWords: [],
  },
}

function label(val: string, src: DidString): Label {
  return {
    val,
    src,
    uri: 'https://example.com/article',
    cts: currentDatetimeString(),
  }
}

function viewExternal({
  labels,
  ownerDid,
}: {
  labels?: Label[]
  ownerDid?: DidString
} = {}): ViewExternal {
  return {
    uri: 'https://example.com/article',
    title: 'Example article',
    description: 'An example article',
    labels,
    associatedRefs: ownerDid
      ? [
          {
            uri: `at://${ownerDid}/site.standard.document/article`,
            cid: FAKE_CID,
          },
        ]
      : undefined,
  }
}

describe('moderateViewExternal', () => {
  it('produces no causes when the view has no labels', () => {
    const res = moderateViewExternal(viewExternal(), opts)
    expect(res.causes).toHaveLength(0)
  })

  it('blurs contentMedia for a media label from a subscribed labeler', () => {
    const res = moderateViewExternal(
      viewExternal({ labels: [label('porn', LABELER_DID)] }),
      opts,
    )
    expect(res.ui('contentMedia').blur).toBe(true)
    expect(res.ui('contentView').blur).toBe(false)
  })

  it('blurs contentView for a content label from a subscribed labeler', () => {
    const res = moderateViewExternal(
      viewExternal({ labels: [label('!warn', LABELER_DID)] }),
      opts,
    )
    expect(res.ui('contentView').blur).toBe(true)
    expect(res.ui('contentMedia').blur).toBe(false)
  })

  it('ignores labels from labelers the viewer is not subscribed to', () => {
    const res = moderateViewExternal(
      viewExternal({ labels: [label('porn', 'did:web:unknown.test')] }),
      opts,
    )
    expect(res.causes).toHaveLength(0)
  })

  it('applies self-labels from the owner of the primary backing record', () => {
    const res = moderateViewExternal(
      viewExternal({
        labels: [label('porn', OWNER_DID)],
        ownerDid: OWNER_DID,
      }),
      opts,
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
    expect(res.ui('contentMedia').blur).toBe(true)
    expect(res.causes[0]).toMatchObject({
      type: 'label',
      source: { type: 'user' },
    })
  })

  it('recognizes when the viewer owns the primary backing record', () => {
    const res = moderateViewExternal(
      viewExternal({
        labels: [label('porn', OWNER_DID)],
        ownerDid: OWNER_DID,
      }),
      { ...opts, userDid: OWNER_DID },
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(true)
    expect(res.ui('contentList').filter).toBe(false)
  })

  it('uses the primary backing record instead of associated profiles or later records', () => {
    const subject = viewExternal({
      labels: [label('porn', OWNER_DID), label('porn', 'did:web:alice.test')],
      ownerDid: OWNER_DID,
    })
    subject.associatedProfiles = [
      { did: 'did:web:alice.test', handle: 'alice.test' },
    ]
    subject.associatedRefs!.push({
      uri: 'at://did:web:alice.test/site.standard.document/article',
      cid: FAKE_CID,
    })

    const res = moderateViewExternal(subject, opts)
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
    expect(res.causes).toHaveLength(1)
    expect(res.causes[0]).toMatchObject({
      label: { src: OWNER_DID },
      source: { type: 'user' },
    })
  })

  it.each([undefined, []])(
    'does not infer ownership from profiles when associatedRefs is %j',
    (associatedRefs) => {
      const subject = viewExternal({ labels: [label('porn', OWNER_DID)] })
      subject.associatedProfiles = [{ did: OWNER_DID, handle: 'bob.test' }]
      subject.associatedRefs = associatedRefs

      const res = moderateViewExternal(subject, opts)
      expect(res.did).toBe('')
      expect(res.isMe).toBe(false)
      expect(res.causes).toHaveLength(0)
    },
  )

  it('does not treat a handle-based record URI as an owner DID', () => {
    const subject = viewExternal({ labels: [label('porn', LABELER_DID)] })
    subject.associatedRefs = [
      { uri: 'at://bob.test/site.standard.document/article', cid: FAKE_CID },
    ]

    const res = moderateViewExternal(subject, opts)
    expect(res.did).toBe('')
    expect(res.isMe).toBe(false)
    expect(res.ui('contentMedia').blur).toBe(true)
  })
})

describe('mergeModUIResults', () => {
  it('combines causes from multiple results and skips undefined', () => {
    const a = new ModerationUI()
    const b = new ModerationUI()
    const cause = moderateViewExternal(
      viewExternal({ labels: [label('porn', LABELER_DID)] }),
      opts,
    ).ui('contentMedia').blurs[0]
    a.blurs.push(cause)
    a.filters.push(cause)
    b.alerts.push(cause)
    b.informs.push(cause)

    const merged = mergeModUIResults(a, undefined, b)
    expect(merged.blurs).toHaveLength(1)
    expect(merged.filters).toHaveLength(1)
    expect(merged.alerts).toHaveLength(1)
    expect(merged.informs).toHaveLength(1)
    expect(merged.noOverride).toBe(false)
  })

  it('preserves the strictest noOverride', () => {
    const a = new ModerationUI()
    const b = new ModerationUI()
    b.noOverride = true

    expect(mergeModUIResults(a, b).noOverride).toBe(true)
    expect(mergeModUIResults().noOverride).toBe(false)
  })
})
