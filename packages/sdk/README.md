# @bsky.app/sdk

Bluesky SDK built on [@atproto/lex](https://github.com/bluesky-social/atproto/tree/main/packages/lex). Provides Bluesky lexicon definitions, typed actions, moderation utilities, rich-text helpers, and string utilities.

## Install

```sh
npm install @bsky.app/sdk @atproto/lex
```

`@atproto/lex` provides the `Client` class that powers all API calls. `@bsky.app/sdk` provides the Bluesky-specific lexicons, actions, and utilities.

## Quick start: three-client pattern

Bluesky exposes three services. Use `api.*` constants for addressing:

```typescript
import { Client } from '@atproto/lex'
import { api } from '@bsky.app/sdk'

// PDS (writes, record mutations — requires an authenticated session)
const pdsClient = new Client(session)

// App view (authenticated queries proxied through the PDS)
const appviewClient = new Client(pds, { service: api.app.service })

// App view (unauthenticated public queries)
const publicClient = new Client(api.app.urlPublic)
```

## Actions

Actions are typed helpers that wrap common Bluesky operations:

```typescript
import { post } from '@bsky.app/sdk'

// client.call(action, input) invokes an action against that client
const result = await pdsClient.call(post, {
  text: 'Hello from @bsky.app/sdk!',
  langs: ['en'],
})
// result: { uri: string; cid: string }
```

Other exported actions: `deletePost`, `like`, `deleteLike`, `repost`, `deleteRepost`, `follow`, `deleteFollow`, `blockActorList`, `unblockActorList`, `muteActor`, `unmuteActor`, `muteActorList`, `unmuteActorList`, `upsertProfile`, `updateSeenNotifications`, `getPreferences`, `updatePreferences`.

## Lexicons

Generated lexicon definitions are available from the `/lexicons` subpath. Use them to call any AT Protocol method directly:

```typescript
import { Client } from '@atproto/lex'
import { app } from '@bsky.app/sdk/lexicons'

const publicClient = new Client('https://public.api.bsky.app')

const { body } = await publicClient.xrpc(app.bsky.feed.getTimeline.main, {
  params: { limit: 20 },
})
// body: app.bsky.feed.getTimeline.OutputSchema
```

Namespace roots exported from `/lexicons`: `app`, `com`, `chat`, `tools`.

## Moderation

```typescript
import { moderatePost, type ModerationOpts } from '@bsky.app/sdk/moderation'

const opts: ModerationOpts = {
  userDid: 'did:plc:...',
  prefs: {
    adultContentEnabled: false,
    labels: { porn: 'hide' },
    labelers: [],
    mutedWords: [],
    hiddenPosts: [],
  },
}

const decision = moderatePost(postView, opts)

if (decision.ui('contentList').filter) {
  // omit from feed
}
if (decision.ui('contentList').blur) {
  // show behind a content warning
}
```

## Subpaths

| Import                     | Contents                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `@bsky.app/sdk`            | `api` constants, actions, `DEFAULT_LABEL_SETTINGS`                                   |
| `@bsky.app/sdk/lexicons`   | Generated lexicon definitions (`app`, `com`, `chat`, `tools`)                        |
| `@bsky.app/sdk/moderation` | `moderatePost`, `moderateProfile`, and friends; `ModerationDecision`, `ModerationUI` |
| `@bsky.app/sdk/richtext`   | `RichText` builder                                                                   |
| `@bsky.app/sdk/utils`      | Age assurance helpers, `sanitizeMutedWordValue`, nux validation                      |

## Upgrading from @atproto/api

See [skills/upgrade-from-atproto-api/SKILL.md](../../skills/upgrade-from-atproto-api/SKILL.md) for a full migration guide, including all removed APIs and their replacements.

## License

MIT
