import { describe, expect, it } from 'vitest'
import { app } from '../src/lexicons/index.js'
import { is$typedObject } from '../src/utils/types.js'

const adultContentPref = app.bsky.actor.defs.adultContentPref
type Preferences = app.bsky.actor.defs.Preferences

describe('is$typedObject strict guard', () => {
  it('narrows to the variant with $type required', () => {
    const prefs: Preferences = [
      { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true },
    ]
    const p = prefs[0]
    if (is$typedObject(p, adultContentPref.$type)) {
      const t: 'app.bsky.actor.defs#adultContentPref' = p.$type
      const e: boolean = p.enabled
      expect(t).toBe('app.bsky.actor.defs#adultContentPref')
      expect(e).toBe(true)
    } else {
      expect.unreachable()
    }
  })

  it('rejects a value with missing $type (unlike schema.$isTypeOf)', () => {
    const bare = { enabled: true } as Record<string, unknown>
    expect(adultContentPref.isTypeOf(bare)).toBe(true) // lenient
    expect(is$typedObject(bare, adultContentPref.$type)).toBe(false) // strict
  })

  it('rejects a value with mismatched $type', () => {
    const other = {
      $type: 'app.bsky.actor.defs#contentLabelPref',
      label: 'x',
      visibility: 'hide',
    } as Record<string, unknown>
    expect(is$typedObject(other, adultContentPref.$type)).toBe(false)
  })

  it('works as an array-method predicate and narrows the result', () => {
    const prefs: Preferences = [
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'porn',
        visibility: 'hide',
      },
      { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true },
    ]
    const found = prefs.find((p) => is$typedObject(p, adultContentPref.$type))
    const e: boolean | undefined = found?.enabled
    expect(e).toBe(true)
  })
})
