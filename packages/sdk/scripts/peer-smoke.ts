/*
 * Peer-compatibility smoke test. Run from a scratch project where
 * @bsky.app/sdk (packed tarball) and a candidate @atproto/lex version are
 * installed as regular dependencies. Used two ways by peer-matrix.mjs:
 *
 *   1. Typechecked (tsgo --noEmit) — verifies the sdk's published .d.ts
 *      surface composes with the candidate lex version's types.
 *   2. Executed (node --experimental-strip-types) — exercises the sdk/lex
 *      boundary at runtime without network access: schema validation,
 *      lexicon $matches, moderation, rich text, and a full Action call
 *      through a stubbed fetch.
 *
 * Only erasable TS syntax allowed (runs via Node type stripping).
 * Exits non-zero (typecheck error or uncaught throw) on any incompatibility.
 */
import assert from 'node:assert/strict'
import { Client, type DidString } from '@atproto/lex'
import { api, post } from '@bsky.app/sdk'
import { app } from '@bsky.app/sdk/lexicons'
import {
  LABELS,
  type ModerationDecision,
  type ModerationOpts,
  moderatePost,
} from '@bsky.app/sdk/moderation'
import { RichText } from '@bsky.app/sdk/richtext'
import { validateNux } from '@bsky.app/sdk/utils'

const lexVersion = process.env.LEX_VERSION ?? 'unknown'
console.log(`smoke: @bsky.app/sdk against @atproto/lex@${lexVersion}`)

// Constants
assert.equal(api.app.urlPublic, 'https://public.api.bsky.app')

// Lexicon schemas: validation across the boundary
assert.equal(
  app.bsky.feed.post.$matches({
    $type: 'app.bsky.feed.post',
    text: 'hello',
    createdAt: '2024-01-01T00:00:00.000Z',
  }),
  true,
)
assert.equal(app.bsky.feed.post.$matches({ $type: 'other' }), false)

// Type-level: sdk record types compose with lex's branded strings.
const postRecord: app.bsky.feed.post.Main = {
  $type: 'app.bsky.feed.post',
  text: 'typed',
  createdAt: '2024-01-01T00:00:00.000Z' as app.bsky.feed.post.Main['createdAt'],
}
assert.equal(app.bsky.feed.post.$matches(postRecord), true)

// Utils: lex-schema-built validator
validateNux({ id: 'test-nux', completed: false })
assert.throws(() => validateNux({ id: 'x', completed: 'nope' }))

// Rich text: grapheme handling via lex re-export
const rt = new RichText({ text: 'Hello 👨‍👩‍👧‍👧 @divy.zone' })
assert.equal(typeof rt.graphemeLength, 'number')
assert.ok(rt.graphemeLength < rt.length)

// Moderation: label interpretation
assert.ok(LABELS.porn)
// Type-level: lex's DidString is accepted in the sdk's ModerationOpts.
const modOpts: ModerationOpts = {
  userDid: 'did:plc:viewer' as DidString,
  prefs: {
    adultContentEnabled: true,
    labels: { porn: 'hide' },
    labelers: [{ did: 'did:plc:labeler' as DidString, labels: {} }],
    mutedWords: [],
    hiddenPosts: [],
  },
}
const decision: ModerationDecision = moderatePost(
  {
    uri: 'at://did:plc:author/app.bsky.feed.post/1',
    cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqrsqmie7g5oq',
    author: { did: 'did:plc:author', handle: 'author.test' },
    record: {
      $type: 'app.bsky.feed.post',
      text: 'hi',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    labels: [
      {
        src: 'did:plc:labeler',
        uri: 'at://did:plc:author/app.bsky.feed.post/1',
        val: 'porn',
        cts: '2024-01-01T00:00:00.000Z',
      },
    ],
    indexedAt: '2024-01-01T00:00:00.000Z',
  },
  modOpts,
)
assert.ok(decision.ui('contentList').filter)

// Full Action call: sdk action -> lex Client -> stubbed fetch
const client = new Client({
  did: 'did:plc:smoketest' as DidString,
  service: 'https://pds.example',
  fetch: async (input) => {
    const url = new URL(input instanceof Request ? input.url : input)
    assert.equal(url.pathname, '/xrpc/com.atproto.repo.createRecord')
    return new Response(
      JSON.stringify({
        uri: 'at://did:plc:smoketest/app.bsky.feed.post/3juxk2xwqhs2a',
        cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqrsqmie7g5oq',
        commit: {
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqrsqmie7g5oq',
          rev: '3juxk2xwqhs2a',
        },
        validationStatus: 'valid',
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  },
})
const result = await client.call(post, { text: 'smoke test post' })
// Type-level: the Action's output type flows through client.call — `uri`
// must be a known string property, not `any`/`unknown`.
const resultUri: string = result.uri
assert.match(resultUri, /^at:\/\/did:plc:smoketest\//)

console.log(`smoke: OK (@atproto/lex@${lexVersion})`)
