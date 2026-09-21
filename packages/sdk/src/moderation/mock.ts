import type { $Typed, AtUriString, HandleString, Un$Typed } from '@atproto/lex'
import { currentDatetimeString } from '@atproto/syntax'
import type {
  ProfileViewBasic,
  ViewerState as ActorViewerState,
} from '../lexicons/app/bsky/actor/defs.defs.js'
import type { View as EmbedRecordView } from '../lexicons/app/bsky/embed/record.defs.js'
import type {
  PostView,
  ViewerState as FeedViewerState,
} from '../lexicons/app/bsky/feed/defs.defs.js'
import type {
  Main as PostRecord,
  ReplyRef,
} from '../lexicons/app/bsky/feed/post.defs.js'
import type { ListViewBasic } from '../lexicons/app/bsky/graph/defs.defs.js'
import type { Notification } from '../lexicons/app/bsky/notification/listNotifications.defs.js'
import type { Label } from '../lexicons/com/atproto/label/defs.defs.js'

const FAKE_CID = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'

export const mock = {
  post({
    text,
    facets,
    reply,
    embed,
  }: {
    text: string
    facets?: PostRecord['facets']
    reply?: ReplyRef
    embed?: PostRecord['embed']
  }): $Typed<PostRecord> {
    return {
      $type: 'app.bsky.feed.post',
      text,
      facets,
      reply,
      embed,
      langs: ['en'],
      createdAt: currentDatetimeString(),
    }
  },

  postView({
    record,
    author,
    embed,
    replyCount,
    repostCount,
    likeCount,
    viewer,
    labels,
  }: {
    record: PostRecord
    author: ProfileViewBasic
    embed?: PostView['embed']
    replyCount?: number
    repostCount?: number
    likeCount?: number
    viewer?: FeedViewerState
    labels?: Label[]
  }): $Typed<PostView> {
    return {
      $type: 'app.bsky.feed.defs#postView',
      uri: `at://${author.did}/app.bsky.feed.post/fake`,
      cid: FAKE_CID,
      author,
      record,
      embed,
      replyCount,
      repostCount,
      likeCount,
      indexedAt: currentDatetimeString(),
      viewer,
      labels,
    }
  },

  embedRecordView({
    record,
    author,
    labels,
  }: {
    record: PostRecord
    author: ProfileViewBasic
    labels?: Label[]
  }): $Typed<EmbedRecordView> {
    return {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: `at://${author.did}/app.bsky.feed.post/fake`,
        cid: FAKE_CID,
        author,
        value: record,
        labels,
        indexedAt: currentDatetimeString(),
      },
    }
  },

  profileViewBasic({
    handle,
    displayName,
    description,
    viewer,
    labels,
  }: {
    handle: HandleString
    displayName?: string
    description?: string
    viewer?: ActorViewerState
    labels?: Label[]
  }): ProfileViewBasic {
    return {
      did: `did:web:${handle}`,
      handle,
      displayName,
      // @ts-expect-error technically not in ProfileViewBasic but useful in some cases
      description,
      viewer,
      labels,
    }
  },

  actorViewerState({
    muted,
    mutedByList,
    blockedBy,
    blocking,
    blockingByList,
    following,
    followedBy,
  }: {
    muted?: boolean
    mutedByList?: ListViewBasic
    blockedBy?: boolean
    blocking?: AtUriString
    blockingByList?: ListViewBasic
    following?: AtUriString
    followedBy?: AtUriString
  }): ActorViewerState {
    return {
      muted,
      mutedByList,
      blockedBy,
      blocking,
      blockingByList,
      following,
      followedBy,
    }
  },

  listViewBasic({ name }: { name: string }): ListViewBasic {
    return {
      uri: 'at://did:plc:fake/app.bsky.graph.list/fake',
      cid: FAKE_CID,
      name,
      purpose: 'app.bsky.graph.defs#modlist',
      indexedAt: currentDatetimeString(),
    }
  },

  replyNotification({
    author,
    record,
    labels,
  }: {
    record: PostRecord
    author: Un$Typed<ProfileViewBasic>
    labels?: Label[]
  }): Notification {
    return {
      uri: `at://${author.did}/app.bsky.feed.post/fake`,
      cid: FAKE_CID,
      author,
      reason: 'reply',
      reasonSubject: `at://${author.did}/app.bsky.feed.post/fake-parent`,
      record,
      isRead: false,
      indexedAt: currentDatetimeString(),
      labels,
    }
  },

  followNotification({
    author,
    subjectDid,
    labels,
  }: {
    author: Un$Typed<ProfileViewBasic>
    subjectDid: string
    labels?: Label[]
  }): Notification {
    return {
      uri: `at://${author.did}/app.bsky.graph.follow/fake`,
      cid: FAKE_CID,
      author,
      reason: 'follow',
      record: {
        $type: 'app.bsky.graph.follow',
        createdAt: currentDatetimeString(),
        subject: subjectDid,
      },
      isRead: false,
      indexedAt: currentDatetimeString(),
      labels,
    }
  },

  label({
    val,
    uri,
    src,
  }: {
    val: string
    uri: Label['uri']
    src?: Label['src']
  }): Label {
    return {
      src: src || 'did:plc:fake-labeler',
      uri,
      val,
      cts: currentDatetimeString(),
    }
  },
}
