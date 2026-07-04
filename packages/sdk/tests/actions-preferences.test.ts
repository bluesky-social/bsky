import { Client } from '@atproto/lex-client'
import { describe, expect, it } from 'vitest'
import {
  addLabeler,
  addSavedFeeds,
  getPreferences,
  removeLabeler,
  setAdultContentEnabled,
  setContentLabelPref,
} from '../src/index.js'

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
