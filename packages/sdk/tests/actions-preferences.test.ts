import { Client } from '@atproto/lex-client'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_SETTINGS,
  addLabeler,
  addSavedFeeds,
  getPreferences,
  removeLabeler,
  setAdultContentEnabled,
  setContentLabelPref,
} from '../src/index.js'
import { app } from '../src/lexicons/index.js'

function fakeClient(
  routes: Record<string, (init: { url: URL; body?: unknown }) => unknown>,
) {
  const calls: { nsid: string; body?: unknown }[] = []
  const client = new Client(
    {
      did: 'did:plc:test' as never,
      fetchHandler: async (path, init) => {
        const u = new URL(path, 'https://pds.test')
        const nsid = u.pathname.replace('/xrpc/', '')
        const body = init?.body ? JSON.parse(init.body as string) : undefined
        calls.push({ nsid, body })
        const handler = routes[nsid]
        if (!handler)
          return new Response(
            JSON.stringify({ error: 'MethodNotImplemented' }),
            { status: 501 },
          )
        return new Response(JSON.stringify(handler({ url: u, body })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
    { validateResponse: false },
  )
  return { client, calls }
}

describe('getPreferences', () => {
  it('interprets defaults from an empty pref array', async () => {
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: [] }),
      'app.bsky.actor.putPreferences': () => ({}),
    })
    const prefs = await client.call(getPreferences)
    expect(prefs.moderationPrefs.adultContentEnabled).toBe(false)
    expect(prefs.feedViewPrefs.home.hideReplies).toBe(false)
    expect(prefs.threadViewPrefs.sort).toBe('hotness')
  })

  it('interprets adult content + label prefs', async () => {
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({
        preferences: [
          { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'porn',
            visibility: 'show',
          },
        ],
      }),
      'app.bsky.actor.putPreferences': () => ({}),
    })
    const prefs = await client.call(getPreferences)
    expect(prefs.moderationPrefs.adultContentEnabled).toBe(true)
    // 'show' → 'ignore' legacy mapping
    expect(prefs.moderationPrefs.labels.porn).toBe('ignore')
  })

  it('migrates v1 saved feeds to v2 on first read', async () => {
    let stored: unknown[] = [
      {
        $type: 'app.bsky.actor.defs#savedFeedsPref',
        saved: ['at://did:plc:x/app.bsky.feed.generator/cool'],
        pinned: ['at://did:plc:x/app.bsky.feed.generator/cool'],
      },
    ]
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    const prefs = await client.call(getPreferences)
    expect(prefs.savedFeeds.length).toBeGreaterThan(0)
    const hasFeed = prefs.savedFeeds.some(
      (f) => f.value === 'at://did:plc:x/app.bsky.feed.generator/cool',
    )
    expect(hasFeed).toBe(true)
  })

  it('migrates legacy contentLabelPref "show" to "ignore" on all labels', async () => {
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({
        preferences: [
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'porn',
            visibility: 'show',
          },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'nudity',
            visibility: 'show',
          },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'sexual',
            visibility: 'show',
          },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'graphic-media',
            visibility: 'show',
          },
        ],
      }),
      'app.bsky.actor.putPreferences': () => ({}),
    })
    const prefs = await client.call(getPreferences)
    expect(prefs.moderationPrefs.labels.porn).toBe('ignore')
    expect(prefs.moderationPrefs.labels.nudity).toBe('ignore')
    expect(prefs.moderationPrefs.labels.sexual).toBe('ignore')
    expect(prefs.moderationPrefs.labels['graphic-media']).toBe('ignore')
  })

  it('remaps old label names to new on read (nsfw→porn, gore→graphic-media)', async () => {
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({
        preferences: [
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'nsfw',
            visibility: 'hide',
          },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'gore',
            visibility: 'hide',
          },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'suggestive',
            visibility: 'hide',
          },
        ],
      }),
      'app.bsky.actor.putPreferences': () => ({}),
    })
    const prefs = await client.call(getPreferences)
    expect(prefs.moderationPrefs.labels.porn).toBe('hide')
    expect(prefs.moderationPrefs.labels['graphic-media']).toBe('hide')
    expect(prefs.moderationPrefs.labels.sexual).toBe('hide')
  })

  it('interprets labelersPref and merges with app labelers', async () => {
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({
        preferences: [
          {
            $type: 'app.bsky.actor.defs#labelersPref',
            labelers: [{ did: 'did:plc:other' }],
          },
        ],
      }),
      'app.bsky.actor.putPreferences': () => ({}),
    })
    const prefs = await client.call(getPreferences)
    // The default app labeler + 'did:plc:other'
    const dids = prefs.moderationPrefs.labelers.map((l) => l.did)
    expect(dids).toContain('did:plc:other')
  })
})

describe('updatePreferences round-trip', () => {
  it('addSavedFeeds writes v2 feeds and returns them', async () => {
    let stored: unknown[] = []
    const { client, calls } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    const added = await client.call(addSavedFeeds, [
      {
        type: 'feed',
        value: 'at://did:plc:x/app.bsky.feed.generator/cool',
        pinned: true,
      },
    ])
    expect(added[0].id).toBeTruthy()
    expect(calls.some((c) => c.nsid === 'app.bsky.actor.putPreferences')).toBe(
      true,
    )
  })

  it('setAdultContentEnabled updates the pref', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    await client.call(setAdultContentEnabled, true)
    const prefs2 = await client.call(getPreferences)
    expect(prefs2.moderationPrefs.adultContentEnabled).toBe(true)
  })

  it('setContentLabelPref double-writes for legacy labels', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    await client.call(setContentLabelPref, { key: 'porn', value: 'hide' })
    const prefs = await client.call(getPreferences)
    // double-write: both porn and nsfw should be 'hide'
    expect(prefs.moderationPrefs.labels.porn).toBe('hide')
    expect(prefs.moderationPrefs.labels.nsfw).toBe('hide')
  })

  it('setContentLabelPref keeps all legacy pairs in sync through updates', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    const pairs = [
      ['graphic-media', 'gore'],
      ['porn', 'nsfw'],
      ['sexual', 'suggestive'],
    ] as const
    for (const [key, legacy] of pairs) {
      await client.call(setContentLabelPref, { key, value: 'hide' })
      const a = await client.call(getPreferences)
      expect(a.moderationPrefs.labels[key]).toBe('hide')
      expect(a.moderationPrefs.labels[legacy]).toBe('hide')

      await client.call(setContentLabelPref, { key, value: 'warn' })
      const b = await client.call(getPreferences)
      expect(b.moderationPrefs.labels[key]).toBe('warn')
      expect(b.moderationPrefs.labels[legacy]).toBe('warn')
    }
  })

  it('setContentLabelPref updates an existing pref, globally and per-labeler', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    await client.call(addLabeler, 'did:plc:other')
    await client.call(setContentLabelPref, { key: 'porn', value: 'ignore' })
    await client.call(setContentLabelPref, {
      key: 'porn',
      value: 'ignore',
      labelerDid: 'did:plc:other',
    })
    await client.call(setContentLabelPref, { key: 'porn', value: 'hide' })
    await client.call(setContentLabelPref, {
      key: 'porn',
      value: 'hide',
      labelerDid: 'did:plc:other',
    })

    const { moderationPrefs } = await client.call(getPreferences)
    const labeler = moderationPrefs.labelers.find(
      (l) => l.did === 'did:plc:other',
    )
    expect(moderationPrefs.labels.porn).toBe('hide')
    expect(labeler?.labels?.porn).toBe('hide')
  })

  it('setContentLabelPref does not accumulate duplicate legacy prefs when double-writing', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    await client.call(setContentLabelPref, { key: 'nsfw', value: 'hide' })
    await client.call(setContentLabelPref, { key: 'porn', value: 'hide' })

    const nsfwSettings = stored.filter(
      (pref) =>
        app.bsky.actor.defs.contentLabelPref.matches(pref) &&
        pref.label === 'nsfw',
    )
    expect(nsfwSettings.length).toBe(1)
  })

  it('addLabeler + removeLabeler updates labelers', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    await client.call(addLabeler, 'did:plc:other')
    const prefs1 = await client.call(getPreferences)
    expect(
      prefs1.moderationPrefs.labelers.some((l) => l.did === 'did:plc:other'),
    ).toBe(true)

    await client.call(removeLabeler, 'did:plc:other')
    const prefs2 = await client.call(getPreferences)
    expect(
      prefs2.moderationPrefs.labelers.some((l) => l.did === 'did:plc:other'),
    ).toBe(false)
  })
})

describe('updatePreferences serialization', () => {
  it('concurrent addSavedFeeds calls on same client do not clobber each other', async () => {
    let stored: unknown[] = []
    // Custom fetchHandler that properly awaits async route results and
    // introduces a 10ms delay on getPreferences to widen the race window.
    const client = new Client(
      {
        did: 'did:plc:test' as never,
        fetchHandler: async (path, init) => {
          const u = new URL(path, 'https://pds.test')
          const nsid = u.pathname.replace('/xrpc/', '')
          const body = init?.body ? JSON.parse(init.body as string) : undefined
          if (nsid === 'app.bsky.actor.getPreferences') {
            await new Promise((r) => setTimeout(r, 10))
            return new Response(JSON.stringify({ preferences: stored }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
          if (nsid === 'app.bsky.actor.putPreferences') {
            stored = (body as { preferences: unknown[] }).preferences
            return new Response(JSON.stringify({}), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
          return new Response(
            JSON.stringify({ error: 'MethodNotImplemented' }),
            { status: 501 },
          )
        },
      },
      { validateResponse: false },
    )
    // Fire both concurrently; without the serialization lock the second read
    // would see the initial empty state and overwrite the first write.
    await Promise.all([
      client.call(addSavedFeeds, [
        {
          type: 'feed',
          value: 'at://did:plc:x/app.bsky.feed.generator/feed-a',
          pinned: true,
        },
      ]),
      client.call(addSavedFeeds, [
        {
          type: 'feed',
          value: 'at://did:plc:x/app.bsky.feed.generator/feed-b',
          pinned: false,
        },
      ]),
    ])
    // Both feeds must be present — no write was lost
    const v2 = (stored as { $type: string; items?: unknown[] }[]).find(
      (p) => p.$type === 'app.bsky.actor.defs#savedFeedsPrefV2',
    )
    const values = (v2?.items as { value: string }[] | undefined)?.map(
      (f) => f.value,
    )
    expect(values).toContain('at://did:plc:x/app.bsky.feed.generator/feed-a')
    expect(values).toContain('at://did:plc:x/app.bsky.feed.generator/feed-b')
  })
})

describe('TID-format saved feed ids', () => {
  it('addSavedFeeds assigns ids matching the TID s32 format (13 chars, [2-7a-z])', async () => {
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    const [a] = await client.call(addSavedFeeds, [
      {
        type: 'feed',
        value: 'at://did:plc:x/app.bsky.feed.generator/a',
        pinned: true,
      },
    ])
    const [b] = await client.call(addSavedFeeds, [
      {
        type: 'feed',
        value: 'at://did:plc:x/app.bsky.feed.generator/b',
        pinned: false,
      },
    ])
    expect(a.id).toMatch(/^[2-7a-z]{13}$/)
    expect(b.id).toMatch(/^[2-7a-z]{13}$/)
    // Ids must be strictly increasing (TID ordering guarantee)
    expect(b.id > a.id).toBe(true)
  })
})

describe('getPreferences full-shape (ported from old moderation-prefs.test.ts)', () => {
  it('migrates legacy content-label prefs — full toStrictEqual shape', async () => {
    // Ported from old agent.ts moderation-prefs.test.ts:
    // "migrates legacy content-label prefs (no mutations)"
    // Adapts agent calls to client.call(action, ...) with fakeClient harness.
    let stored: unknown[] = [
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'porn',
        visibility: 'show',
      },
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'nudity',
        visibility: 'show',
      },
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'sexual',
        visibility: 'show',
      },
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'graphic-media',
        visibility: 'show',
      },
    ]
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })
    const prefs = await client.call(getPreferences)
    expect(prefs).toStrictEqual({
      feeds: {
        pinned: undefined,
        saved: undefined,
      },
      savedFeeds: expect.any(Array),
      interests: { tags: [] },
      moderationPrefs: {
        adultContentEnabled: false,
        labels: {
          porn: 'ignore',
          nudity: 'ignore',
          sexual: 'ignore',
          'graphic-media': 'ignore',
        },
        labelers: [...Client.appLabelers.map((did) => ({ did, labels: {} }))],
        hiddenPosts: [],
        mutedWords: [],
      },
      birthDate: undefined,
      declaredAge: undefined,
      feedViewPrefs: {
        home: {
          hideQuotePosts: false,
          hideReplies: false,
          hideRepliesByLikeCount: 0,
          hideRepliesByUnfollowed: true,
          hideReposts: false,
        },
      },
      threadViewPrefs: {
        sort: 'hotness',
      },
      bskyAppState: {
        activeProgressGuide: undefined,
        queuedNudges: [],
        nuxs: [],
      },
      postInteractionSettings: {
        threadgateAllowRules: undefined,
        postgateEmbeddingRules: undefined,
      },
      verificationPrefs: {
        hideBadges: false,
      },
      liveEventPreferences: {
        hiddenFeedIds: [],
        hideAllFeeds: false,
      },
    })
  })

  it('sets label preferences globally and per-moderator', async () => {
    // Ported from old moderation-prefs.test.ts:
    // "sets label preferences globally and per-moderator"
    let stored: unknown[] = []
    const { client } = fakeClient({
      'app.bsky.actor.getPreferences': () => ({ preferences: stored }),
      'app.bsky.actor.putPreferences': ({ body }) => {
        stored = (body as { preferences: unknown[] }).preferences
        return {}
      },
    })

    await client.call(addLabeler, 'did:plc:other')
    await client.call(setContentLabelPref, {
      key: 'porn',
      value: 'ignore',
    })
    await client.call(setContentLabelPref, {
      key: 'porn',
      value: 'hide',
      labelerDid: 'did:plc:other',
    })
    await client.call(setContentLabelPref, {
      key: 'x-custom',
      value: 'warn',
      labelerDid: 'did:plc:other',
    })

    const prefs = await client.call(getPreferences)
    expect(prefs).toStrictEqual({
      feeds: {
        pinned: undefined,
        saved: undefined,
      },
      savedFeeds: expect.any(Array),
      interests: { tags: [] },
      moderationPrefs: {
        adultContentEnabled: false,
        labels: { ...DEFAULT_LABEL_SETTINGS, porn: 'ignore', nsfw: 'ignore' },
        labelers: [
          ...Client.appLabelers.map((did) => ({ did, labels: {} })),
          {
            did: 'did:plc:other',
            labels: {
              porn: 'hide',
              'x-custom': 'warn',
            },
          },
        ],
        hiddenPosts: [],
        mutedWords: [],
      },
      birthDate: undefined,
      declaredAge: undefined,
      feedViewPrefs: {
        home: {
          hideReplies: false,
          hideRepliesByUnfollowed: true,
          hideRepliesByLikeCount: 0,
          hideReposts: false,
          hideQuotePosts: false,
        },
      },
      threadViewPrefs: {
        sort: 'hotness',
      },
      bskyAppState: {
        activeProgressGuide: undefined,
        queuedNudges: [],
        nuxs: [],
      },
      postInteractionSettings: {
        threadgateAllowRules: undefined,
        postgateEmbeddingRules: undefined,
      },
      verificationPrefs: {
        hideBadges: false,
      },
      liveEventPreferences: {
        hiddenFeedIds: [],
        hideAllFeeds: false,
      },
    })
  })
})
