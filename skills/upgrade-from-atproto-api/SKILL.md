---
name: upgrade-from-atproto-api
description: Migrate code from @atproto/api to @bsky.app/sdk + @atproto/lex — import mappings, agent-to-client patterns, string format types
---

# Migrating from `@atproto/api` to `@bsky.app/sdk` + `@atproto/lex`

The `@atproto/api` package has been superseded by two packages:

- **`@bsky.app/sdk`** — Bluesky-specific actions, moderation helpers, rich text, and the `api` constants object.
- **`@atproto/lex`** — the generic AT Protocol client, lexicon utilities, and schema types. A peer dependency of the sdk; install both. (`@atproto/lex-password-session` is separate, only needed for password-based sessions.)

```
npm install @bsky.app/sdk @atproto/lex
```

Import `Client` and other lex utilities from `@atproto/lex` — not from its underlying sub-packages (`@atproto/lex-client`, `@atproto/lex-schema`), which shouldn't be depended upon directly.

## 1. Client Setup

There are two common client patterns.

```typescript
import { Client } from '@atproto/lex'
import { PasswordSession } from '@atproto/lex-password-session'
import { api } from '@bsky.app/sdk'
import { app, com } from '@bsky.app/sdk/lexicons'

// --- Pattern 1: Authenticated Bluesky client ---
// Queries are proxied through the account host to api.bsky.app and signed
// with the user's identity. Record writes and mutations (createRecord,
// applyWrites, etc.) automatically target the account host directly, so one
// client covers both.
const session = await PasswordSession.login({
  service: 'https://bsky.social',
  identifier: 'alice.bsky.social',
  password: 'xxxx-xxxx-xxxx-xxxx', // App password
  onUpdated: (data) => saveToStorage(data),
  onDeleted: (data) => clearStorage(data.did),
})
const bskyClient = new Client(session, {
  service: api.app.service, // 'did:web:api.bsky.app#bsky_appview'
})

// --- Pattern 2: Public Bluesky API client (unauthenticated read-only) ---
// Use for reading public data without authentication.
const publicBskyClient = new Client(api.app.urlPublic) // 'https://public.api.bsky.app'
```

To target a different service for a single request (e.g. the account host
itself, or a labeler), pass `service` in the per-request options rather than
constructing another client — `{ service: null }` reaches the account host
directly:

```typescript
const records = await bskyClient.call(
  com.atproto.repo.listRecords,
  { repo: bskyClient.assertDid, collection: 'app.bsky.feed.post' },
  { service: null },
)
```

Deployments that already keep separate clients for the account host vs the
Bluesky API can continue to do so — construct each client from the same
session:

```typescript
const accountClient = new Client(session)
const bskyClient = new Client(session, { service: api.app.service })
```

**`api` constants reference:**

| Constant                 | Value                                                |
| ------------------------ | ---------------------------------------------------- |
| `api.app.did`            | `'did:web:api.bsky.app'`                             |
| `api.app.service`        | `'did:web:api.bsky.app#bsky_appview'`                |
| `api.app.url`            | `'https://api.bsky.app'`                             |
| `api.app.urlPublic`      | `'https://public.api.bsky.app'`                      |
| `api.chat.did`           | `'did:web:api.bsky.chat'`                            |
| `api.chat.service`       | `'did:web:api.bsky.chat#bsky_chat'`                  |
| `api.chat.url`           | `'https://api.bsky.chat'`                            |
| `api.moderation.did`     | `'did:plc:ar7c4by46qjdydhdevvrndac'`                 |
| `api.moderation.service` | `'did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler'` |

**Labeler caveat:** When no labeler headers are sent, the Bluesky API applies its own moderation service by default — so if you don't introduce other labelers, no labeler configuration is needed at all. The `atproto-accept-labelers` header works by replacement, not addition: sending _any_ labelers header replaces that server-side default. So when you introduce other labelers, keep the Bluesky labeler active by setting it as an _app labeler_ — app labelers are always included in the header with the `;redact` parameter (allowing takedowns), which a plain `labelers` entry does not set:

```typescript
import { Client } from '@atproto/lex'
import { api } from '@bsky.app/sdk'

const client = new Client(session, {
  service: api.app.service,
  appLabelers: [api.moderation.did], // keep Bluesky moderation, with `;redact`
  labelers: ['did:plc:mycustomlabeler...'], // the user's labeler subscriptions
})
```

(`Client.configure({ appLabelers })` sets the same thing globally for all client instances; prefer the per-client option.) Defaults cascade app → client → request: a per-request `labelers` array replaces the client's, `labelers: null` disables the header for that request, and `appLabelers: null` opts a client or request out of the app labelers.

---

## 2. Import Mappings

### Client / Session classes

| Old (`@atproto/api`) | New               | Package                         |
| -------------------- | ----------------- | ------------------------------- |
| `AtpAgent`           | `Client`          | `@atproto/lex`                  |
| `Agent`              | `Client`          | `@atproto/lex`                  |
| `BskyAgent`          | `Client`          | `@atproto/lex`                  |
| `AtpBaseClient`      | `Client`          | `@atproto/lex`                  |
| `CredentialSession`  | `PasswordSession` | `@atproto/lex-password-session` |

### Sessions

| Old (`@atproto/api`)       | New           | Package                         | Notes                                                              |
| -------------------------- | ------------- | ------------------------------- | ------------------------------------------------------------------ |
| `AtpSessionData`           | `SessionData` | `@atproto/lex-password-session` | Shape for persisted session data; renamed for clarity              |
| `AtpSessionEvent`          | removed       | —                               | Session event types now inferred from `PasswordSession` callbacks  |
| `AtpPersistSessionHandler` | removed       | —                               | Use `onUpdated`/`onDeleted` callbacks on `PasswordSession` instead |
| `AtpAgentLoginOpts`        | removed       | —                               | Merged into `PasswordSession.login()` parameters                   |
| `AtpAgentGlobalOpts`       | removed       | —                               | Replaced by `Client` constructor options                           |

### Preferences Types

| Old (`@atproto/api`)       | New                        | Package         | Notes                                                      |
| -------------------------- | -------------------------- | --------------- | ---------------------------------------------------------- |
| `BskyPreferences`          | `BskyPreferences`          | `@bsky.app/sdk` | Still available, now exported from SDK root (via types.ts) |
| `BskyFeedViewPreference`   | `BskyFeedViewPreference`   | `@bsky.app/sdk` | Still available, now exported from SDK root (via types.ts) |
| `BskyThreadViewPreference` | `BskyThreadViewPreference` | `@bsky.app/sdk` | Still available, now exported from SDK root (via types.ts) |
| `BskyInterestsPreference`  | `BskyInterestsPreference`  | `@bsky.app/sdk` | Still available, now exported from SDK root (via types.ts) |

### Errors

| Old (`@atproto/api`) | New                                 | Package        |
| -------------------- | ----------------------------------- | -------------- |
| `XRPCError`          | `XrpcResponseError` / `XrpcFailure` | `@atproto/lex` |

### Utility / codec functions

| Old (`@atproto/api`) | New                                                    | Package                  |
| -------------------- | ------------------------------------------------------ | ------------------------ |
| `jsonStringToLex`    | `lexParse`                                             | `@atproto/lex`           |
| `jsonToLex`          | `jsonToLex`                                            | `@atproto/lex`           |
| `lexToJson`          | `lexToJson`                                            | `@atproto/lex`           |
| `stringifyLex`       | `lexStringify`                                         | `@atproto/lex`           |
| `BlobRef`            | `BlobRef`                                              | `@atproto/lex`           |
| `asPredicate`        | `schema.$matches` (e.g. `app.bsky.feed.post.$matches`) | `@bsky.app/sdk/lexicons` |
| `parseLanguage`      | removed — use `isLanguageString`                       | `@atproto/lex`           |

### Type utilities

| Old (`@atproto/api`) | New            | Package                                    |
| -------------------- | -------------- | ------------------------------------------ |
| `$Typed<T>`          | `$Typed<V, T>` | `@atproto/lex-schema` (via `@atproto/lex`) |
| `Un$Typed<T>`        | `Un$Typed<V>`  | `@atproto/lex-schema` (via `@atproto/lex`) |

### Constants

| Old (`@atproto/api`)     | New                      | Package         |
| ------------------------ | ------------------------ | --------------- |
| `BSKY_LABELER_DID`       | `api.moderation.did`     | `@bsky.app/sdk` |
| `DEFAULT_LABEL_SETTINGS` | `DEFAULT_LABEL_SETTINGS` | `@bsky.app/sdk` |

### Moderation

| Old (`@atproto/api`)             | New                              | Package                    |
| -------------------------------- | -------------------------------- | -------------------------- |
| `moderatePost`                   | `moderatePost`                   | `@bsky.app/sdk/moderation` |
| `moderateProfile`                | `moderateProfile`                | `@bsky.app/sdk/moderation` |
| `moderateUserList`               | `moderateUserList`               | `@bsky.app/sdk/moderation` |
| `moderateFeedGenerator`          | `moderateFeedGenerator`          | `@bsky.app/sdk/moderation` |
| `moderateNotification`           | `moderateNotification`           | `@bsky.app/sdk/moderation` |
| `moderateStatus`                 | `moderateStatus`                 | `@bsky.app/sdk/moderation` |
| `ModerationUI`                   | `ModerationUI`                   | `@bsky.app/sdk/moderation` |
| `ModerationDecision`             | `ModerationDecision`             | `@bsky.app/sdk/moderation` |
| `interpretLabelValueDefinition`  | `interpretLabelValueDefinition`  | `@bsky.app/sdk/moderation` |
| `interpretLabelValueDefinitions` | `interpretLabelValueDefinitions` | `@bsky.app/sdk/moderation` |
| `hasMutedWord`                   | `hasMutedWord`                   | `@bsky.app/sdk/moderation` |
| `matchMuteWords`                 | `matchMuteWords`                 | `@bsky.app/sdk/moderation` |
| `LABELS`                         | `LABELS`                         | `@bsky.app/sdk/moderation` |

### Rich text

| Old (`@atproto/api`)               | New                                    | Package                  |
| ---------------------------------- | -------------------------------------- | ------------------------ |
| `RichText`                         | `RichText`                             | `@bsky.app/sdk/richtext` |
| `RichText.detectFacets(agent)`     | `rt.detectFacets(resolver)` — see note | `@bsky.app/sdk/richtext` |
| `sanitizeRichText`                 | `sanitizeRichText`                     | `@bsky.app/sdk/richtext` |
| `UnicodeString`                    | `UnicodeString`                        | `@bsky.app/sdk/richtext` |
| `MENTION_REGEX`, `URL_REGEX`, etc. | same names                             | `@bsky.app/sdk/richtext` |

**`detectFacets` resolver change:** The method now takes either a `Client` or a `HandleResolver` from `@atproto-labs/handle-resolver` instead of an agent. Passing a `Client` resolves handles via `com.atproto.identity.resolveHandle`:

```typescript
// Usage with a Client (resolves via com.atproto.identity.resolveHandle):
const rt = new RichText({ text: 'Hello @alice.bsky.social!' })
await rt.detectFacets(bskyClient)

// Or bring your own HandleResolver:
await rt.detectFacets(myHandleResolver)
```

The `Client`-backed resolver is also exported directly for standalone use:

```typescript
import { ClientHandleResolver } from '@bsky.app/sdk/utils'

const resolver = new ClientHandleResolver(bskyClient)
const did = await resolver.resolve('alice.bsky.social') // AtprotoDid | null
```

### Utils

| Old (`@atproto/api`)     | New                                          | Package               |
| ------------------------ | -------------------------------------------- | --------------------- |
| `sanitizeMutedWordValue` | `sanitizeMutedWordValue`                     | `@bsky.app/sdk/utils` |
| `validateNux`            | `validateNux`                                | `@bsky.app/sdk/utils` |
| `nuxSchema`              | `nuxSchema`                                  | `@bsky.app/sdk/utils` |
| `savedFeedsToUriArrays`  | removed — compute from `savedFeeds` directly | —                     |

### Removed without direct replacement

| Old (`@atproto/api`)                    | Notes                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `mock` / `BskyAgent.mockResolveHandles` | removed; test with a fake `HandleResolver` function                             |
| `isDid` / `asDid` / `assertDid`         | use `isStringFormat(v, 'did')` / `asStringFormat(v, 'did')` from `@atproto/lex` |
| `AtUri`                                 | `AtUri` from `@atproto/syntax` (still a direct dependency)                      |
| `lexicons` export (Lexicons instance)   | use generated schema objects from `@bsky.app/sdk/lexicons`                      |
| `getSavedFeedType`                      | internal only; moved to preference actions                                      |
| `validateSavedFeed`                     | internal only; moved to preference actions                                      |

---

## 3. Agent Methods → Actions / Client Calls

The `Agent`/`AtpAgent`/`BskyAgent` class has been replaced by:

- **`Client`** from `@atproto/lex` for raw XRPC calls.
- **Action functions** from `@bsky.app/sdk` for higher-level operations (preferences, records, graph, notifications).

### Record / graph sugar methods

These agent methods now correspond to named action functions called via `client.call(action, input)`:

| Old agent method                        | New action                                     | Import          |
| --------------------------------------- | ---------------------------------------------- | --------------- |
| `agent.post(input)`                     | `client.call(post, input)`                     | `@bsky.app/sdk` |
| `agent.deletePost(uri)`                 | `client.call(deletePost, uri)`                 | `@bsky.app/sdk` |
| `agent.like(uri, cid)`                  | `client.call(like, { uri, cid })`              | `@bsky.app/sdk` |
| `agent.deleteLike(uri)`                 | `client.call(deleteLike, uri)`                 | `@bsky.app/sdk` |
| `agent.repost(uri, cid)`                | `client.call(repost, { uri, cid })`            | `@bsky.app/sdk` |
| `agent.deleteRepost(uri)`               | `client.call(deleteRepost, uri)`               | `@bsky.app/sdk` |
| `agent.follow(did)`                     | `client.call(follow, { did })`                 | `@bsky.app/sdk` |
| `agent.deleteFollow(uri)`               | `client.call(deleteFollow, uri)`               | `@bsky.app/sdk` |
| `agent.upsertProfile(fn)`               | `client.call(upsertProfile, fn)`               | `@bsky.app/sdk` |
| `agent.mute(actor)`                     | `client.call(muteActor, { actor })`            | `@bsky.app/sdk` |
| `agent.unmute(actor)`                   | `client.call(unmuteActor, { actor })`          | `@bsky.app/sdk` |
| `agent.muteModList(uri)`                | `client.call(muteActorList, { list: uri })`    | `@bsky.app/sdk` |
| `agent.unmuteModList(uri)`              | `client.call(unmuteActorList, { list: uri })`  | `@bsky.app/sdk` |
| `agent.blockModList(uri)`               | `client.call(blockActorList, { list: uri })`   | `@bsky.app/sdk` |
| `agent.unblockModList(uri)`             | `client.call(unblockActorList, { list: uri })` | `@bsky.app/sdk` |
| `agent.updateSeenNotifications(seenAt)` | `client.call(updateSeenNotifications, seenAt)` | `@bsky.app/sdk` |

**Branded input types:** Unlike the old agent methods, action inputs use the lex string format types — URIs are `AtUriString`, DIDs are `DidString`, etc. Values read from API responses already carry these types; for plain strings from your own storage, validate at the boundary with `asStringFormat(v, 'at-uri')` / `asStringFormat(v, 'did')` (see § 5).

### Preferences methods

Preference reads and writes target the user's account host by default (like the client's own record helpers), regardless of the client's `service` setting — so they work unchanged on a client configured to proxy to the Bluesky API. `getPreferences` and `updatePreferences` accept an optional `service` in their input to override:

```typescript
await client.call(getPreferences) // account host
await client.call(getPreferences, { service: 'did:web:example.com#svc' })
await client.call(updatePreferences, (prefs) => prefs) // account host
await client.call(updatePreferences, {
  update: (prefs) => prefs,
  service: 'did:web:example.com#svc',
})
```

| Old agent method                                   | New action                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `agent.getPreferences()`                           | `client.call(getPreferences)`                                       |
| `agent.setAdultContentEnabled(v)`                  | `client.call(setAdultContentEnabled, v)`                            |
| `agent.setContentLabelPref(key, val, labelerDid?)` | `client.call(setContentLabelPref, { key, value: val, labelerDid })` |
| `agent.addSavedFeeds(feeds)`                       | `client.call(addSavedFeeds, feeds)`                                 |
| `agent.removeSavedFeeds(ids)`                      | `client.call(removeSavedFeeds, ids)`                                |
| `agent.updateSavedFeeds(feeds)`                    | `client.call(updateSavedFeeds, feeds)`                              |
| `agent.overwriteSavedFeeds(feeds)`                 | `client.call(overwriteSavedFeeds, feeds)`                           |
| `agent.setFeedViewPrefs(feed, prefs)`              | `client.call(setFeedViewPrefs, { feed, ...prefs })`                 |
| `agent.setThreadViewPrefs(prefs)`                  | `client.call(setThreadViewPrefs, prefs)`                            |
| `agent.setPersonalDetails({ birthDate })`          | `client.call(setPersonalDetails, { birthDate })`                    |
| `agent.setInterestsPref({ tags })`                 | `client.call(setInterestsPref, { tags })`                           |
| `agent.addMutedWord(word)`                         | `client.call(addMutedWord, word)`                                   |
| `agent.addMutedWords(words)`                       | `client.call(addMutedWords, words)`                                 |
| `agent.upsertMutedWords(words)`                    | `client.call(upsertMutedWords, words)` (deprecated)                 |
| `agent.updateMutedWord(word)`                      | `client.call(updateMutedWord, word)`                                |
| `agent.removeMutedWord(word)`                      | `client.call(removeMutedWord, word)`                                |
| `agent.removeMutedWords(words)`                    | `client.call(removeMutedWords, words)`                              |
| `agent.hidePost(uri)`                              | `client.call(hidePost, uri)`                                        |
| `agent.unhidePost(uri)`                            | `client.call(unhidePost, uri)`                                      |
| `agent.addLabeler(did)`                            | `client.call(addLabeler, did)`                                      |
| `agent.removeLabeler(did)`                         | `client.call(removeLabeler, did)`                                   |
| `agent.setVerificationPrefs(prefs)`                | `client.call(setVerificationPrefs, prefs)`                          |
| `agent.setPostInteractionSettings(s)`              | `client.call(setPostInteractionSettings, s)`                        |
| `agent.updateLiveEventPreferences(action)`         | `client.call(updateLiveEventPreferences, action)`                   |
| `agent.setIsBetaUser(v)`                           | `client.call(setIsBetaUser, v)`                                     |

### Renamed app-state preferences methods (dropped `bskyApp` prefix)

| Old agent method                             | New action                                   |
| -------------------------------------------- | -------------------------------------------- |
| `agent.bskyAppQueueNudges(nudges)`           | `client.call(queueNudges, nudges)`           |
| `agent.bskyAppDismissNudges(nudges)`         | `client.call(dismissNudges, nudges)`         |
| `agent.bskyAppSetActiveProgressGuide(guide)` | `client.call(setActiveProgressGuide, guide)` |
| `agent.bskyAppUpsertNux(nux)`                | `client.call(upsertNux, nux)`                |
| `agent.bskyAppRemoveNuxs(ids)`               | `client.call(removeNuxs, ids)`               |

### Renamed notification method

| Old agent method                         | New                                                         |
| ---------------------------------------- | ----------------------------------------------------------- |
| `agent.countUnreadNotifications(params)` | `client.call(app.bsky.notification.getUnreadCount, params)` |

### Bluesky API passthrough methods (17 total)

These agent shortcuts now map directly to `client.call(schema, params)` with the schema imported from `@bsky.app/sdk/lexicons`:

```typescript
import { app, com } from '@bsky.app/sdk/lexicons'

// feeds
await client.call(app.bsky.feed.getTimeline, { limit: 50 })
await client.call(app.bsky.feed.getAuthorFeed, { actor: 'alice.bsky.social' })
await client.call(app.bsky.feed.getActorLikes, { actor: 'alice.bsky.social' })
await client.call(app.bsky.feed.getPostThread, { uri: 'at://...' })
await client.call(app.bsky.feed.getPosts, { uris: ['at://...'] })
await client.call(app.bsky.feed.getLikes, { uri: 'at://...' })
await client.call(app.bsky.feed.getRepostedBy, { uri: 'at://...' })

// actors
await client.call(app.bsky.actor.getProfile, { actor: 'alice.bsky.social' })
await client.call(app.bsky.actor.getProfiles, { actors: ['alice.bsky.social'] })
await client.call(app.bsky.actor.getSuggestions, {})
await client.call(app.bsky.actor.searchActors, { q: 'alice' })
await client.call(app.bsky.actor.searchActorsTypeahead, { q: 'ali' })

// graph
await client.call(app.bsky.graph.getFollows, { actor: 'alice.bsky.social' })
await client.call(app.bsky.graph.getFollowers, { actor: 'alice.bsky.social' })

// notifications
await client.call(app.bsky.notification.listNotifications, {})
await client.call(app.bsky.notification.getUnreadCount, {})

// labelers
await client.call(app.bsky.labeler.getServices, { dids: ['did:plc:...'] })
```

### `getPost` recipe

The old `agent.getPost({ repo, rkey })` sugar is replaced by `client.get()` using the generated schema:

```typescript
import { app, com } from '@bsky.app/sdk/lexicons'
import { AtUri } from '@atproto/syntax'

// Old: agent.getPost({ repo: 'alice.bsky.social', rkey: '3k2...' })
// New:
const post = await client.get(app.bsky.feed.post, {
  repo: 'alice.bsky.social',
  rkey: '3k2...',
})
// Or parse from a full at:// URI:
const uri = new AtUri('at://alice.bsky.social/app.bsky.feed.post/3k2...')
const post2 = await client.get(app.bsky.feed.post, {
  repo: uri.hostname,
  rkey: uri.rkey,
})
```

---

## 4. Sessions

### Password-based sessions (replacing `CredentialSession`)

```typescript
import { Client } from '@atproto/lex'
import {
  PasswordSession,
  type SessionData,
} from '@atproto/lex-password-session'

// --- Login ---
const session = await PasswordSession.login({
  service: 'https://bsky.social',
  identifier: 'alice.bsky.social',
  password: 'xxxx-xxxx-xxxx-xxxx',
  onUpdated: (data: SessionData) => {
    // Persist tokens after login and each automatic refresh
    localStorage.setItem('session', JSON.stringify(data))
  },
  onDeleted: (data: SessionData) => {
    // Called on logout or server-side session invalidation
    localStorage.removeItem('session')
    redirectToLogin()
  },
})

const client = new Client(session)

// --- Resume a saved session ---
const saved: SessionData = JSON.parse(localStorage.getItem('session')!)
const resumed = await PasswordSession.resume(saved, {
  onUpdated: (data) => localStorage.setItem('session', JSON.stringify(data)),
  onDeleted: () => localStorage.removeItem('session'),
})
const resumedClient = new Client(resumed)

// --- Logout ---
await session.logout() // calls onDeleted, marks session as destroyed
```

Key differences from `CredentialSession`:

- No constructor; use static `PasswordSession.login()` or `PasswordSession.resume()`.
- `onUpdated` and `onDeleted` hooks replace manual `session.on('update', ...)` listeners.
- Token refresh is fully automatic; no need to call `refreshSession()`.

### OAuth

For user-facing apps, use OAuth via `@atproto/oauth-client`. The resulting session object can be passed directly to `new Client(oauthSession)`. See `@atproto/oauth-client` docs for setup.

---

## 5. String Format Types

AT Protocol uses branded string types (type aliases with a narrow shape) for values that must meet format requirements — DIDs, AT-URIs, handles, datetimes, and more. These are now available from `@atproto/lex` (which re-exports them from `@atproto/syntax` and `@atproto/lex-schema`).

### Available types and helpers

```typescript
import {
  // Types (branded strings)
  type DidString,
  type HandleString,
  type AtUriString,
  type DatetimeString,
  type NsidString,
  type RecordKeyString,
  type AtIdentifierString, // DidString | HandleString
  // Per-format as/is/assert/if helpers (via @atproto/syntax re-export)
  asDatetimeString,
  assertDatetimeString,
  isDatetimeString,
  ifDatetimeString,
  asAtUriString,
  assertAtUriString,
  isAtUriString,
  ifAtUriString,
  asAtIdentifierString,
  assertAtIdentifierString,
  isAtIdentifierString,
  ifAtIdentifierString,
  // Generic string-format helpers
  isStringFormat,
  asStringFormat,
  assertStringFormat,
  ifStringFormat,
} from '@atproto/lex'
```

### Reading vs constructing

**Reading (ingress validation at trust boundaries):** When you receive data from the network or user input, validate and narrow the type explicitly:

```typescript
import { asStringFormat, type DidString } from '@atproto/lex'

function processIncoming(rawDid: string): DidString {
  // Throws if not a valid DID; narrows to DidString
  return asStringFormat(rawDid, 'did')
}
```

**Constructing (from known-valid sources):** When you construct values from your own code or generated data, you can cast directly — generated lexicon builders (`schema.$build(...)`) already produce correctly-typed values, so no runtime validation is needed.

```typescript
import { app, com } from '@bsky.app/sdk/lexicons'

// $build ensures the type is correct at compile time
const post = app.bsky.feed.post.$build({
  text: 'Hello!',
  createdAt: new Date().toISOString(),
})
// post.$type is typed as 'app.bsky.feed.post'
```

**Per-boundary idiom:** Validate at the first point you receive external data. After that, pass the typed values through your app without re-validating:

```typescript
import { asStringFormat, asAtUriString } from '@atproto/lex'

// API route handler — validate at the boundary
function handleRepostRequest(rawActor: string, rawUri: string) {
  const actorDid = asStringFormat(rawActor, 'did')
  const postUri = asAtUriString(rawUri)
  return doRepost(actorDid, postUri) // typed throughout
}
```

**Note:** A planned helper on the lex `Client` for object-level "upcast" (e.g. asserting an entire record object matches a schema) is not yet in `@atproto/lex`. Use schema-level `$assert()` / `$matches()` / `$parse()` on generated schema objects until then:

```typescript
import { app, com } from '@bsky.app/sdk/lexicons'

const unknown: unknown = fetchedRecord
app.bsky.feed.post.$assert(unknown) // throws if not a valid post
// unknown is now typed as app.bsky.feed.post.Main
```

### Replacing old `isDid` / `asDid` etc.

The `types.ts` helpers that lived in `@atproto/api` (`isDid`, `asDid`, `assertDid`, `isAtprotoProxy`, etc.) are removed. Use the generic string-format helpers or the per-format exports from `@atproto/lex` / `@atproto/syntax`:

```typescript
// Old: isDid(value) / asDid(value)
// New:
import { isStringFormat, asStringFormat } from '@atproto/lex'
isStringFormat(value, 'did')
asStringFormat(value, 'did')
```

---

## 6. Worked End-to-End Example

Login, create three clients, post with rich text, read the timeline, and moderate a post for display:

```typescript
import { Client } from '@atproto/lex'
import {
  PasswordSession,
  type SessionData,
} from '@atproto/lex-password-session'
import { api, post } from '@bsky.app/sdk'
import { moderatePost, type ModerationOpts } from '@bsky.app/sdk/moderation'
import { RichText } from '@bsky.app/sdk/richtext'
import { app, com } from '@bsky.app/sdk/lexicons'

// --- 1. Login ---
const session = await PasswordSession.login({
  service: 'https://bsky.social',
  identifier: 'alice.bsky.social',
  password: 'xxxx-xxxx-xxxx-xxxx',
  onUpdated: (data: SessionData) => saveSession(data),
  onDeleted: () => clearSession(),
})

// --- 2. Clients ---
// No labeler configuration needed: with no labeler headers sent, the
// Bluesky API applies its own moderation service by default.
const bskyClient = new Client(session, {
  service: api.app.service,
})

const publicBskyClient = new Client(api.app.urlPublic)

// --- 3. Post with rich text ---
const rt = new RichText({ text: 'Hello @bob.bsky.social — check this out!' })
await rt.detectFacets(bskyClient) // resolves mentions via the client

// Record writes target the account host automatically
const { uri, cid } = await bskyClient.call(post, {
  text: rt.text,
  facets: rt.facets,
})
console.log('Posted:', uri, cid)

// --- 4. Read the timeline ---
const timeline = await bskyClient.call(app.bsky.feed.getTimeline, {
  limit: 20,
})

// --- 5. Moderate a post for display ---
const prefs = await bskyClient.call(app.bsky.actor.getPreferences, {})
const moderationOpts: ModerationOpts = {
  userDid: session.did,
  prefs: {
    adultContentEnabled: false,
    labels: {},
    labelers: [{ did: api.moderation.did, labels: {} }],
    mutedWords: [],
    hiddenPosts: [],
  },
}

for (const feedItem of timeline.feed) {
  const modDecision = moderatePost(feedItem.post, moderationOpts)
  const ui = modDecision.ui('contentList')
  if (ui.filter) {
    // skip filtered posts
    continue
  }
  // record is typed as LexMap; cast to the generated type if needed
  const record = feedItem.post.record as app.bsky.feed.post.Main
  console.log(record.text)
}
```
