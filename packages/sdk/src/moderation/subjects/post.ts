import { app } from '../../lexicons/index.js'
import { ModerationDecision } from '../decision.js'
import { MuteWordMatch, matchMuteWords } from '../mutewords.js'
import { ModerationOpts, ModerationSubjectPost } from '../types.js'
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

function decideEmbed(
  embed: app.bsky.feed.defs.PostView['embed'],
  opts: ModerationOpts,
) {
  if (embed) {
    if (app.bsky.embed.record.view.isTypeOf(embed)) {
      if (app.bsky.embed.record.viewRecord.isTypeOf(embed.record)) {
        // quote post
        return decideQuotedPost(embed.record, opts)
      } else if (app.bsky.embed.record.viewBlocked.isTypeOf(embed.record)) {
        // blocked quote post
        return decideBlockedQuotedPost(embed.record, opts)
      }
    } else if (app.bsky.embed.recordWithMedia.view.isTypeOf(embed)) {
      if (app.bsky.embed.record.viewRecord.isTypeOf(embed.record.record)) {
        // quoted post with media
        return decideQuotedPost(embed.record.record, opts)
      } else if (
        app.bsky.embed.record.viewBlocked.isTypeOf(embed.record.record)
      ) {
        // blocked quoted post with media
        return decideBlockedQuotedPost(embed.record.record, opts)
      }
    }
  }

  return undefined
}

function decideQuotedPost(
  subject: app.bsky.embed.record.ViewRecord,
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
  subject: app.bsky.embed.record.ViewBlocked,
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
      app.bsky.embed.record.view.isTypeOf(subject.embed) &&
      app.bsky.embed.record.viewRecord.isTypeOf(subject.embed.record) &&
      hiddenPosts.includes(subject.embed.record.uri)
    ) {
      return true
    }
    if (
      app.bsky.embed.recordWithMedia.view.isTypeOf(subject.embed) &&
      app.bsky.embed.record.viewRecord.isTypeOf(subject.embed.record.record) &&
      hiddenPosts.includes(subject.embed.record.record.uri)
    ) {
      return true
    }
  }
  return false
}

function matchAllMuteWords(
  subject: ModerationSubjectPost,
  mutedWords: app.bsky.actor.defs.MutedWord[] | undefined,
): MuteWordMatch[] | undefined {
  if (!mutedWords?.length) {
    return
  }

  const postAuthor = subject.author

  // $isTypeOf only checks $type; PostView['record'] is an untyped LexMap, so
  // one boundary cast here (like the old AppBskyFeedPost.isRecord semantics).
  const subjectPost = app.bsky.feed.post.$isTypeOf(subject.record)
    ? (subject.record as app.bsky.feed.post.Main)
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

    if (post.embed && app.bsky.embed.images.$isTypeOf(post.embed)) {
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

    if (post.embed && app.bsky.embed.gallery.$isTypeOf(post.embed)) {
      // post gallery items
      for (const item of post.embed.items) {
        if (app.bsky.embed.gallery.image.isTypeOf(item)) {
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
      app.bsky.embed.record.view.isTypeOf(embed) &&
      app.bsky.embed.record.viewRecord.isTypeOf(embed.record)
    ) {
      if (app.bsky.feed.post.$isTypeOf(embed.record.value)) {
        const embeddedPost = embed.record.value as app.bsky.feed.post.Main
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
          app.bsky.embed.images.$isTypeOf(embeddedPost.embed)
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
          app.bsky.embed.gallery.$isTypeOf(embeddedPost.embed)
        ) {
          for (const item of embeddedPost.embed.items) {
            if (app.bsky.embed.gallery.image.isTypeOf(item)) {
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
          app.bsky.embed.external.$isTypeOf(embeddedPost.embed)
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
          app.bsky.embed.recordWithMedia.$isTypeOf(embeddedPost.embed)
        ) {
          // quoted post's link card when it did a quote + media
          if (app.bsky.embed.external.$isTypeOf(embeddedPost.embed.media)) {
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
          if (app.bsky.embed.images.$isTypeOf(embeddedPost.embed.media)) {
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
          if (app.bsky.embed.gallery.$isTypeOf(embeddedPost.embed.media)) {
            for (const item of embeddedPost.embed.media.items) {
              if (app.bsky.embed.gallery.image.isTypeOf(item)) {
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
    else if (app.bsky.embed.external.view.isTypeOf(embed)) {
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
      app.bsky.embed.recordWithMedia.view.isTypeOf(embed) &&
      app.bsky.embed.record.viewRecord.isTypeOf(embed.record.record)
    ) {
      const embedAuthor = embed.record.record.author

      // quoted post text
      if (app.bsky.feed.post.$isTypeOf(embed.record.record.value)) {
        const post = embed.record.record.value as app.bsky.feed.post.Main
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
      if (app.bsky.embed.images.view.isTypeOf(embed.media)) {
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
      if (app.bsky.embed.gallery.view.isTypeOf(embed.media)) {
        for (const item of embed.media.items) {
          if (app.bsky.embed.gallery.viewImage.isTypeOf(item)) {
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

      if (app.bsky.embed.external.view.isTypeOf(embed.media)) {
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
