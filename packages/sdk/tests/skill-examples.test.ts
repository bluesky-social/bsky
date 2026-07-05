/**
 * Compile-check for all TypeScript snippets in
 * skills/upgrade-from-atproto-api/SKILL.md.
 *
 * This file does NOT execute network calls. It only constructs types,
 * clients, and actions at the type level to verify imports and signatures
 * compile under the project's tsconfig.
 */

import { jsonToLex, lexParse, lexStringify, lexToJson } from '@atproto/lex'
import {
  type DidString,
  type HandleString,
  asAtUriString,
  asStringFormat,
  isAtUriString,
  isDatetimeString,
  isStringFormat,
} from '@atproto/lex'
import { Client } from '@atproto/lex-client'
import {
  PasswordSession,
  type SessionData,
} from '@atproto/lex-password-session'
import type { AtprotoDid, HandleResolver } from '@atproto-labs/handle-resolver'
import { describe, expect, it } from 'vitest'
import { api } from '../src/api.js'
import {
  addLabeler,
  addMutedWord,
  addMutedWords,
  addSavedFeeds,
  blockActorList,
  deleteFollow,
  deleteLike,
  deletePost,
  deleteRepost,
  dismissNudges,
  follow,
  getPreferences,
  hidePost,
  like,
  muteActor,
  muteActorList,
  overwriteSavedFeeds,
  post,
  queueNudges,
  removeLabeler,
  removeMutedWord,
  removeMutedWords,
  removeNuxs,
  removeSavedFeeds,
  repost,
  setActiveProgressGuide,
  setAdultContentEnabled,
  setContentLabelPref,
  setFeedViewPrefs,
  setInterestsPref,
  setPersonalDetails,
  setPostInteractionSettings,
  setThreadViewPrefs,
  setVerificationPrefs,
  unblockActorList,
  unhidePost,
  unmuteActor,
  unmuteActorList,
  updateLiveEventPreferences,
  updateMutedWord,
  updatePreferences,
  updateSavedFeeds,
  updateSeenNotifications,
  upsertMutedWords,
  upsertNux,
  upsertProfile,
} from '../src/index.js'
import { app, com } from '../src/lexicons/index.js'
import {
  DEFAULT_LABEL_SETTINGS,
  LABELS,
  type ModerationOpts,
  hasMutedWord,
  moderatePost,
  moderateProfile,
} from '../src/moderation/index.js'
import {
  MENTION_REGEX,
  RichText,
  URL_REGEX,
  sanitizeRichText,
} from '../src/rich-text/index.js'

// ── Anchor test ───────────────────────────────────────────────────────────────

describe('skill-examples', () => {
  it('compiles', () => {
    expect(true).toBe(true)
  })

  // § 1 — Client setup types
  it('api constants have expected shape', () => {
    const _appDid: string = api.app.did
    const _appService: string = api.app.service
    const _appUrl: string = api.app.url
    const _appUrlPublic: string = api.app.urlPublic
    const _chatDid: string = api.chat.did
    const _chatService: string = api.chat.service
    const _modDid: string = api.moderation.did
    const _modService: string = api.moderation.service
    expect(api.moderation.did).toBe('did:plc:ar7c4by46qjdydhdevvrndac')
    expect(api.app.service).toBe('did:web:api.bsky.app#bsky_appview')
    expect(api.app.urlPublic).toBe('https://public.api.bsky.app')
  })

  // § 2 — Import mappings compile check (type-level only)
  it('codec functions exist', () => {
    expect(typeof lexParse).toBe('function')
    expect(typeof jsonToLex).toBe('function')
    expect(typeof lexToJson).toBe('function')
    expect(typeof lexStringify).toBe('function')
  })

  it('$matches replaces asPredicate', () => {
    // old: asPredicate(schema) — new: schema.$matches
    const data: unknown = { $type: 'app.bsky.feed.post', text: 'hi' }
    const isPost = app.bsky.feed.post.$matches(data)
    expect(typeof isPost).toBe('boolean')
  })

  it('string format helpers compile', () => {
    const rawDid = 'did:plc:abc123' as string
    const isD = isStringFormat(rawDid, 'did')
    expect(typeof isD).toBe('boolean')

    const rawUri = 'at://did:plc:abc/app.bsky.feed.post/rkey' as string
    const isUri = isAtUriString(rawUri)
    expect(typeof isUri).toBe('boolean')

    const rawDt = '2024-01-01T00:00:00Z' as string
    const isDt = isDatetimeString(rawDt)
    expect(typeof isDt).toBe('boolean')
  })

  it('moderation functions are importable', () => {
    expect(typeof moderatePost).toBe('function')
    expect(typeof moderateProfile).toBe('function')
    expect(typeof hasMutedWord).toBe('function')
    expect(typeof DEFAULT_LABEL_SETTINGS).toBe('object')
    expect(typeof LABELS).toBe('object')
  })

  it('rich text exports are importable', () => {
    const rt = new RichText({ text: 'Hello!' })
    expect(rt.text).toBe('Hello!')
    expect(typeof MENTION_REGEX).toBe('object')
    expect(typeof URL_REGEX).toBe('object')
    expect(typeof sanitizeRichText).toBe('function')
  })

  it('action functions are importable', () => {
    expect(typeof post).toBe('function')
    expect(typeof deletePost).toBe('function')
    expect(typeof like).toBe('function')
    expect(typeof deleteLike).toBe('function')
    expect(typeof repost).toBe('function')
    expect(typeof deleteRepost).toBe('function')
    expect(typeof follow).toBe('function')
    expect(typeof deleteFollow).toBe('function')
    expect(typeof upsertProfile).toBe('function')
    expect(typeof muteActor).toBe('function')
    expect(typeof unmuteActor).toBe('function')
    expect(typeof muteActorList).toBe('function')
    expect(typeof unmuteActorList).toBe('function')
    expect(typeof blockActorList).toBe('function')
    expect(typeof unblockActorList).toBe('function')
    expect(typeof updateSeenNotifications).toBe('function')
  })

  it('preference action functions are importable', () => {
    expect(typeof getPreferences).toBe('function')
    expect(typeof setAdultContentEnabled).toBe('function')
    expect(typeof setContentLabelPref).toBe('function')
    expect(typeof addSavedFeeds).toBe('function')
    expect(typeof removeSavedFeeds).toBe('function')
    expect(typeof updateSavedFeeds).toBe('function')
    expect(typeof overwriteSavedFeeds).toBe('function')
    expect(typeof setFeedViewPrefs).toBe('function')
    expect(typeof setThreadViewPrefs).toBe('function')
    expect(typeof setPersonalDetails).toBe('function')
    expect(typeof setInterestsPref).toBe('function')
    expect(typeof addMutedWord).toBe('function')
    expect(typeof addMutedWords).toBe('function')
    expect(typeof upsertMutedWords).toBe('function')
    expect(typeof updateMutedWord).toBe('function')
    expect(typeof removeMutedWord).toBe('function')
    expect(typeof removeMutedWords).toBe('function')
    expect(typeof hidePost).toBe('function')
    expect(typeof unhidePost).toBe('function')
    expect(typeof addLabeler).toBe('function')
    expect(typeof removeLabeler).toBe('function')
    expect(typeof setVerificationPrefs).toBe('function')
    expect(typeof setPostInteractionSettings).toBe('function')
    expect(typeof updateLiveEventPreferences).toBe('function')
  })

  it('bskyApp-renamed action functions are importable', () => {
    expect(typeof queueNudges).toBe('function')
    expect(typeof dismissNudges).toBe('function')
    expect(typeof setActiveProgressGuide).toBe('function')
    expect(typeof upsertNux).toBe('function')
    expect(typeof removeNuxs).toBe('function')
  })

  // § 3 — Lexicon XRPC schemas exist
  it('app.bsky passthrough schemas are accessible', () => {
    expect(app.bsky.feed.getTimeline).toBeDefined()
    expect(app.bsky.feed.getAuthorFeed).toBeDefined()
    expect(app.bsky.feed.getActorLikes).toBeDefined()
    expect(app.bsky.feed.getPostThread).toBeDefined()
    expect(app.bsky.feed.getPosts).toBeDefined()
    expect(app.bsky.feed.getLikes).toBeDefined()
    expect(app.bsky.feed.getRepostedBy).toBeDefined()
    expect(app.bsky.actor.getProfile).toBeDefined()
    expect(app.bsky.actor.getProfiles).toBeDefined()
    expect(app.bsky.actor.getSuggestions).toBeDefined()
    expect(app.bsky.actor.searchActors).toBeDefined()
    expect(app.bsky.actor.searchActorsTypeahead).toBeDefined()
    expect(app.bsky.graph.getFollows).toBeDefined()
    expect(app.bsky.graph.getFollowers).toBeDefined()
    expect(app.bsky.notification.listNotifications).toBeDefined()
    expect(app.bsky.notification.getUnreadCount).toBeDefined()
    expect(app.bsky.labeler.getServices).toBeDefined()
  })

  it('com.atproto.identity.resolveHandle schema is accessible', () => {
    expect(com.atproto.identity.resolveHandle).toBeDefined()
  })

  it('app.bsky.feed.post schema is accessible', () => {
    expect(app.bsky.feed.post).toBeDefined()
    expect(typeof app.bsky.feed.post.$matches).toBe('function')
    expect(typeof app.bsky.feed.post.$assert).toBe('function')
  })

  // § 4 — Sessions (type-level only)
  it('PasswordSession and SessionData are importable', () => {
    expect(typeof PasswordSession.login).toBe('function')
    expect(typeof PasswordSession.resume).toBe('function')
    // SessionData is a type; we just verify the import compiles
    type _Check = SessionData extends { service: string } ? true : false
  })

  // § 5 — String format types (type-level assertions)
  it('string format type narrowing compiles', () => {
    function processIncoming(rawDid: string): DidString {
      return asStringFormat(rawDid, 'did')
    }
    // Calling with a known-valid value at runtime
    const did = processIncoming('did:plc:abc123')
    expect(did).toBe('did:plc:abc123')
  })

  it('per-boundary validation idiom compiles', () => {
    function validateBoundary(rawActor: string, rawUri: string) {
      const actorDid = asStringFormat(rawActor, 'did')
      const postUri = asAtUriString(rawUri)
      return { actorDid, postUri }
    }
    const result = validateBoundary(
      'did:plc:abc',
      'at://did:plc:abc/app.bsky.feed.post/rkey',
    )
    expect(result.actorDid).toBe('did:plc:abc')
  })

  it('$assert narrows type for schema objects', () => {
    const data: unknown = {
      $type: 'app.bsky.feed.post',
      text: 'Hello',
      createdAt: '2024-01-01T00:00:00Z',
    }
    expect(() => app.bsky.feed.post.$assert(data)).not.toThrow()
  })

  // § 6 — Worked example (type-level, no network calls)
  it('handleResolver adapter compiles', () => {
    // Verify the adapter type checks without instantiating a real client
    function resolverFromClient(client: Client): HandleResolver {
      return {
        resolve: async (handle: string) => {
          try {
            const res = await client.call(com.atproto.identity.resolveHandle, {
              handle: handle as HandleString,
            })
            return res.did as AtprotoDid
          } catch {
            return null
          }
        },
      }
    }
    // The function itself compiles; that's what we're checking
    expect(typeof resolverFromClient).toBe('function')
  })

  it('ModerationOpts type is constructable', () => {
    const opts: ModerationOpts = {
      userDid: 'did:plc:test',
      prefs: {
        adultContentEnabled: false,
        labels: {},
        labelers: [{ did: api.moderation.did, labels: {} }],
        mutedWords: [],
        hiddenPosts: [],
      },
    }
    expect(opts.userDid).toBe('did:plc:test')
  })

  it('Client can be constructed with URL string', () => {
    // Unauthenticated public client — verifies constructor signature
    const client = new Client(api.app.urlPublic)
    expect(client).toBeDefined()
  })
})

// ── README examples compile-check ─────────────────────────────────────────────

describe('README examples', () => {
  it('three-client pattern compiles', () => {
    // PDS client from an authenticated session (Agent)
    function makePdsClient(session: PasswordSession) {
      return new Client(session)
    }
    // App view proxied through PDS
    function makeAppviewClient(pds: Client) {
      return new Client(pds, {
        service: api.app.service,
      })
    }
    // Public unauthenticated client from URL string
    const publicClient = new Client(api.app.urlPublic)
    expect(typeof makePdsClient).toBe('function')
    expect(typeof makeAppviewClient).toBe('function')
    expect(publicClient).toBeDefined()
  })

  it('post action compiles', () => {
    async function example(pdsClient: Client) {
      const result = await pdsClient.call(post, {
        text: 'Hello from @bsky.app/sdk!',
        langs: ['en'],
      })
      // result: { uri: string; cid: string }
      const _uri: string = result.uri
      return _uri
    }
    expect(typeof example).toBe('function')
  })

  it('xrpc with params compiles', () => {
    async function example(publicClient: Client) {
      const { body } = await publicClient.xrpc(app.bsky.feed.getTimeline.main, {
        params: { limit: 20 },
      })
      return body
    }
    expect(typeof example).toBe('function')
  })

  it('blockActorList and unblockActorList are exported', () => {
    expect(typeof blockActorList).toBe('function')
    expect(typeof unblockActorList).toBe('function')
    expect(typeof updatePreferences).toBe('function')
  })
})
