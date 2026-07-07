import { Client } from '@atproto/lex-client'
import type { HandleString } from '@atproto/syntax'
import type {
  AtprotoDid,
  HandleResolver,
  ResolvedHandle,
} from '@atproto-labs/handle-resolver'
import { com } from '../lexicons/index.js'

/**
 * Wraps a lex Client as a HandleResolver. Resolves handles using
 * com.atproto.identity.resolveHandle; returns null on resolution failure.
 */
export class ClientHandleResolver implements HandleResolver {
  constructor(protected readonly client: Client) {}

  async resolve(handle: string): Promise<ResolvedHandle> {
    try {
      const res = await this.client.call(com.atproto.identity.resolveHandle, {
        // caller validates handle format; xrpc will reject invalid
        handle: handle as HandleString,
      })
      // resolveHandle returns blessed did methods (plc/web) in practice
      return res.did as AtprotoDid
    } catch {
      return null
    }
  }
}

/**
 * Convenience factory for {@link ClientHandleResolver}.
 */
export function handleResolverFromClient(client: Client): HandleResolver {
  return new ClientHandleResolver(client)
}
