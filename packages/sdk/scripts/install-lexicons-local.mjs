#!/usr/bin/env node
/**
 * Local fallback installer for `lex install`.
 *
 * Used because some lexicons in the local atproto repo have not been published
 * to the AT Protocol network yet (e.g., app.bsky.embed.gallery,
 * chat.bsky.embed.*), causing proof verification failures with the
 * network-based `lex install`.
 *
 * Also handles inconsistencies in the local repo — e.g. the lxm reference to
 * chat.bsky.convo.exportAccountData in chat.bsky.authFullChatClient, which
 * does not exist locally or on the network (the real lexicon is
 * chat.bsky.actor.exportAccountData). Such dangling references get stub
 * lexicon files so `lex install --ci` can resolve them offline; the stubs are
 * then excluded from codegen via the `--exclude` flags in the package.json
 * `codegen` script so no bogus modules are generated.
 *
 * Strategy:
 * 1. Copy lexicon JSON files from the local atproto repo to lexicons/
 * 2. Add stubs for lxm-referenced NSIDs missing from local set
 * 3. Compute CIDs from file content using @atproto/lex-cbor
 * 4. Write lexicons.json with locally-computed CIDs and DNS-resolved AT URIs
 *
 * DIDs were resolved via DNS TXT lookups (_lexicon.<authority>) at install time.
 * For authorities without DNS records (new/unpublished namespaces), a placeholder
 * DID is used — the lex install --ci check only verifies local CIDs, not network
 * state, so this is safe.
 *
 * Usage: node scripts/install-lexicons-local.mjs
 */

import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sdkDir = join(__dirname, '..')
const atprotoLexiconsDir =
  process.argv[2] ?? '/Users/devinivy/Documents/bluesky/atproto/lexicons'
const targetLexiconsDir = join(sdkDir, 'lexicons')
const manifestPath = join(sdkDir, 'lexicons.json')

// Validate that the source directory exists
if (!existsSync(atprotoLexiconsDir)) {
  console.error(
    `Error: lexicons directory not found at ${atprotoLexiconsDir}\n` +
      'Please pass the path to a checkout of bluesky-social/atproto as the first argument.\n' +
      'Usage: node install-lexicons-local.mjs <path-to-atproto-repo>',
  )
  process.exit(1)
}

// DIDs resolved via DNS TXT lookups (_lexicon.<authority>) at install time.
// For authorities not yet in DNS, a placeholder DID is used.
const PLACEHOLDER_DID = 'did:plc:placeholder00000000000000000000'
const AUTHORITY_DIDS = {
  // app.bsky.* authorities
  'actor.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'ageassurance.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'bookmark.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'contact.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'draft.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'embed.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'feed.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'graph.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'labeler.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'notification.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'richtext.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'video.bsky.app': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  // com.atproto.* authorities
  'admin.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'identity.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'label.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'lexicon.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'moderation.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'repo.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'server.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  'sync.atproto.com': 'did:plc:6msi3pj7krzih5qxqtryxlzw',
  // chat.bsky.* authorities
  'actor.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'convo.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'embed.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'moderation.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'notification.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'group.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
}

const LEX_COLLECTION = 'com.atproto.lexicon.schema'

/**
 * Compute the AT URI for an NSID using the DNS-resolved DID.
 * The NSID authority is the last two segments of the namespace reversed to domain form.
 */
function nsidToAtUri(nsid) {
  const { NSID } = nsidLib
  const n = NSID.from(nsid)
  const authority = n.authority
  const did = AUTHORITY_DIDS[authority] ?? PLACEHOLDER_DID
  if (!AUTHORITY_DIDS[authority]) {
    console.warn(
      `  Note: using placeholder DID for unknown authority "${authority}" (${nsid})`,
    )
  }
  return `at://${did}/${LEX_COLLECTION}/${nsid}`
}

// We'll load NSID lazily
let nsidLib

function walk(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walk(full))
    else results.push(full)
  }
  return results
}

const INCLUDED_PREFIXES = ['com.atproto.', 'app.bsky.', 'chat.bsky.']

// Namespaces not part of the SDK's supported surface. These are excluded as
// top-level roots only: any lexicon referenced transitively by an included
// schema (e.g. tools.ozone.report.defs via com.atproto.moderation.defs
// knownValues, or app.bsky.unspecced.* via permission-set lxm lists) is
// deliberately still installed with its real content, since it is needed to
// complete the types of the schemas we do want. Codegen `--exclude` flags in
// package.json keep those dependencies out of the generated build.
const EXCLUDED_PREFIXES = ['app.bsky.unspecced.', 'com.atproto.temp.']

async function main() {
  // Load dependencies
  const lexCborPath = new URL(
    '../../../node_modules/.pnpm/@atproto+lex-cbor@0.1.3/node_modules/@atproto/lex-cbor/dist/index.js',
    import.meta.url,
  )
  const { cidForLex } = await import(lexCborPath)

  // Load NSID parser from installed syntax package
  nsidLib = await import(
    new URL('../node_modules/@atproto/syntax/dist/nsid.js', import.meta.url)
  )

  // Collect local lexicons
  const localFiles = walk(atprotoLexiconsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      srcPath: f,
      nsid: f
        .replace(`${atprotoLexiconsDir}/`, '')
        .replace(/\.json$/, '')
        .replaceAll('/', '.'),
    }))
    .filter(
      ({ nsid }) =>
        INCLUDED_PREFIXES.some((p) => nsid.startsWith(p)) &&
        !EXCLUDED_PREFIXES.some((p) => nsid.startsWith(p)),
    )

  console.log(`Found ${localFiles.length} local lexicons to process`)

  const localNsids = new Set(localFiles.map((f) => f.nsid))

  // Walk NSID references the same way the lex installer does, so the manifest
  // ends up with the same transitive closure that `lex install --ci` computes.
  function* defRefs(def) {
    if (!def || typeof def !== 'object') return
    switch (def.type) {
      case 'string':
        for (const val of def.knownValues || []) {
          if (typeof val === 'string' && val.includes('#')) yield val
        }
        return
      case 'array':
        yield* defRefs(def.items)
        return
      case 'params':
      case 'object':
        for (const prop of Object.values(def.properties || {})) {
          yield* defRefs(prop)
        }
        return
      case 'union':
        yield* def.refs || []
        return
      case 'ref':
        yield def.ref
        return
      case 'record':
        yield* defRefs(def.record)
        return
      case 'procedure':
        if (def.input?.schema) yield* defRefs(def.input.schema)
      // fallthrough
      case 'query':
        if (def.output?.schema) yield* defRefs(def.output.schema)
      // fallthrough
      case 'subscription':
        if (def.parameters) yield* defRefs(def.parameters)
        if (def.message?.schema) yield* defRefs(def.message.schema)
        return
      case 'permission-set':
        for (const perm of def.permissions || []) yield* defRefs(perm)
        return
      case 'permission':
        if (def.resource === 'rpc') yield* def.lxm || []
        else if (def.resource === 'repo') yield* def.collection || []
        return
      default:
        return
    }
  }

  function* documentNsidRefs(content) {
    for (const def of Object.values(content.defs || {})) {
      for (const ref of defRefs(def)) {
        if (typeof ref !== 'string') continue
        const [nsid] = ref.split('#', 1)
        if (nsid && nsid.includes('.')) yield nsid
      }
    }
  }

  // Find referenced NSIDs outside the included set. Transitive deps that exist
  // in the local repo get their real files copied (resolutions only, not
  // manifest roots); truly missing ones get stubs.
  const transitiveDeps = new Map() // nsid → srcPath
  const missingRefs = new Map() // nsid → referencing lexicon
  const queue = localFiles.map(({ srcPath, nsid }) => ({ srcPath, nsid }))
  const seen = new Set(localNsids)
  while (queue.length > 0) {
    const { srcPath, nsid } = queue.shift()
    let content
    try {
      content = JSON.parse(readFileSync(srcPath, 'utf8'))
    } catch (e) {
      console.warn(`Warning: error processing ${nsid}: ${e.message}`)
      continue
    }
    for (const ref of documentNsidRefs(content)) {
      if (seen.has(ref)) continue
      seen.add(ref)
      const refPath = join(
        atprotoLexiconsDir,
        ref.replaceAll('.', '/') + '.json',
      )
      if (existsSync(refPath)) {
        transitiveDeps.set(ref, refPath)
        queue.push({ srcPath: refPath, nsid: ref })
      } else {
        missingRefs.set(ref, nsid)
      }
    }
  }

  if (transitiveDeps.size > 0) {
    console.log(
      `Found ${transitiveDeps.size} transitive dependency NSID(s) outside the included set:`,
    )
    for (const dep of transitiveDeps.keys()) {
      console.log(`  ${dep}`)
    }
  }

  if (missingRefs.size > 0) {
    console.log(
      `Found ${missingRefs.size} referenced NSID(s) missing from local set:`,
    )
    for (const [ref, from] of missingRefs) {
      console.log(`  ${ref} (referenced in ${from})`)
    }
  }

  // Clean target directory
  if (existsSync(targetLexiconsDir)) {
    execSync(`rm -rf "${targetLexiconsDir}"`)
  }
  mkdirSync(targetLexiconsDir, { recursive: true })

  const manifest = {
    version: 1,
    lexicons: [],
    resolutions: {},
  }

  // Process local lexicons
  console.log('Copying lexicons and computing CIDs...')
  for (const { srcPath, nsid } of localFiles) {
    const content = JSON.parse(readFileSync(srcPath, 'utf8'))

    // Write to target directory
    const relPath = nsid.replaceAll('.', '/') + '.json'
    const destPath = join(targetLexiconsDir, relPath)
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, JSON.stringify(content, null, 2) + '\n')

    // Compute CID from the content
    const cid = await cidForLex(content)
    const uri = nsidToAtUri(nsid)

    manifest.lexicons.push(nsid)
    manifest.resolutions[nsid] = { uri, cid: cid.toString() }
  }

  // Copy transitive dependencies (real content, resolutions only — not
  // manifest roots). This mirrors how the lex installer records dependencies.
  if (transitiveDeps.size > 0) {
    console.log('Copying transitive dependencies...')
    for (const [nsid, srcPath] of transitiveDeps) {
      const content = JSON.parse(readFileSync(srcPath, 'utf8'))

      const relPath = nsid.replaceAll('.', '/') + '.json'
      const destPath = join(targetLexiconsDir, relPath)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, JSON.stringify(content, null, 2) + '\n')

      const cid = await cidForLex(content)
      const uri = nsidToAtUri(nsid)

      manifest.resolutions[nsid] = { uri, cid: cid.toString() }
      console.log(`  Dependency copied: ${nsid}`)
    }
  }

  // Add stub resolutions for referenced NSIDs missing from the local repo
  // (e.g. renamed NSIDs still referenced by lxm fields). This prevents the
  // lex installer from making network calls for these.
  if (missingRefs.size > 0) {
    console.log('Adding stubs for missing referenced NSIDs...')
    for (const [nsid, referencedIn] of missingRefs) {
      // Create a minimal stub lexicon — a query with the correct id
      const stub = {
        lexicon: 1,
        id: nsid,
        description: `Stub: ${nsid} is referenced in ${referencedIn} but the lexicon may have been renamed in the local repo.`,
        defs: {
          main: {
            type: 'query',
            output: { encoding: 'application/jsonl' },
          },
        },
      }

      const relPath = nsid.replaceAll('.', '/') + '.json'
      const destPath = join(targetLexiconsDir, relPath)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, JSON.stringify(stub, null, 2) + '\n')

      const cid = await cidForLex(stub)
      const uri = nsidToAtUri(nsid)

      // Add to resolutions so CI check won't try network fetch
      manifest.resolutions[nsid] = { uri, cid: cid.toString() }
      console.log(`  Stub written: ${nsid}`)
    }
  }

  // Sort for determinism
  manifest.lexicons.sort()
  manifest.resolutions = Object.fromEntries(
    Object.entries(manifest.resolutions).sort(([a], [b]) =>
      a > b ? 1 : a < b ? -1 : 0,
    ),
  )

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  const fileCount = walk(targetLexiconsDir).filter((f) =>
    f.endsWith('.json'),
  ).length
  console.log(`\nDone.`)
  console.log(`  ${fileCount} JSON files in ${targetLexiconsDir}/`)
  console.log(
    `  ${manifest.lexicons.length} root lexicons, ${Object.keys(manifest.resolutions).length} total in manifest`,
  )
  console.log(`  Wrote ${manifestPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
