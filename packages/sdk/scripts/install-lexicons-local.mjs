#!/usr/bin/env node
/**
 * Local fallback installer for `lex install`.
 *
 * Used because some lexicons in the local atproto repo have not been published
 * to the AT Protocol network yet (e.g., app.bsky.embed.gallery,
 * app.bsky.unspecced.*, chat.bsky.embed.*), causing proof verification failures
 * with the network-based `lex install`.
 *
 * Also handles inconsistencies in the local repo (e.g., lxm references to
 * renamed NSIDs like chat.bsky.convo.exportAccountData).
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
  'unspecced.bsky.app': PLACEHOLDER_DID, // Not yet in DNS
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
  'temp.atproto.com': PLACEHOLDER_DID, // Not yet in DNS
  // chat.bsky.* authorities
  'actor.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'convo.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'embed.bsky.chat': PLACEHOLDER_DID, // Not yet in DNS
  'moderation.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  'notification.bsky.chat': PLACEHOLDER_DID, // Not yet in DNS
  'group.bsky.chat': 'did:plc:4v4y5r3lwsbtmsxhile2ljac',
  // tools.ozone.* authorities
  'communication.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'hosting.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'moderation.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'queue.ozone.tools': PLACEHOLDER_DID, // Not yet in DNS
  'report.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'safelink.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'server.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'set.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'setting.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'signature.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'team.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  'verification.ozone.tools': 'did:plc:33dt5kftu3jq2h5h4jjlqezt',
  // com.germnetwork.* authorities
  'germnetwork.com': 'did:plc:qyqmmncrm6qx33kpy7vqndik',
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

const INCLUDED_PREFIXES = [
  'com.atproto.',
  'app.bsky.',
  'chat.bsky.',
  'tools.ozone.',
  'com.germnetwork.',
]

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
    .filter(({ nsid }) => INCLUDED_PREFIXES.some((p) => nsid.startsWith(p)))

  console.log(`Found ${localFiles.length} local lexicons to process`)

  const localNsids = new Set(localFiles.map((f) => f.nsid))

  // Find lxm-referenced NSIDs missing from local set (inconsistencies in repo)
  const missingLxmRefs = new Map() // nsid → referencing lexicon
  for (const { srcPath, nsid } of localFiles) {
    try {
      const content = JSON.parse(readFileSync(srcPath, 'utf8'))
      for (const def of Object.values(content.defs || {})) {
        if (def?.type === 'permission-set') {
          for (const perm of def.permissions || []) {
            if (perm?.type === 'permission' && perm.resource === 'rpc') {
              for (const lxm of perm.lxm || []) {
                if (typeof lxm === 'string' && !localNsids.has(lxm)) {
                  missingLxmRefs.set(lxm, nsid)
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Warning: error processing ${nsid}: ${e.message}`)
    }
  }

  if (missingLxmRefs.size > 0) {
    console.log(
      `Found ${missingLxmRefs.size} lxm-referenced NSID(s) missing from local set:`,
    )
    for (const [ref, from] of missingLxmRefs) {
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

  // Add stub resolutions for missing lxm-referenced NSIDs
  // This prevents the lex installer from making network calls for these
  // (the stubs won't be in manifest.lexicons — just in resolutions as transitive deps)
  if (missingLxmRefs.size > 0) {
    console.log('Adding stubs for missing lxm-referenced NSIDs...')
    for (const [nsid, referencedIn] of missingLxmRefs) {
      // Create a minimal stub lexicon — a query with the correct id
      const stub = {
        lexicon: 1,
        id: nsid,
        description: `Stub: ${nsid} is referenced in ${referencedIn} lxm field but the lexicon may have been renamed in the local repo.`,
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
