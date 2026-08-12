import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The package's isomorphism claim: nothing in src/ may import Node-only
// modules, with exactly one sanctioned exception — the node branch of the
// `#runtime` imports condition, which resolvers only select on Node.
// ws-client owns the websocket platform split the same way.

const SRC = join(import.meta.dirname, '../../src')
const NODE_RUNTIME_BRANCH = join(SRC, 'runtime/node.ts')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name.endsWith('.ts') && p !== NODE_RUNTIME_BRANCH) yield p
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
