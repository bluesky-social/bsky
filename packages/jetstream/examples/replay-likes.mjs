// Measures how many like commits per second replay() can push through a
// plain `for await` loop. Replays the sealed archive from the start (the
// snapshot phase dominates), then cuts over to live until the timer fires.
//
// Build first, then run from packages/jetstream:
//   pnpm build
//   JETSTREAM_API_KEY=… node examples/replay-likes.mjs [service-url] [seconds] [--raw]
//
// The snapshot endpoints on the public host require an API key
// (JETSTREAM_API_KEY). --raw skips typed record conversion (wire-faithful
// DAG-CBOR bytes), which isolates the download/decode pipeline from
// per-record CBOR parsing.
import { Jetstream } from '@bsky/jetstream'

const args = process.argv.slice(2)
const raw = args.includes('--raw')
const positional = args.filter((a) => a !== '--raw')
const service = positional[0] ?? 'https://jetstream.us-west.bsky.network'
const seconds = Number(positional[1] ?? 30)
if (!(seconds > 0)) {
  console.error(
    'usage: node examples/replay-likes.mjs [service-url] [seconds] [--raw]',
  )
  process.exit(1)
}

const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), seconds * 1000)

const js = new Jetstream({ service, apiKey: process.env.JETSTREAM_API_KEY })
let errors = 0
const opts = {
  collections: ['app.bsky.feed.like'],
  kinds: ['commit'],
  afterSeq: 0, // whole sealed archive, then the live tail
  signal: ac.signal,
  onError: () => {
    errors++
  },
}

console.log(
  `replaying app.bsky.feed.like from ${service} for ${seconds}s (${raw ? 'raw' : 'typed'} mode)…`,
)

let total = 0
let windowCount = 0
const start = performance.now()
let lastEventAt = start

// Timer-driven so quiet seconds (caught up to live) still report.
const reporter = setInterval(() => {
  console.log(`${windowCount} likes/sec (total ${total})`)
  windowCount = 0
}, 1000)

try {
  for await (const ev of raw
    ? js.replay({ ...opts, raw: true })
    : js.replay(opts)) {
    void ev
    total++
    windowCount++
    lastEventAt = performance.now()
  }
} catch (err) {
  // Aborting the live transport throws the abort reason (by contract); our
  // own timer firing is the clean end of the measurement, not a failure.
  if (!ac.signal.aborted) throw err
} finally {
  clearTimeout(timer)
  clearInterval(reporter)
  // Average over time-to-last-event so trailing idle (caught up, nothing
  // arriving) doesn't dilute the throughput number.
  const busy = Math.max((lastEventAt - start) / 1000, 0.001)
  console.log(
    `\ntotal: ${total} likes in ${busy.toFixed(1)}s → ${Math.round(total / busy)} likes/sec` +
      (errors ? ` (${errors} recoverable errors)` : ''),
  )
}
