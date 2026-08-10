# Moderation API

Applying the moderation system is a challenging task, but we've done our best to simplify it for you. The Moderation API helps handle a wide range of tasks, including:

- Moderator labeling
- User muting (including mutelists)
- User blocking
- Mutewords
- Hidden posts

## Configuration

Every moderation function takes a set of options which look like this:

```typescript
{
  // the logged-in user's DID
  userDid: 'did:plc:1234...',

  prefs: {
    // is adult content allowed?
    adultContentEnabled: true,

    // the global label settings (used on self-labels)
    labels: {
      porn: 'hide',
      sexual: 'warn',
      nudity: 'ignore',
      // ...
    },

    // the subscribed labelers and their label settings
    labelers: [
      {
        did: 'did:plc:1234...',
        labels: {
          porn: 'hide',
          sexual: 'warn',
          nudity: 'ignore',
          // ...
        }
      }
    ],

    mutedWords: [/* ... */],
    hiddenPosts: [/* ... */]
  },

  // custom label definitions
  labelDefs: {
    // labelerDid => defs[]
    'did:plc:1234...': [
      /* ... */
    ]
  }
}
```

This should match the following interfaces:

```typescript
export interface ModerationPrefsLabeler {
  did: DidString
  labels: Record<string, LabelPreference>
}

export interface ModerationPrefs {
  adultContentEnabled: boolean
  labels: Record<string, LabelPreference>
  labelers: ModerationPrefsLabeler[]
  mutedWords: app.bsky.actor.defs.MutedWord[]
  hiddenPosts: AtUriString[]
}

export interface ModerationOpts {
  userDid: DidString | undefined
  prefs: ModerationPrefs
  /**
   * Map of labeler did -> custom definitions
   */
  labelDefs?: Record<string, InterpretedLabelValueDefinition[]>
}
```

You can quickly grab the `ModerationPrefs` using the `getPreferences` action:

```typescript
import { getPreferences } from '@bsky/sdk'
import { moderatePost } from '@bsky/sdk/moderation'

const prefs = await client.call(getPreferences)
moderatePost(post, {
  userDid: /*...*/,
  prefs: prefs.moderationPrefs,
  labelDefs: /*...*/
})
```

To gather the label definitions (`labelDefs`) see the _Labelers_ section below.

## Labelers

Labelers are services that provide moderation labels. Your application will typically have 1+ top-level labelers set with the ability to do "takedowns" on content. This is controlled via the `appLabelers` client option. When no labeler headers are sent at all, the Bluesky API applies its own moderation service by default — so this only needs to be set when introducing other labelers:

```typescript
import { Client } from '@atproto/lex'

const client = new Client(session, {
  appLabelers: ['did:web:my-labeler.com'],
})
```

(`Client.configure({ appLabelers })` sets the same thing globally for all client instances; prefer the per-client option.)

Users may also add their own labelers. The active labelers are controlled via an HTTP header which is set by the client from its labelers configuration (`client.setLabelers()`, `client.addLabelers()`). Use the `addLabeler`/`removeLabeler` actions to persist a user's labeler subscriptions in their preferences.

Labelers publish a `app.bsky.labeler.service` record that looks like this:

```js
{
  $type: 'app.bsky.labeler.service',
  policies: {
    // the list of label values the labeler will publish
    labelValues: [
      'rude',
    ],
    // any custom definitions the labeler will be using
    labelValueDefinitions: [
      {
        identifier: 'rude',
        blurs: 'content',
        severity: 'alert',
        defaultSetting: 'warn',
        adultOnly: false,
        locales: [
          {
            lang: 'en',
            name: 'Rude',
            description: 'Not keeping things civil.',
          },
        ],
      },
    ],
  },
  createdAt: '2024-03-12T17:17:17.215Z'
}
```

The label value definitions are custom labels which only apply to that labeler. Your client needs to sync those definitions in order to correctly interpret them. To do that, call `app.bsky.labeler.getServices` with `detailed: true` periodically to fetch their definitions. We recommend caching the response (at time of our writing the official client uses a TTL of 6 hours).

Here is how to do this:

```typescript
import { Client } from '@atproto/lex'
import { getPreferences } from '@bsky/sdk'
import { app } from '@bsky/sdk/lexicons'
import {
  type InterpretedLabelValueDefinition,
  interpretLabelValueDefinitions,
  moderatePost,
} from '@bsky/sdk/moderation'

// assume `client` is backed by a signed-in session
const prefs = await client.call(getPreferences)

const services = await client.call(app.bsky.labeler.getServices, {
  dids: prefs.moderationPrefs.labelers.map((labeler) => labeler.did),
  detailed: true,
})

const labelDefs: Record<string, InterpretedLabelValueDefinition[]> = {}
for (const view of services.views) {
  if (app.bsky.labeler.defs.labelerViewDetailed.isTypeOf(view)) {
    labelDefs[view.creator.did] = interpretLabelValueDefinitions(view)
  }
}

moderatePost(post, {
  userDid: client.assertDid,
  prefs: prefs.moderationPrefs,
  labelDefs,
})
```

## The `moderate*()` APIs

The SDK exports methods to moderate the different kinds of content on the network.

```typescript
import {
  moderateProfile,
  moderatePost,
  moderateNotification,
  moderateFeedGenerator,
  moderateUserList,
  moderateStatus,
} from '@bsky/sdk/moderation'
```

Each of these follows the same API signature:

```typescript
const res = moderatePost(post, moderationOptions)
```

The response object provides an API for figuring out what your UI should do in different contexts.

```typescript
res.ui(context) /* =>

ModerationUI {
  filter: boolean // should the content be removed from the interface?
  blur: boolean // should the content be put behind a cover?
  alert: boolean // should an alert be put on the content? (negative)
  inform: boolean // should an informational notice be put on the content? (neutral)
  noOverride: boolean // if blur=true, should the UI disable opening the cover?

  // the reasons for each of the flags:
  filters: ModerationCause[]
  blurs: ModerationCause[]
  alerts: ModerationCause[]
  informs: ModerationCause[]
}
*/
```

There are multiple UI contexts available:

- `profileList` A profile being listed, eg in search or a follower list
- `profileView` A profile being viewed directly
- `avatar` The user's avatar in any context
- `banner` The user's banner in any context
- `displayName` The user's display name in any context
- `contentList` Content being listed, eg posts in a feed, posts as replies, a user list list, a feed generator list, etc
- `contentView` Content being viewed direct, eg an opened post, the user list page, the feedgen page, etc
- `contentMedia ` Media inside the content, eg a picture embedded in a post

Here's how a post in a feed would use these tools to make a decision:

```typescript
const mod = moderatePost(post, moderationOptions)

if (mod.ui('contentList').filter) {
  // dont show the post
}
if (mod.ui('contentList').blur) {
  // cover the post with the explanation from mod.ui('contentList').blurs[0]
  if (mod.ui('contentList').noOverride) {
    // dont allow the cover to be removed
  }
}
if (mod.ui('contentMedia').blur) {
  // cover the post's embedded images with the explanation from mod.ui('contentMedia').blurs[0]
  if (mod.ui('contentMedia').noOverride) {
    // dont allow the cover to be removed
  }
}
if (mod.ui('avatar').blur) {
  // cover the avatar with the explanation from mod.ui('avatar').blurs[0]
  if (mod.ui('avatar').noOverride) {
    // dont allow the cover to be removed
  }
}
for (const alert of mod.ui('contentList').alerts) {
  // render this alert
}
for (const inform of mod.ui('contentList').informs) {
  // render this inform
}
```

## Sending moderation reports

Any Labeler is capable of receiving moderation reports. As a result, you need to specify which labeler should receive the report. You do this with the `service` option (the `atproto-proxy` header), overridable per request:

```typescript
import { com } from '@bsky/sdk/lexicons'

await client.call(
  com.atproto.moderation.createReport,
  {
    reasonType: com.atproto.moderation.defs.reasonViolation.$token,
    reason: 'They were being such a jerk to me!',
    subject: com.atproto.admin.defs.repoRef.$build({
      did: 'did:web:bob.com',
    }),
  },
  { service: 'did:web:my-labeler.com#atproto_labeler' },
)
```

The Bluesky moderation service's address is available via the `api` export from the SDK:

```typescript
import { api } from '@bsky/sdk'

await client.call(com.atproto.moderation.createReport, report, {
  service: api.moderation.service, // did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler
})
```
