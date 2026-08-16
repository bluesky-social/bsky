import type { DidString, UriString } from '@atproto/lex'
import { graphemeLen } from '@atproto/lex'
import TLDs from 'tlds' with { type: 'json' }
import { app } from '../lexicons/index.js'
import { type UnicodeString } from './unicode.js'
import {
  CASHTAG_REGEX,
  MENTION_REGEX,
  TAG_REGEX,
  TRAILING_PUNCTUATION_REGEX,
  URL_REGEX,
} from './util.js'

export type Facet = app.bsky.richtext.facet.Main

const SCHEME_REGEX = /^https?:\/\//i
const TRAILING_URL_PUNCTUATION_REGEX = /[.,;:!?]$/
/** An optional scheme, then the authority: everything up to a path, query or fragment. */
const AUTHORITY_REGEX = /^(https?:\/\/)?([^/?#]*)/i
/** Dot-separated DNS labels — letters, digits and hyphens — and an optional port. */
const HOSTNAME_REGEX =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d+)?/i
/** Dotted-quad, as normalized by the URL parser. */
const IPV4_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}$/

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
      // trim the matched text, before any scheme is prepended, so its length
      // stays comparable with the index into the original text
      const matched = trimTrailingPunctuation(trimToHostname(match[2]))
      const uri = SCHEME_REGEX.test(matched) ? matched : `https://${matched}`
      if (!hasValidHost(uri)) {
        continue
      }
      const start = text.utf16.indexOf(match[2], match.index)
      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(start),
          byteEnd: text.utf16IndexToUtf8Index(start + matched.length),
        },
        features: [
          app.bsky.richtext.facet.link.$build({
            uri: uri as UriString, // boundary: detected text, parsed and host-checked by hasValidHost
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

/**
 * Cuts a candidate off where its host stops looking like a host.
 *
 * `URL_REGEX` runs to the next whitespace, so prose that abuts a domain lands
 * in the authority: `stream.place's` is matched whole, leaving `place's` where
 * the TLD should be. A DNS label is letters, digits and hyphens, so the host
 * ends at the apostrophe and the rest is sentence, not link.
 *
 * The trim only ever drops what follows a hostname, so it cannot change where
 * a link points — except through userinfo, where the host sits after an `@`
 * (`https://example.com@elsewhere.test`), so authorities carrying one are left
 * for the host check to judge whole. Authorities that do not start with a
 * hostname at all — IP literals, IDNs — are left alone for the same reason.
 */
function trimToHostname(candidate: string): string {
  const [, scheme = '', authority = ''] = AUTHORITY_REGEX.exec(candidate)!
  if (authority.includes('@')) {
    return candidate
  }
  const hostname = HOSTNAME_REGEX.exec(authority)?.[0]
  if (hostname === undefined || hostname.length === authority.length) {
    return candidate
  }
  return scheme + hostname
}

/**
 * Drops punctuation that ends the sentence rather than the link. Runs until
 * nothing more comes off, so `foo.com/bar!!` loses both `!`.
 */
function trimTrailingPunctuation(candidate: string): string {
  for (;;) {
    let trimmed = candidate.replace(TRAILING_URL_PUNCTUATION_REGEX, '')
    if (trimmed.endsWith(')') && !trimmed.includes('(')) {
      trimmed = trimmed.slice(0, -1)
    }
    if (trimmed === candidate) {
      return candidate
    }
    candidate = trimmed
  }
}

/**
 * Whether a detected candidate really points at a host on the public internet.
 *
 * `URL_REGEX` only stops at whitespace, so a candidate routinely carries text
 * that no trailing-punctuation rule can remove: `stream.place's` arrives here
 * whole, and it is only once it is parsed that the host is revealed as
 * `stream.place's`, whose TLD `place's` cannot be a TLD. Parsing also settles
 * the cases the regex never modelled at all — an explicit `https://` link was
 * previously trusted without any check on its host.
 */
function hasValidHost(uri: string): boolean {
  let hostname: string
  try {
    // non-ASCII hosts are normalized to punycode here, so `stream.place’s`
    // (curly apostrophe) becomes `stream.xn--places-7h0c` and fails the TLD
    // check the same way its ASCII twin does
    ;({ hostname } = new URL(uri))
  } catch {
    return false // not parseable as a URL at all, e.g. `bsky.app…`
  }
  // IP literals have no TLD to look up: `[::1]` bracketed for IPv6, dotted
  // quad for IPv4, both already canonicalized by the parser
  if (hostname.startsWith('[') || IPV4_REGEX.test(hostname)) {
    return true
  }
  return isValidDomain(hostname)
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
