/**
 * Addresses of Bluesky-operated services. `service` values are
 * `did#service_id` references usable as the lex Client `service` option
 * (the `atproto-proxy` header); `url*` values are direct HTTP origins.
 */
export const api = Object.freeze({
  app: Object.freeze({
    did: 'did:web:api.bsky.app',
    service: 'did:web:api.bsky.app#bsky_appview',
    url: 'https://api.bsky.app',
    urlPublic: 'https://public.api.bsky.app',
  }),
  chat: Object.freeze({
    did: 'did:web:api.bsky.chat',
    service: 'did:web:api.bsky.chat#bsky_chat',
    url: 'https://api.bsky.chat',
  }),
  moderation: Object.freeze({
    did: 'did:plc:ar7c4by46qjdydhdevvrndac',
    service: 'did:plc:ar7c4by46qjdydhdevvrndac#atproto_labeler',
  }),
} as const)
