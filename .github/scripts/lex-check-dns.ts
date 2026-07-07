// Check DNS NSID resolution for lexicon groups against .github/lexicons.json:
// non-carveout groups must resolve to the expected publishing DID; carveout
// groups must NOT resolve at all (we intentionally keep them unpublished).
// Reads lexicon file paths on stdin (one per line, e.g. from
// lex-changed-files.sh), or checks the entire lexicons/ tree with --all.
// Emits lex-report-compatible JSON findings on stdout (kind `dns`), a
// human-readable table on stderr, exit 1 on violations.
// Runs under Node type stripping (erasable syntax only, no transforms).
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'

export interface DnsConfig {
  did: string
  carveouts: string[]
}

export type GroupStatus =
  | { status: 'ok' }
  | { status: 'carveout' }
  | { status: 'violation'; message: string }

// lexicons/app/bsky/feed/post.json -> app.bsky.feed
export function groupForFile(filePath: string): string {
  const parts = filePath.split('/')
  if (parts[0] !== 'lexicons' || parts.length < 4) {
    throw new Error(`not a lexicon file path with an NSID group: ${filePath}`)
  }
  return parts.slice(1, -1).join('.')
}

// Dedupe files to one representative NSID per group; DNS records are
// per-group, so resolving any one member NSID suffices (the first file
// seen for each group is used).
export function planChecks(files: string[]): { group: string; nsid: string }[] {
  const byGroup = new Map<string, string>()
  for (const file of files) {
    const group = groupForFile(file)
    if (!byGroup.has(group)) {
      const name = file
        .split('/')
        .at(-1)!
        .replace(/\.json$/, '')
      byGroup.set(group, `${group}.${name}`)
    }
  }
  return [...byGroup.entries()].map(([group, nsid]) => ({ group, nsid }))
}

export function evaluateGroup(
  group: string,
  resolvedDid: string | null,
  config: DnsConfig,
): GroupStatus {
  const carveout = config.carveouts.includes(group)
  if (carveout) {
    if (resolvedDid === null) return { status: 'carveout' }
    return {
      status: 'violation',
      message: `carveout group unexpectedly has DNS (resolves to ${resolvedDid}); remove the _lexicon record or the carveout`,
    }
  }
  if (resolvedDid === null) {
    return {
      status: 'violation',
      message: `missing DNS: group does not resolve; create the _lexicon TXT record for ${config.did}`,
    }
  }
  if (resolvedDid !== config.did) {
    return {
      status: 'violation',
      message: `resolves to ${resolvedDid}, expected ${config.did}`,
    }
  }
  return { status: 'ok' }
}

async function allLexiconFiles(): Promise<string[]> {
  const entries = await readdir('lexicons', {
    recursive: true,
    withFileTypes: true,
  })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => `${e.parentPath}/${e.name}`)
    .sort()
}

async function main(): Promise<void> {
  // Dynamic import: the pure functions above are unit-testable without
  // node_modules; only actually running the check needs the dependency.
  const { LexResolver, LexResolverError } =
    await import('@atproto/lex-resolver')
  const { values } = parseArgs({
    options: {
      all: { type: 'boolean', default: false },
      config: { type: 'string', default: '.github/lexicons.json' },
    },
  })
  const config: DnsConfig = JSON.parse(readFileSync(values.config, 'utf8')).dns
  if (!config?.did || !Array.isArray(config.carveouts)) {
    throw new Error(`malformed dns config in ${values.config}`)
  }

  let files: string[]
  if (values.all) {
    files = await allLexiconFiles()
  } else {
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    files = input.split('\n').filter((line) => line.trim() !== '')
  }

  const resolver = new LexResolver({})
  let violations = 0
  for (const { group, nsid } of planChecks(files)) {
    let resolvedDid: string | null = null
    try {
      const uri = await resolver.resolve(nsid)
      resolvedDid = uri.host
    } catch (err) {
      // resolution failure: no DNS authority for this group (or transient
      // DNS trouble; the failure message tells the operator to re-run).
      // Anything else (e.g. a malformed NSID) is a bug, not a DNS status.
      if (!(err instanceof LexResolverError)) throw err
    }
    const result = evaluateGroup(group, resolvedDid, config)
    if (result.status === 'violation') {
      violations++
      console.error(`❌ ${group}: ${result.message}`)
      process.stdout.write(
        JSON.stringify({
          nsid: group,
          'lint-level': 'error',
          'lint-name': 'dns-resolution',
          message: result.message,
        }) + '\n',
      )
    } else if (result.status === 'carveout') {
      console.error(`⬜ ${group}: carveout, intentionally unpublished`)
    } else {
      console.error(`✅ ${group}: resolves to ${config.did}`)
    }
  }
  if (violations > 0) {
    console.error(
      `${violations} DNS violation(s); note DNS failures can be transient — a re-run may clear a false positive`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
