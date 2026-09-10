import { currentDatetimeString } from '@atproto/syntax'
import { app } from '../lexicons/index.js'
import { is$typedObject } from '../utils/types.js'

const REGEX = {
  LEADING_TRAILING_PUNCTUATION: /(?:^\p{P}+|\p{P}+$)/gu,
  PUNCTUATION_OR_SPACE: /[\s\p{P}]/u,
  PUNCTUATION: /\p{P}+/u,
  PUNCTUATION_GLOBAL: /\p{P}+/gu,
  SPACE: /\s/gu,
  WORD_BOUNDARY: /[\s\n\t\r\f\v]+?/g,
}

/**
 * List of 2-letter lang codes for languages that either don't use spaces, or
 * don't use spaces in a way conducive to word-based filtering.
 *
 * For these, we use a simple `String.includes` to check for a match.
 */
const LANGUAGE_EXCEPTIONS = [
  'ja', // Japanese
  'zh', // Chinese
  'ko', // Korean
  'th', // Thai
  'vi', // Vietnamese
]

export type MuteWordMatch = {
  /**
   * The `app.bsky.actor.defs.MutedWord` that matched.
   */
  word: app.bsky.actor.defs.MutedWord
  /**
   * The string that matched the muted word.
   */
  predicate: string
}

export type Params = {
  mutedWords: app.bsky.actor.defs.MutedWord[]
  text: string
  facets?: app.bsky.richtext.facet.Main[]
  outlineTags?: string[]
  languages?: string[]
  actor?: app.bsky.actor.defs.ProfileView | app.bsky.actor.defs.ProfileViewBasic
}

/**
 * Checks if the given text matches any of the muted words, returning an array
 * of matches. If no matches are found, returns `undefined`.
 */
export function matchMuteWords({
  mutedWords,
  text,
  facets,
  outlineTags,
  languages,
  actor,
}: Params): MuteWordMatch[] | undefined {
  if (!mutedWords.length) return undefined

  const postText = text.toLowerCase()
  const exception = LANGUAGE_EXCEPTIONS.includes(languages?.[0] || '')
  const tags = ([] as string[])
    .concat(outlineTags || [])
    .concat(
      (facets || []).flatMap((facet) =>
        facet.features
          .filter((f) => is$typedObject(f, app.bsky.richtext.facet.tag.$type))
          .map((tag) => tag.tag),
      ),
    )
    .map((t) => t.toLowerCase())

  const matches: MuteWordMatch[] = []
  // Prepare the text only when needed, and reuse each word's punctuation
  // variants across muted words. Keep this local to the current post.
  let words: string[] | undefined
  const wordCache: {
    trimmed: string
    punctuationVariants?: string[] | null
  }[] = []

  outer: for (const muteWord of mutedWords) {
    const mutedWord = muteWord.value.toLowerCase()

    // expired, ignore
    if (muteWord.expiresAt && muteWord.expiresAt < currentDatetimeString())
      continue

    if (
      muteWord.actorTarget === 'exclude-following' &&
      Boolean(actor?.viewer?.following)
    )
      continue

    // `content` applies to tags as well
    if (tags.includes(mutedWord)) {
      matches.push({ word: muteWord, predicate: muteWord.value })
      continue
    }
    // rest of the checks are for `content` only
    if (!muteWord.targets.includes('content')) continue
    // single character or other exception, has to use includes
    if ((mutedWord.length === 1 || exception) && postText.includes(mutedWord)) {
      matches.push({ word: muteWord, predicate: muteWord.value })
      continue
    }
    // too long
    if (mutedWord.length > postText.length) continue
    // exact match
    if (mutedWord === postText) {
      matches.push({ word: muteWord, predicate: muteWord.value })
      continue
    }
    // any muted phrase with space or punctuation
    if (
      REGEX.PUNCTUATION_OR_SPACE.test(mutedWord) &&
      postText.includes(mutedWord)
    ) {
      matches.push({ word: muteWord, predicate: muteWord.value })
      continue
    }

    // check individual character groups
    words ??= postText.split(REGEX.WORD_BOUNDARY)
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      if (word === mutedWord) {
        matches.push({ word: muteWord, predicate: word })
        continue outer
      }

      // compare word without leading/trailing punctuation, but allow internal
      // punctuation (such as `s@ssy`)
      const entry = (wordCache[i] ??= {
        trimmed: word.replace(REGEX.LEADING_TRAILING_PUNCTUATION, ''),
      })
      const wordTrimmedPunctuation = entry.trimmed

      if (mutedWord === wordTrimmedPunctuation) {
        matches.push({ word: muteWord, predicate: word })
        continue outer
      }

      if (mutedWord.length > wordTrimmedPunctuation.length) continue

      if (entry.punctuationVariants === undefined) {
        if (REGEX.PUNCTUATION.test(wordTrimmedPunctuation)) {
          // Preserve the early exit for internal slashes: `and/or` must not
          // match `Andor`, and currently also stops searching later words.
          if (wordTrimmedPunctuation.includes('/')) continue outer

          const spacedWord = wordTrimmedPunctuation.replace(
            REGEX.PUNCTUATION_GLOBAL,
            ' ',
          )
          entry.punctuationVariants = [
            spacedWord,
            spacedWord.replace(REGEX.SPACE, ''),
            ...wordTrimmedPunctuation.split(REGEX.PUNCTUATION),
          ]
        } else {
          entry.punctuationVariants = null
        }
      }

      if (entry.punctuationVariants?.includes(mutedWord)) {
        matches.push({ word: muteWord, predicate: word })
        continue outer
      }
    }
  }

  return matches.length ? matches : undefined
}

/**
 * Checks if the given text matches any of the muted words, returning a boolean
 * if any matches are found.
 */
export function hasMutedWord(params: Params) {
  return !!matchMuteWords(params)
}
