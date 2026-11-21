import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { subscribe } from 'node:diagnostics_channel'
import { ClientRequest, type IncomingMessage } from 'node:http'
import * as zlib from 'node:zlib'
import {
  type Decompressor,
  type JetstreamRuntime,
  type Sha256,
  type UpgradeObserver,
  boundedDecompressor,
} from './interface.js'

let decompressor: Decompressor | undefined
let sha256: Sha256 | undefined
let upgradeObserver: UpgradeObserver | undefined

// The websocket client dials through `ws`, which dials through node:http and
// exposes nothing of the upgrade response. node:http publishes every client
// request on this diagnostics channel synchronously at creation, inside the
// async context of whoever started the dial; the observer scopes interest to
// the stream that installed it via AsyncLocalStorage, then reads the upgrade
// response off the request. Requests outside any observed stream are left
// untouched.
function createUpgradeObserver(): UpgradeObserver {
  const store = new AsyncLocalStorage<(headers: Headers) => void>()
  subscribe('http.client.request.start', (message) => {
    const onUpgrade = store.getStore()
    if (!onUpgrade) return
    const request =
      typeof message === 'object' && message !== null && 'request' in message
        ? message.request
        : undefined
    if (!(request instanceof ClientRequest)) return
    request.prependOnceListener('upgrade', (res: IncomingMessage) => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue
        for (const v of Array.isArray(value) ? value : [value]) {
          headers.append(name, v)
        }
      }
      onUpgrade(headers)
    })
  })
  return { observe: (onUpgrade, fn) => store.run(onUpgrade, fn) }
}

export const defaultRuntime: JetstreamRuntime = {
  /**
   * zstd via node:zlib. zstdDecompressSync arrived in Node 22.15 while
   * engines is advisory, so the existence check stays at call time: a
   * live()-only consumer on an older Node must not crash, and a snapshot
   * consumer gets told exactly what to do.
   */
  zstdDecompressor(): Decompressor {
    if (decompressor) return decompressor
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error(
        'node:zlib lacks zstdDecompressSync (requires Node >= 22.15): supply your own zstd Decompressor',
      )
    }
    return (decompressor = boundedDecompressor((frame, maxOutputLength) =>
      zlib.zstdDecompressSync(frame, { maxOutputLength }),
    ))
  },

  sha256(): Sha256 {
    return (sha256 ??= (bytes) =>
      new Uint8Array(createHash('sha256').update(bytes).digest()))
  },

  upgradeObserver(): UpgradeObserver {
    return (upgradeObserver ??= createUpgradeObserver())
  },
}
