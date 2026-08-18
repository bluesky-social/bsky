# @bsky/sdk

Bluesky SDK built on [@atproto/lex](https://github.com/bluesky-social/atproto/tree/main/packages/lex). Provides Bluesky lexicon definitions, typed actions, moderation utilities, rich-text helpers, and string utilities.

## Install

```sh
npm install @bsky/sdk @atproto/lex
```

`@atproto/lex` provides the `Client` class that powers all API calls. `@bsky/sdk` provides the Bluesky-specific lexicons, actions, and utilities.

## Getting started

```typescript
import { Client } from '@atproto/lex'
import { PasswordSession } from '@atproto/lex-password-session'
import { post } from '@bsky/sdk'

const session = await PasswordSession.login({
  service: 'https://bsky.social',
  identifier: 'your.bsky.social', // your handle
  password: 'xxxx-xxxx-xxxx-xxxx', // an app password, generated in the Bluesky app
})
const client = new Client(session)

await client.call(post, { text: 'Hello, world!' })
```

## Usage

### Session management

You'll need an authenticated session for most API calls. There are two ways to
manage sessions:

1. [App password based session management](#app-password-based-session-management)
2. [OAuth based session management](#oauth-based-session-management)

#### App password based session management

Username / password based authentication can be performed using the
`PasswordSession` class from `@atproto/lex-password-session`.

> [!CAUTION]
>
> This method is deprecated in favor of OAuth based session management. It is
> recommended to use OAuth based session management (through the
> `@atproto/oauth-client-*` packages).

```typescript
import { Client } from '@atproto/lex'
import {
  PasswordSession,
  type SessionData,
} from '@atproto/lex-password-session'

const session = await PasswordSession.login({
  service: 'https://bsky.social',
  identifier: 'your.bsky.social', // your handle
  password: 'xxxx-xxxx-xxxx-xxxx', // an app password, generated in the Bluesky app
  onUpdated: (data: SessionData) => saveToStorage(data),
  onDeleted: (data: SessionData) => clearStorage(data.did),
})
const client = new Client(session)
console.log(`Authenticated as: ${client.assertDid}`)

// Next time, resume with the persisted session data to avoid storing
// user credentials:
const resumed = await PasswordSession.resume(loadFromStorage(), {
  onUpdated: (data: SessionData) => saveToStorage(data),
  onDeleted: (data: SessionData) => clearStorage(data.did),
})
```

#### OAuth based session management

Depending on the environment used by your application, different OAuth clients
are available:

- [@atproto/oauth-client-browser](https://www.npmjs.com/package/@atproto/oauth-client-browser):
  for the browser.
- [@atproto/oauth-client-node](https://www.npmjs.com/package/@atproto/oauth-client-node): for
  Node.js.
- [@atproto/oauth-client](https://www.npmjs.com/package/@atproto/oauth-client):
  Lower level; compatible with most JS engines.

Every `@atproto/oauth-client-*` implementation has a different way to obtain an
OAuth session instance that can be used to instantiate a `Client`. Here is an
example restoring a previously saved session:

```typescript
import { Client } from '@atproto/lex'
import { OAuthClient } from '@atproto/oauth-client'

const oauthClient = new OAuthClient({
  // ...
})

const oauthSession = await oauthClient.restore('did:plc:123')

// Instantiate the lex Client using an OAuth session
const client = new Client(oauthSession)
```

### Authenticated and public clients

Use the `api.*` constants for addressing Bluesky services:

```typescript
import { Client } from '@atproto/lex'
import { api } from '@bsky/sdk'

// Bluesky API (authenticated queries, proxied through the account host;
// record writes and mutations automatically target the account host directly)
const bskyClient = new Client(session, { service: api.app.service })

// Bluesky API (unauthenticated public queries)
const publicBskyClient = new Client(api.app.urlPublic)
```

### API calls

The SDK exports actions for many common operations. Invoke an action against a
client with `client.call(action, input)`:

```typescript
import {
  blockActor,
  blockActorList,
  deleteFollow,
  deleteLike,
  deletePost,
  deleteRepost,
  follow,
  getPreferences,
  like,
  muteActor,
  muteActorList,
  post,
  repost,
  unblockActor,
  unblockActorList,
  unmuteActor,
  unmuteActorList,
  updateSeenNotifications,
  upsertProfile,
} from '@bsky/sdk'

// The DID of the user currently authenticated (or undefined)
bskyClient.did
bskyClient.assertDid // Throws if the user is not authenticated

// Feeds and content
await bskyClient.call(post, { text: 'Hello, world!' })
await bskyClient.call(deletePost, postUri)
await bskyClient.call(like, { uri, cid })
await bskyClient.call(deleteLike, likeUri)
await bskyClient.call(repost, { uri, cid })
await bskyClient.call(deleteRepost, repostUri)

// Social graph
await bskyClient.call(follow, { did })
await bskyClient.call(deleteFollow, followUri)
await bskyClient.call(muteActor, { actor })
await bskyClient.call(unmuteActor, { actor })
await bskyClient.call(blockActor, { did })
await bskyClient.call(unblockActor, blockUri)
await bskyClient.call(muteActorList, { list })
await bskyClient.call(unmuteActorList, { list })
await bskyClient.call(blockActorList, { list })
await bskyClient.call(unblockActorList, { list })

// Actors
await bskyClient.call(upsertProfile, (existing) => ({
  ...existing,
  displayName: 'Alice',
}))

// Notifications
await bskyClient.call(updateSeenNotifications, seenAt)

// Preferences
const prefs = await bskyClient.call(getPreferences)
```

Queries without a dedicated action are one `xrpc` call away using the generated
lexicons — see [Advanced API calls](#advanced-api-calls).

### Validation and types

The lexicons include a complete types system with validation and type-guards.
For example, to validate a post record:

```typescript
import { app } from '@bsky/sdk/lexicons'

const post = { ... }
if (app.bsky.feed.post.$isTypeOf(post)) {
  // typescript now recognizes `post` may be an app.bsky.feed.post.Main
  // however -- we still need to validate it
  const res = app.bsky.feed.post.main.safeValidate(post)
  if (res.success) {
    // a valid record
  } else {
    // something is wrong
    console.log(res.error)
  }
}
```

### Rich text

Some records (ie posts) use the `app.bsky.richtext` lexicon. At the moment richtext is only used for links and mentions, but it will be extended over time to include bold, italic, and so on.

ℹ️ It is **strongly** recommended to use this package's `RichText` library. Javascript encodes strings in utf16 while the protocol (and most other programming environments) use utf8. Converting between the two is challenging, but `RichText` handles that for you.

```typescript
import { currentDatetimeString } from '@atproto/lex'
import { RichText } from '@bsky/sdk/richtext'

// creating richtext — detects mentions and links, resolving mentions to DIDs
const rt = await RichText.resolve(
  'Hello @alice.com, check out this link: https://example.com',
  { resolver: client },
)
const postRecord = {
  $type: 'app.bsky.feed.post',
  text: rt.text,
  facets: rt.facets,
  createdAt: currentDatetimeString(),
}

// rendering as markdown
let markdown = ''
for (const segment of rt.segments()) {
  if (segment.isLink()) {
    markdown += `[${segment.text}](${segment.link?.uri})`
  } else if (segment.isMention()) {
    markdown += `[${segment.text}](https://my-bsky-app.com/user/${segment.mention?.did})`
  } else {
    markdown += segment.text
  }
}

// calculating string lengths
const rt2 = new RichText({ text: 'Hello' })
console.log(rt2.length) // => 5
console.log(rt2.graphemeLength) // => 5
const rt3 = new RichText({ text: '👨‍👩‍👧‍👧' })
console.log(rt3.length) // => 25
console.log(rt3.graphemeLength) // => 1
```

### Moderation

Applying the moderation system is a challenging task, but we've done our best to simplify it for you. The Moderation API helps handle a wide range of tasks, including:

- Moderator labeling
- User muting (including mutelists)
- User blocking
- Mutewords
- Hidden posts

For more information, see the [Moderation Documentation](./docs/moderation.md).

```typescript
import { getPreferences } from '@bsky/sdk'
import { moderatePost } from '@bsky/sdk/moderation'

// First get the user's moderation prefs and their label definitions
// =

const prefs = await bskyClient.call(getPreferences)
const labelDefs = {
  /* see the Moderation Documentation for gathering labelDefs */
}

// We call the appropriate moderation function for the content
// =

const postMod = moderatePost(postView, {
  userDid: bskyClient.assertDid,
  prefs: prefs.moderationPrefs,
  labelDefs,
})

// We then use the output to decide how to affect rendering
// =

// in feeds
if (postMod.ui('contentList').filter) {
  // don't include in feeds
}
if (postMod.ui('contentList').blur) {
  // render the whole object behind a cover (use postMod.ui('contentList').blurs to explain)
  if (postMod.ui('contentList').noOverride) {
    // do not allow the cover the be removed
  }
}
if (postMod.ui('contentList').alert || postMod.ui('contentList').inform) {
  // render warnings on the post
  // find the warnings in postMod.ui('contentList').alerts and postMod.ui('contentList').informs
}

// viewed directly
if (postMod.ui('contentView').filter) {
  // don't render the view
}
if (postMod.ui('contentView').blur) {
  // render the whole object behind a cover (use postMod.ui('contentView').blurs to explain)
  if (postMod.ui('contentView').noOverride) {
    // do not allow the cover the be removed
  }
}
if (postMod.ui('contentView').alert || postMod.ui('contentView').inform) {
  // render warnings on the post
  // find the warnings in postMod.ui('contentView').alerts and postMod.ui('contentView').informs
}

// post embeds in all contexts
if (postMod.ui('contentMedia').blur) {
  // render the whole object behind a cover (use postMod.ui('contentMedia').blurs to explain)
  if (postMod.ui('contentMedia').noOverride) {
    // do not allow the cover the be removed
  }
}
```

## Advanced

### Advanced API calls

The actions above are convenience wrappers. They cover most but not all
available methods.

The AT Protocol identifies methods and records with reverse-DNS names. You can
call any of them using the generated lexicons and the client's `call` and
record helpers:

```typescript
import { currentDatetimeString } from '@atproto/lex'
import { app, com } from '@bsky/sdk/lexicons'

// Record helpers always target the user's account host
const res1 = await bskyClient.createRecord({
  $type: 'app.bsky.feed.post',
  text: 'Hello, world!',
  createdAt: currentDatetimeString(),
})
const res2 = await bskyClient.call(
  com.atproto.repo.listRecords,
  { repo: alice.did, collection: 'app.bsky.feed.post' },
  { service: null }, // target the account host rather than the Bluesky API
)
// or, using the typed record convenience helper:
const res2b = await bskyClient.list(app.bsky.feed.post, {
  repo: alice.did, // optional. Defaults to bskyClient.did (throws if unauthenticated)
})

const res3 = await bskyClient.call(app.bsky.feed.getTimeline, {
  limit: 20,
})
// res3: app.bsky.feed.getTimeline.OutputSchema
```

Namespace roots exported from `/lexicons`: `app`, `com`, `chat`.

### Bring your own fetch

If you want to provide your own `fetch` implementation — for logging, mocking,
retries, or environments without a built-in `fetch` — pass it when constructing
the `Client`:

```typescript
import { Client } from '@atproto/lex'

const myFetch: typeof globalThis.fetch = async (input, init) => {
  console.log('requesting', input)
  const response = await globalThis.fetch(input, init)
  console.log('got response', response)
  return response
}

const client = new Client({
  service: 'https://example.com',
  fetch: myFetch,
})
```

## Subpaths

| Import                 | Contents                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `@bsky/sdk`            | `api` constants, actions, `DEFAULT_LABEL_SETTINGS`                                   |
| `@bsky/sdk/lexicons`   | Generated lexicon definitions (`app`, `com`, `chat`)                                 |
| `@bsky/sdk/moderation` | `moderatePost`, `moderateProfile`, and friends; `ModerationDecision`, `ModerationUI` |
| `@bsky/sdk/richtext`   | `RichText` builder                                                                   |
| `@bsky/sdk/utils`      | Age assurance helpers, `sanitizeMutedWordValue`, nux validation                      |

## Upgrading from @atproto/api

See [skills/upgrade-from-atproto-api/SKILL.md](../../skills/upgrade-from-atproto-api/SKILL.md) for a full migration guide, including all removed APIs and their replacements.

## License

This project is dual-licensed under MIT and Apache 2.0 terms:

- MIT license ([LICENSE-MIT.txt](https://github.com/bluesky-social/atproto/blob/main/LICENSE-MIT.txt) or http://opensource.org/licenses/MIT)
- Apache License, Version 2.0, ([LICENSE-APACHE.txt](https://github.com/bluesky-social/atproto/blob/main/LICENSE-APACHE.txt) or http://www.apache.org/licenses/LICENSE-2.0)

Downstream projects and end users may chose either license individually, or both together, at their discretion. The motivation for this dual-licensing is the additional software patent assurance provided by Apache 2.0.
