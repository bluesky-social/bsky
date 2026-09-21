import type * as ActorDefs from '../../lexicons/app/bsky/actor/defs.defs.js'
import * as EmbedExternal from '../../lexicons/app/bsky/embed/external.defs.js'
import * as EmbedGallery from '../../lexicons/app/bsky/embed/gallery.defs.js'
import * as EmbedImages from '../../lexicons/app/bsky/embed/images.defs.js'
import * as EmbedRecord from '../../lexicons/app/bsky/embed/record.defs.js'
import * as EmbedRecordWithMedia from '../../lexicons/app/bsky/embed/recordWithMedia.defs.js'
import type * as FeedDefs from '../../lexicons/app/bsky/feed/defs.defs.js'
import * as FeedPost from '../../lexicons/app/bsky/feed/post.defs.js'
import { is$typedObject } from '../../utils/types.js'
import { ModerationDecision } from '../decision.js'
import { type MuteWordMatch, matchMuteWords } from '../mutewords.js'
import { type ModerationOpts, type ModerationSubjectPost } from '../types.js'
import { decideAccount } from './account.js'
import { decideProfile } from './profile.js'

export function decidePost(
  subject: ModerationSubjectPost,
  opts: ModerationOpts,
): ModerationDecision {
  return ModerationDecision.merge(
    decideSubject(subject, opts),
    decideEmbed(subject.embed, opts)?.downgrade(),
    decideAccount(subject.author, opts),
    decideProfile(subject.author, opts),
  )
}

function decideSubject(
  subject: ModerationSubjectPost,
  opts: ModerationOpts,
): ModerationDecision {
  const acc = new ModerationDecision()

  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  acc.addHidden(checkHiddenPost(subject, opts.prefs.hiddenPosts))
  if (!acc.isMe) {
    acc.addMutedWord(matchAllMuteWords(subject, opts.prefs.mutedWords))
  }

  return acc
}

function decideEmbed(embed: FeedDefs.PostView['embed'], opts: ModerationOpts) {
  if (embed) {
    if (is$typedObject(embed, EmbedRecord.view.$type)) {
      if (is$typedObject(embed.record, EmbedRecord.viewRecord.$type)) {
        // quote post
        return decideQuotedPost(embed.record, opts)
      } else if (is$typedObject(embed.record, EmbedRecord.viewBlocked.$type)) {
        // blocked quote post
        return decideBlockedQuotedPost(embed.record, opts)
      }
    } else if (is$typedObject(embed, EmbedRecordWithMedia.view.$type)) {
      if (is$typedObject(embed.record.record, EmbedRecord.viewRecord.$type)) {
        // quoted post with media
        return decideQuotedPost(embed.record.record, opts)
      } else if (
        is$typedObject(embed.record.record, EmbedRecord.viewBlocked.$type)
      ) {
        // blocked quoted post with media
        return decideBlockedQuotedPost(embed.record.record, opts)
      }
    }
  }

  return undefined
}

function decideQuotedPost(
  subject: EmbedRecord.ViewRecord,
  opts: ModerationOpts,
) {
  const acc = new ModerationDecision()
  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  return ModerationDecision.merge(
    acc,
    decideAccount(subject.author, opts),
    decideProfile(subject.author, opts),
  )
}

function decideBlockedQuotedPost(
  subject: EmbedRecord.ViewBlocked,
  opts: ModerationOpts,
) {
  const acc = new ModerationDecision()
  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.author.viewer?.muted) {
    if (subject.author.viewer?.mutedByList) {
      acc.addMutedByList(subject.author.viewer?.mutedByList)
    } else {
      acc.addMuted(subject.author.viewer?.muted)
    }
  }
  if (subject.author.viewer?.blocking) {
    if (subject.author.viewer?.blockingByList) {
      acc.addBlockingByList(subject.author.viewer?.blockingByList)
    } else {
      acc.addBlocking(subject.author.viewer?.blocking)
    }
  }
  acc.addBlockedBy(subject.author.viewer?.blockedBy)
  return acc
}

function checkHiddenPost(
  subject: ModerationSubjectPost,
  hiddenPosts: string[] | undefined,
) {
  if (!hiddenPosts?.length) {
    return false
  }
  if (hiddenPosts.includes(subject.uri)) {
    return true
  }
  if (subject.embed) {
    if (
      is$typedObject(subject.embed, EmbedRecord.view.$type) &&
      is$typedObject(subject.embed.record, EmbedRecord.viewRecord.$type) &&
      hiddenPosts.includes(subject.embed.record.uri)
    ) {
      return true
    }
    if (
      is$typedObject(subject.embed, EmbedRecordWithMedia.view.$type) &&
      is$typedObject(
        subject.embed.record.record,
        EmbedRecord.viewRecord.$type,
      ) &&
      hiddenPosts.includes(subject.embed.record.record.uri)
    ) {
      return true
    }
  }
  return false
}

function matchAllMuteWords(
  subject: ModerationSubjectPost,
  mutedWords: ActorDefs.MutedWord[] | undefined,
): MuteWordMatch[] | undefined {
  if (!mutedWords?.length) {
    return
  }

  const postAuthor = subject.author

  // $isTypeOf only checks $type; PostView['record'] is an untyped LexMap, so
  // one boundary cast here (like the old AppBskyFeedPost.isRecord semantics).
  const subjectPost = FeedPost.$isTypeOf(subject.record)
    ? (subject.record as FeedPost.Main)
    : undefined

  if (subjectPost) {
    const post = subjectPost

    const matches = matchMuteWords({
      mutedWords,
      text: post.text,
      facets: post.facets,
      outlineTags: post.tags,
      languages: post.langs,
      actor: postAuthor,
    })
    // post text
    if (matches) {
      return matches
    }

    if (post.embed && is$typedObject(post.embed, EmbedImages.main.$type)) {
      // post images
      for (const image of post.embed.images) {
        const matches = matchMuteWords({
          mutedWords,
          text: image.alt,
          languages: post.langs,
          actor: postAuthor,
        })
        if (matches) {
          return matches
        }
      }
    }

    if (post.embed && is$typedObject(post.embed, EmbedGallery.main.$type)) {
      // post gallery items
      for (const item of post.embed.items) {
        if (is$typedObject(item, EmbedGallery.image.$type)) {
          const matches = matchMuteWords({
            mutedWords,
            text: item.alt,
            languages: post.langs,
            actor: postAuthor,
          })
          if (matches) {
            return matches
          }
        }
      }
    }
  }

  const { embed } = subject
  if (embed) {
    // quote post
    if (
      is$typedObject(embed, EmbedRecord.view.$type) &&
      is$typedObject(embed.record, EmbedRecord.viewRecord.$type)
    ) {
      if (FeedPost.$isTypeOf(embed.record.value)) {
        const embeddedPost = embed.record.value as FeedPost.Main
        const embedAuthor = embed.record.author
        const matches = matchMuteWords({
          mutedWords,
          text: embeddedPost.text,
          facets: embeddedPost.facets,
          outlineTags: embeddedPost.tags,
          languages: embeddedPost.langs,
          actor: embedAuthor,
        })

        // quoted post text
        if (matches) {
          return matches
        }

        // quoted post's images
        if (
          embeddedPost.embed &&
          is$typedObject(embeddedPost.embed, EmbedImages.main.$type)
        ) {
          for (const image of embeddedPost.embed.images) {
            const matches = matchMuteWords({
              mutedWords,
              text: image.alt,
              languages: embeddedPost.langs,
              actor: embedAuthor,
            })
            if (matches) {
              return matches
            }
          }
        }

        // quoted post's gallery
        if (
          embeddedPost.embed &&
          is$typedObject(embeddedPost.embed, EmbedGallery.main.$type)
        ) {
          for (const item of embeddedPost.embed.items) {
            if (is$typedObject(item, EmbedGallery.image.$type)) {
              const matches = matchMuteWords({
                mutedWords,
                text: item.alt,
                languages: embeddedPost.langs,
                actor: embedAuthor,
              })
              if (matches) {
                return matches
              }
            }
          }
        }

        // quoted post's link card
        if (
          embeddedPost.embed &&
          is$typedObject(embeddedPost.embed, EmbedExternal.main.$type)
        ) {
          const { external } = embeddedPost.embed
          const matches = matchMuteWords({
            mutedWords,
            text: external.title + ' ' + external.description,
            languages: [],
            actor: embedAuthor,
          })
          if (matches) {
            return matches
          }
        }

        if (
          embeddedPost.embed &&
          is$typedObject(embeddedPost.embed, EmbedRecordWithMedia.main.$type)
        ) {
          // quoted post's link card when it did a quote + media
          if (
            is$typedObject(embeddedPost.embed.media, EmbedExternal.main.$type)
          ) {
            const { external } = embeddedPost.embed.media
            const matches = matchMuteWords({
              mutedWords,
              text: external.title + ' ' + external.description,
              languages: [],
              actor: embedAuthor,
            })
            if (matches) {
              return matches
            }
          }

          // quoted post's images when it did a quote + media
          if (
            is$typedObject(embeddedPost.embed.media, EmbedImages.main.$type)
          ) {
            for (const image of embeddedPost.embed.media.images) {
              const matches = matchMuteWords({
                mutedWords,
                text: image.alt,
                // NOTE: preserves a latent quirk of the original implementation, which never
                // populated languages here; fixing this changes muteword matching behavior
                // and should be its own change.
                languages: [],
                actor: embedAuthor,
              })
              if (matches) {
                return matches
              }
            }
          }

          // quoted post's gallery when it did a quote + media
          if (
            is$typedObject(embeddedPost.embed.media, EmbedGallery.main.$type)
          ) {
            for (const item of embeddedPost.embed.media.items) {
              if (is$typedObject(item, EmbedGallery.image.$type)) {
                const matches = matchMuteWords({
                  mutedWords,
                  text: item.alt,
                  // NOTE: preserves a latent quirk of the original implementation, which never
                  // populated languages here; fixing this changes muteword matching behavior
                  // and should be its own change.
                  languages: [],
                  actor: embedAuthor,
                })
                if (matches) {
                  return matches
                }
              }
            }
          }
        }
      }
    }
    // link card
    else if (is$typedObject(embed, EmbedExternal.view.$type)) {
      const { external } = embed
      const matches = matchMuteWords({
        mutedWords,
        text: external.title + ' ' + external.description,
        languages: [],
        actor: postAuthor,
      })
      if (matches) {
        return matches
      }
    }
    // quote post with media
    else if (
      is$typedObject(embed, EmbedRecordWithMedia.view.$type) &&
      is$typedObject(embed.record.record, EmbedRecord.viewRecord.$type)
    ) {
      const embedAuthor = embed.record.record.author

      // quoted post text
      if (FeedPost.$isTypeOf(embed.record.record.value)) {
        const post = embed.record.record.value as FeedPost.Main
        const matches = matchMuteWords({
          mutedWords,
          text: post.text,
          facets: post.facets,
          outlineTags: post.tags,
          languages: post.langs,
          actor: embedAuthor,
        })
        if (matches) {
          return matches
        }
      }

      // quoted post images
      if (is$typedObject(embed.media, EmbedImages.view.$type)) {
        for (const image of embed.media.images) {
          const matches = matchMuteWords({
            mutedWords,
            text: image.alt,
            languages: subjectPost ? subjectPost.langs : [],
            actor: embedAuthor,
          })
          if (matches) {
            return matches
          }
        }
      }

      // quoted post gallery
      if (is$typedObject(embed.media, EmbedGallery.view.$type)) {
        for (const item of embed.media.items) {
          if (is$typedObject(item, EmbedGallery.viewImage.$type)) {
            const matches = matchMuteWords({
              mutedWords,
              text: item.alt,
              languages: subjectPost ? subjectPost.langs : [],
              actor: embedAuthor,
            })
            if (matches) {
              return matches
            }
          }
        }
      }

      if (is$typedObject(embed.media, EmbedExternal.view.$type)) {
        const { external } = embed.media
        const matches = matchMuteWords({
          mutedWords,
          text: external.title + ' ' + external.description,
          languages: [],
          actor: embedAuthor,
        })
        if (matches) {
          return matches
        }
      }
    }
  }
}
