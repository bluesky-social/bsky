import type { DidString } from '@atproto/syntax'
import { currentDatetimeString } from '@atproto/syntax'
import { describe, expect, it } from 'vitest'
import type { ProfileLinkView } from '../src/lexicons/app/bsky/actor/defs.defs.js'
import type { Label } from '../src/lexicons/com/atproto/label/defs.defs.js'
import {
  type ModerationOpts,
  interpretLabelValueDefinition,
  moderateProfile,
  moderateProfileLink,
} from '../src/moderation/index.js'

const LABELER_DID: DidString = 'did:web:labeler.test'
const OWNER_DID: DidString = 'did:web:bob.test'
const VIEWER_DID: DidString = 'did:web:alice.test'
const FAKE_CID = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'
const LINK_URI = `at://${OWNER_DID}/app.bsky.actor.link/3m2lp5zsc7422` as const

function makeOpts(overrides: Partial<ModerationOpts['prefs']> = {}) {
  return {
    userDid: VIEWER_DID,
    prefs: {
      adultContentEnabled: true,
      labels: { porn: 'hide' },
      labelers: [{ did: LABELER_DID, labels: {} }],
      hiddenPosts: [],
      mutedWords: [],
      ...overrides,
    },
  } satisfies ModerationOpts
}

const opts: ModerationOpts = makeOpts()

function label(
  val: string,
  src: DidString,
  uri: Label['uri'] = LINK_URI,
): Label {
  return { val, src, uri, cts: currentDatetimeString() }
}

function linkView({
  labels,
  uri = LINK_URI,
  url = 'https://example.com/destination',
}: {
  labels?: Label[]
  uri?: ProfileLinkView['uri']
  url?: ProfileLinkView['url']
} = {}): ProfileLinkView {
  return { uri, cid: FAKE_CID, url, title: 'Example', labels }
}

describe('moderateProfileLink', () => {
  it.each([undefined, []])(
    'produces no causes and the record owner when labels is %j',
    (labels) => {
      const res = moderateProfileLink(linkView({ labels }), opts)
      expect(res.causes).toHaveLength(0)
      expect(res.did).toBe(OWNER_DID)
      expect(res.isMe).toBe(false)
    },
  )

  it('blurs contentView for a content label from a subscribed labeler', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('!warn', LABELER_DID)] }),
      opts,
    )
    expect(res.causes).toHaveLength(1)
    expect(res.causes[0]).toMatchObject({
      type: 'label',
      target: 'content',
      source: { type: 'labeler', did: LABELER_DID },
    })
    expect(res.ui('contentView').blur).toBe(true)
    expect(res.ui('contentMedia').blur).toBe(false)
  })

  it('blurs contentMedia for a media label from a subscribed labeler', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('porn', LABELER_DID)] }),
      opts,
    )
    expect(res.causes[0]).toMatchObject({ type: 'label', target: 'content' })
    expect(res.ui('contentMedia').blur).toBe(true)
    expect(res.ui('contentView').blur).toBe(false)
  })

  it('ignores labels from labelers the viewer is not subscribed to', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('porn', 'did:web:unknown.test')] }),
      opts,
    )
    expect(res.causes).toHaveLength(0)
  })

  it('applies owner self-labels without a subscription', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('porn', OWNER_DID)] }),
      opts,
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
    expect(res.causes).toHaveLength(1)
    expect(res.causes[0]).toMatchObject({
      type: 'label',
      source: { type: 'user' },
    })
    expect(res.ui('contentMedia').blur).toBe(true)
  })

  it('does not apply labels from other unsubscribed accounts as self-labels', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('porn', VIEWER_DID)] }),
      opts,
    )
    expect(res.causes).toHaveLength(0)
  })

  it('recognizes when the viewer owns the link record', () => {
    const res = moderateProfileLink(
      linkView({ labels: [label('porn', OWNER_DID)] }),
      { ...opts, userDid: OWNER_DID },
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(true)
    expect(res.ui('contentList').filter).toBe(false)
  })

  it('derives ownership from the record URI, not the destination URL', () => {
    const res = moderateProfileLink(
      linkView({
        labels: [label('porn', VIEWER_DID)],
        url: `https://example.com/${VIEWER_DID}`,
      }),
      { ...opts, userDid: VIEWER_DID },
    )
    expect(res.did).toBe(OWNER_DID)
    expect(res.isMe).toBe(false)
  })

  it('does not treat a handle-based record URI as an owner DID', () => {
    const uri = 'at://bob.test/app.bsky.actor.link/3m2lp5zsc7422' as const
    const res = moderateProfileLink(
      linkView({
        uri,
        labels: [
          label('porn', LABELER_DID, uri),
          label('!warn', 'bob.test' as DidString, uri),
        ],
      }),
      opts,
    )
    expect(res.did).toBe('')
    expect(res.isMe).toBe(false)
    expect(res.causes).toHaveLength(1)
    expect(res.causes[0]).toMatchObject({
      source: { type: 'labeler', did: LABELER_DID },
    })
    expect(res.ui('contentMedia').blur).toBe(true)
  })

  describe('label preferences', () => {
    const subject = linkView({ labels: [label('porn', LABELER_DID)] })

    it('hides media by default for adult labels', () => {
      const res = moderateProfileLink(subject, opts)
      expect(res.ui('contentMedia').blur).toBe(true)
      expect(res.ui('contentList').filter).toBe(true)
    })

    it('warns when the global preference is warn', () => {
      const res = moderateProfileLink(
        subject,
        makeOpts({ labels: { porn: 'warn' } }),
      )
      expect(res.ui('contentMedia').blur).toBe(true)
      expect(res.ui('contentList').filter).toBe(false)
    })

    it('ignores the label when the global preference is ignore', () => {
      const res = moderateProfileLink(
        subject,
        makeOpts({ labels: { porn: 'ignore' } }),
      )
      expect(res.causes).toHaveLength(0)
      expect(res.ui('contentMedia').blur).toBe(false)
    })

    it('prefers the per-labeler preference over the global one', () => {
      const res = moderateProfileLink(
        subject,
        makeOpts({
          labels: { porn: 'hide' },
          labelers: [{ did: LABELER_DID, labels: { porn: 'ignore' } }],
        }),
      )
      expect(res.causes).toHaveLength(0)
    })

    it('hides adult labels regardless of preference when adult content is disabled', () => {
      const res = moderateProfileLink(
        subject,
        makeOpts({
          adultContentEnabled: false,
          labels: { porn: 'ignore' },
        }),
      )
      expect(res.ui('contentMedia').blur).toBe(true)
      expect(res.ui('contentMedia').noOverride).toBe(true)
      expect(res.ui('contentList').filter).toBe(true)
    })

    it('uses custom content label definitions', () => {
      const custom = interpretLabelValueDefinition(
        {
          identifier: 'custom',
          blurs: 'content',
          severity: 'alert',
          defaultSetting: 'warn',
          locales: [],
        },
        LABELER_DID,
      )
      const res = moderateProfileLink(
        linkView({ labels: [label('custom', LABELER_DID)] }),
        { ...opts, labelDefs: { [LABELER_DID]: [custom] } },
      )
      expect(res.causes).toHaveLength(1)
      expect(res.causes[0]).toMatchObject({
        type: 'label',
        labelDef: { identifier: 'custom' },
      })
      // blurs=content, severity=alert: blurred in lists, alert when viewed
      expect(res.ui('contentList').blur).toBe(true)
      expect(res.ui('contentView').blur).toBe(false)
      expect(res.ui('contentView').alert).toBe(true)
      expect(res.ui('contentMedia').blur).toBe(false)
    })
  })

  it('does not affect profile UI contexts', () => {
    const res = moderateProfileLink(
      linkView({
        labels: [label('!warn', LABELER_DID), label('porn', LABELER_DID)],
      }),
      opts,
    )
    for (const context of [
      'profileList',
      'profileView',
      'avatar',
      'banner',
      'displayName',
    ] as const) {
      const ui = res.ui(context)
      expect(ui.filters).toHaveLength(0)
      expect(ui.blurs).toHaveLength(0)
      expect(ui.alerts).toHaveLength(0)
      expect(ui.informs).toHaveLength(0)
    }
  })

  it('is independent of the owner profile moderation decision', () => {
    const profile = {
      did: OWNER_DID,
      handle: 'bob.test' as const,
      labels: [label('!hide', LABELER_DID, OWNER_DID)],
    }
    const profileRes = moderateProfile(profile, opts)
    const linkRes = moderateProfileLink(linkView(), opts)
    expect(profileRes.causes.length).toBeGreaterThan(0)
    expect(linkRes.causes).toHaveLength(0)
  })
})
