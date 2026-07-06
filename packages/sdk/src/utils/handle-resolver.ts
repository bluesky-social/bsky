import { Client } from '@atproto/lex-client'
import type { HandleString } from '@atproto/syntax'
import type { AtprotoDid, HandleResolver } from '@atproto-labs/handle-resolver'
import { com } from '../lexicons/index.js'

/**
 * Wraps a lex Client as a HandleResolver. Resolves handles using
 * com.atproto.identity.resolveHandle; returns null on resolution failure.
 */
export function handleResolverFromClient(client: Client): HandleResolver {
  return {
    async resolve(handle: string) {
      try {
        const res = await client.call(com.atproto.identity.resolveHandle, {
          handle: handle as HandleString,
        })
        return res.did as AtprotoDid
      } catch {
        return null
      }
    },
  }
}
