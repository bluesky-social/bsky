import type {
  $Typed,
  AtUriString,
  DidString,
  HandleString,
  Un$Typed,
} from '@atproto/lex-schema'
import { currentDatetimeString } from '@atproto/syntax'
import type { app, com } from '../lexicons/index.js'

const FAKE_CID = 'bafyreiclp443lavogvhj3d2ob2cxbfuscni2k5jk7bebjzg7khl3esabwq'

export const mock = {
  post({
    text,
    facets,
    reply,
    embed,
  }: {
    text: string
    facets?: app.bsky.feed.post.Main['facets']
    reply?: app.bsky.feed.post.ReplyRef
    embed?: app.bsky.feed.post.Main['embed']
  }): $Typed<app.bsky.feed.post.Main> {
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
    record: app.bsky.feed.post.Main
    author: app.bsky.actor.defs.ProfileViewBasic
    embed?: app.bsky.feed.defs.PostView['embed']
    replyCount?: number
    repostCount?: number
    likeCount?: number
    viewer?: app.bsky.feed.defs.ViewerState
    labels?: com.atproto.label.defs.Label[]
  }): $Typed<app.bsky.feed.defs.PostView> {
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
    record: app.bsky.feed.post.Main
    author: app.bsky.actor.defs.ProfileViewBasic
    labels?: com.atproto.label.defs.Label[]
  }): $Typed<app.bsky.embed.record.View> {
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
    handle: string
    displayName?: string
    description?: string
    viewer?: app.bsky.actor.defs.ViewerState
    labels?: com.atproto.label.defs.Label[]
  }): app.bsky.actor.defs.ProfileViewBasic {
    return {
      did: `did:web:${handle}` as DidString,
      handle: handle as HandleString,
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
    mutedByList?: app.bsky.graph.defs.ListViewBasic
    blockedBy?: boolean
    blocking?: string
    blockingByList?: app.bsky.graph.defs.ListViewBasic
    following?: string
    followedBy?: string
  }): app.bsky.actor.defs.ViewerState {
    return {
      muted,
      mutedByList,
      blockedBy,
      blocking: blocking as AtUriString | undefined,
      blockingByList,
      following: following as AtUriString | undefined,
      followedBy: followedBy as AtUriString | undefined,
    }
  },

  listViewBasic({ name }: { name: string }): app.bsky.graph.defs.ListViewBasic {
    return {
      uri: 'at://did:plc:fake/app.bsky.graph.list/fake' as AtUriString,
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
    record: app.bsky.feed.post.Main
    author: Un$Typed<app.bsky.actor.defs.ProfileViewBasic>
    labels?: com.atproto.label.defs.Label[]
  }): app.bsky.notification.listNotifications.Notification {
    return {
      uri: `at://${author.did}/app.bsky.feed.post/fake` as AtUriString,
      cid: FAKE_CID,
      author,
      reason: 'reply',
      reasonSubject:
        `at://${author.did}/app.bsky.feed.post/fake-parent` as AtUriString,
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
    author: Un$Typed<app.bsky.actor.defs.ProfileViewBasic>
    subjectDid: string
    labels?: com.atproto.label.defs.Label[]
  }): app.bsky.notification.listNotifications.Notification {
    return {
      uri: `at://${author.did}/app.bsky.graph.follow/fake` as AtUriString,
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
    uri: string
    src?: string
  }): com.atproto.label.defs.Label {
    return {
      src: (src ||
        'did:plc:fake-labeler') as com.atproto.label.defs.Label['src'], // boundary: lex format type
      uri: uri as com.atproto.label.defs.Label['uri'], // boundary: lex format type
      val,
      cts: currentDatetimeString(),
    }
  },
}
