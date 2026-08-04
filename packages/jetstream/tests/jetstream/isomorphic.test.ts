import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The package's isomorphism claim: nothing in src/ may import Node-only
// modules. ws-client owns the platform split; this test keeps it that way.

const SRC = join(import.meta.dirname, '../../src')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name.endsWith('.ts')) yield p
  }
}

const NODE_ONLY =
  /from\s+['"](node:[^'"]*|ws|fs|path|os|crypto|stream|util|events|buffer|child_process|net|http|https)['"]/

describe('isomorphism', () => {
  it('src/ imports no Node-only modules', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (NODE_ONLY.test(readFileSync(file, 'utf8'))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
