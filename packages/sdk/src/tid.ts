// TODO: align with @atproto libraries once TID moves out of @atproto/common-web

/**
 * Minimal faithful TID implementation. Alphabet: s32 (234567abcdefghijklmnopqrstuvwxyz).
 * Encodes (microsecond timestamp << 10 | clockid) into 13 s32 characters, mirroring
 * @atproto/common-web src/tid.ts (TID.next / TID.nextStr), lines 24–48.
 * Monotonicity guard: if now <= lastTimestamp, increment the millisecond counter.
 */
const S32 = '234567abcdefghijklmnopqrstuvwxyz'

function s32encode(i: number): string {
  let s = ''
  while (i) {
    s = S32.charAt(i % 32) + s
    i = Math.floor(i / 32)
  }
  return s
}

let _tidLastTime = 0
let _tidTimestampCount = 0
let _tidClockid: number | null = null

function nextTid(): string {
  const now = Math.max(Date.now(), _tidLastTime)
  if (now === _tidLastTime) {
    _tidTimestampCount++
  } else {
    _tidTimestampCount = 0
  }
  _tidLastTime = now
  if (_tidClockid === null) {
    _tidClockid = Math.floor(Math.random() * 32)
  }
  const timestamp = now * 1000 + _tidTimestampCount
  const str = `${s32encode(timestamp)}${s32encode(_tidClockid).padStart(2, '2')}`
  return str.padStart(13, '2')
}

export { nextTid }
