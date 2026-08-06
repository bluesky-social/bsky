import type { DidString, UriString } from '@atproto/lex'
import { graphemeLen } from '@atproto/lex'
import TLDs from 'tlds' with { type: 'json' }
import { app } from '../lexicons/index.js'
import { UnicodeString } from './unicode.js'
import {
  CASHTAG_REGEX,
  MENTION_REGEX,
  TAG_REGEX,
  TRAILING_PUNCTUATION_REGEX,
  URL_REGEX,
} from './util.js'

export type Facet = app.bsky.richtext.facet.Main

export function detectFacets(text: UnicodeString): Facet[] | undefined {
  let match
  const facets: Facet[] = []
  {
    // mentions
    const re = MENTION_REGEX
    while ((match = re.exec(text.utf16))) {
      if (!isValidDomain(match[3]) && !match[3].endsWith('.test')) {
        continue // probably not a handle
      }

      const start = text.utf16.indexOf(match[3], match.index) - 1
      facets.push(
        app.bsky.richtext.facet.$build({
          index: {
            byteStart: text.utf16IndexToUtf8Index(start),
            byteEnd: text.utf16IndexToUtf8Index(start + match[3].length + 1),
          },
          features: [
            app.bsky.richtext.facet.mention.$build({
              did: match[3] as DidString, // boundary: detected text must be resolved
            }),
          ],
        }),
      )
    }
  }
  {
    // links
    const re = URL_REGEX
    while ((match = re.exec(text.utf16))) {
      let uri = match[2]
      if (!uri.startsWith('http')) {
        const domain = match.groups?.domain
        if (!domain || !isValidDomain(domain)) {
          continue
        }
        uri = `https://${uri}`
      }
      const start = text.utf16.indexOf(match[2], match.index)
      const index = { start, end: start + match[2].length }
      // strip ending puncuation
      if (/[.,;:!?]$/.test(uri)) {
        uri = uri.slice(0, -1)
        index.end--
      }
      if (/[)]$/.test(uri) && !uri.includes('(')) {
        uri = uri.slice(0, -1)
        index.end--
      }
      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index.start),
          byteEnd: text.utf16IndexToUtf8Index(index.end),
        },
        features: [
          app.bsky.richtext.facet.link.$build({
            uri: uri as UriString, // boundary: detected text, format verified by URL_REGEX
          }),
        ],
      })
    }
  }
  {
    const re = TAG_REGEX
    while ((match = re.exec(text.utf16))) {
      const leading = match[1]
      let tag = match[2]

      if (!tag) continue

      // strip ending punctuation and any spaces
      tag = tag.trim().replace(TRAILING_PUNCTUATION_REGEX, '')

      // tag.length (UTF-16) is always >= graphemeLen(tag), so only pay for
      // the grapheme count when the UTF-16 length already exceeds the limit.
      // (upstream atproto#2657)
      if (tag.length === 0 || (tag.length > 64 && graphemeLen(tag) > 64))
        continue

      const index = match.index + leading.length

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index),
          byteEnd: text.utf16IndexToUtf8Index(index + 1 + tag.length),
        },
        features: [
          app.bsky.richtext.facet.tag.$build({
            tag: tag,
          }),
        ],
      })
    }
  }
  {
    // cashtags
    const re = CASHTAG_REGEX
    while ((match = re.exec(text.utf16))) {
      const leading = match[1]
      let ticker = match[2]

      if (!ticker) continue

      // Normalize to uppercase
      ticker = ticker.toUpperCase()

      const index = match.index + leading.length

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index),
          byteEnd: text.utf16IndexToUtf8Index(index + 1 + ticker.length), // +1 for $
        },
        features: [
          app.bsky.richtext.facet.tag.$build({
            tag: '$' + ticker, // Store with $ prefix
          }),
        ],
      })
    }
  }
  return facets.length > 0 ? facets : undefined
}

function isValidDomain(str: string): boolean {
  return !!TLDs.find((tld) => {
    const i = str.lastIndexOf(tld)
    if (i === -1) {
      return false
    }
    return str.charAt(i - 1) === '.' && i === str.length - tld.length
  })
}
