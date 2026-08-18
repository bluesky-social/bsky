import { Client } from '@atproto/lex'
import { describe, expect, it } from 'vitest'
import {
  blockActor,
  follow,
  like,
  muteActor,
  post,
  unblockActor,
  upsertProfile,
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

describe('record actions', () => {
  it('post creates an app.bsky.feed.post with createdAt defaulted', async () => {
    const { client, calls } = fakeClient({
      'com.atproto.repo.createRecord': () => ({
        uri: 'at://did:plc:test/app.bsky.feed.post/1',
        cid: 'bafy1',
      }),
    })
    const res = await client.call(post, { text: 'hello' })
    expect(res.uri).toContain('app.bsky.feed.post')
    const create = calls.find((c) => c.nsid === 'com.atproto.repo.createRecord')
    expect((create!.body as any).record.createdAt).toBeTruthy()
  })

  it('like creates a like record pointing at subject', async () => {
    const { client, calls } = fakeClient({
      'com.atproto.repo.createRecord': () => ({
        uri: 'at://x/app.bsky.feed.like/1',
        cid: 'bafy2',
      }),
    })
    await client.call(like, {
      uri: 'at://did:plc:a/app.bsky.feed.post/1',
      cid: 'bafyp',
    })
    const body = calls[0].body as any
    expect(body.collection).toBe('app.bsky.feed.like')
    expect(body.record.subject.uri).toBe('at://did:plc:a/app.bsky.feed.post/1')
  })

  it('upsertProfile merges updates over existing record with swap retry', async () => {
    let putCount = 0
    const { client } = fakeClient({
      'com.atproto.repo.getRecord': () => ({
        uri: 'at://did:plc:test/app.bsky.actor.profile/self',
        cid: 'bafyc',
        value: {
          $type: 'app.bsky.actor.profile',
          displayName: 'Old',
        },
      }),
      'com.atproto.repo.putRecord': () => {
        putCount++
        return { uri: 'u', cid: 'c' }
      },
    })
    await client.call(upsertProfile, (existing) => ({
      ...existing,
      displayName: 'New',
    }))
    expect(putCount).toBe(1)
  })

  it('upsertProfile passes undefined to updateFn when existing record fails profile validation', async () => {
    let receivedExisting: unknown = 'sentinel'
    const { client } = fakeClient({
      'com.atproto.repo.getRecord': () => ({
        uri: 'at://did:plc:test/app.bsky.actor.profile/self',
        cid: 'bafyinvalid',
        value: {
          $type: 'app.bsky.actor.profile',
          // displayName exceeds the 64-grapheme limit — fails validation
          displayName: 'x'.repeat(200),
        },
      }),
      'com.atproto.repo.putRecord': () => ({ uri: 'u', cid: 'c' }),
    })
    await client.call(upsertProfile, (existing) => {
      receivedExisting = existing
      return { displayName: 'Valid' }
    })
    expect(receivedExisting).toBeUndefined()
  })

  it('upsertProfile throws and does not call putRecord when updateFn returns an invalid record', async () => {
    let putCalled = false
    const { client } = fakeClient({
      'com.atproto.repo.getRecord': () => ({
        uri: 'at://did:plc:test/app.bsky.actor.profile/self',
        cid: 'bafyc',
        value: { $type: 'app.bsky.actor.profile', displayName: 'Old' },
      }),
      'com.atproto.repo.putRecord': () => {
        putCalled = true
        return { uri: 'u', cid: 'c' }
      },
    })
    await expect(
      client.call(upsertProfile, () => ({
        // displayName exceeds the 64-grapheme limit — invalid
        displayName: 'x'.repeat(200),
      })),
    ).rejects.toThrow()
    expect(putCalled).toBe(false)
  })

  it('muteActor calls app.bsky.graph.muteActor', async () => {
    const { client, calls } = fakeClient({
      'app.bsky.graph.muteActor': () => ({}),
    })
    await client.call(muteActor, { actor: 'did:plc:bad' })
    expect(calls[0].nsid).toBe('app.bsky.graph.muteActor')
    expect(calls[0].body).toEqual({ actor: 'did:plc:bad' })
  })

  it('muteActor passes scoped-mute options', async () => {
    const { client, calls } = fakeClient({
      'app.bsky.graph.muteActor': () => ({}),
    })
    await client.call(muteActor, {
      actor: 'did:plc:bad',
      onlyReposts: true,
      onlyQuoteposts: true,
    })
    expect(calls[0].body).toEqual({
      actor: 'did:plc:bad',
      onlyReposts: true,
      onlyQuoteposts: true,
    })
  })

  it('blockActor creates a graph block record', async () => {
    const { client, calls } = fakeClient({
      'com.atproto.repo.createRecord': () => ({
        uri: 'at://did:plc:test/app.bsky.graph.block/1',
        cid: 'b',
      }),
    })
    await client.call(blockActor, { did: 'did:plc:blocked' })
    const body = calls[0].body as any
    expect(body.collection).toBe('app.bsky.graph.block')
    expect(body.record.subject).toBe('did:plc:blocked')
    expect(body.record.createdAt).toBeTruthy()
  })

  it('unblockActor deletes a graph block record by URI', async () => {
    const { client, calls } = fakeClient({
      'com.atproto.repo.deleteRecord': () => ({}),
    })
    await client.call(
      unblockActor,
      'at://did:plc:test/app.bsky.graph.block/3jqfcqzm3fo2j',
    )
    expect(calls.map((call) => call.nsid)).toEqual([
      'com.atproto.repo.deleteRecord',
    ])
    expect(calls[0].body).toMatchObject({
      repo: 'did:plc:test',
      collection: 'app.bsky.graph.block',
      rkey: '3jqfcqzm3fo2j',
    })
  })

  it('follow creates a graph follow record', async () => {
    const { client, calls } = fakeClient({
      'com.atproto.repo.createRecord': () => ({
        uri: 'at://x/app.bsky.graph.follow/1',
        cid: 'b',
      }),
    })
    await client.call(follow, { did: 'did:plc:friend' })
    expect((calls[0].body as any).collection).toBe('app.bsky.graph.follow')
  })
})
