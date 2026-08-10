/**
 * Measures tree-shaken, minified bundle sizes for common SDK usage
 * scenarios, so changes to code conventions (e.g. runtime schema usage) can
 * be evaluated for their bundle-size impact.
 *
 * Bundles from ./dist with rolldown. Workspace dependencies (@atproto/lex,
 * @atproto/syntax, etc.) are bundled in — matching what a real consumer app
 * ships — but each scenario also reports the portion attributable to sdk
 * code alone, via the module-level breakdown in rolldown's output chunks.
 *
 * Usage:
 *   pnpm build && node scripts/measure-bundle.mjs           # table
 *   pnpm build && node scripts/measure-bundle.mjs --json    # machine-readable
 */
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { rolldown } from 'rolldown'

const sdkDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = (p) => join(sdkDir, 'dist', p)

/**
 * Each scenario is a virtual entry module exercising a usage pattern. Named
 * imports mirror how a consumer would import, so tree-shaking behaves the
 * same way it would in an app bundle.
 */
const SCENARIOS = {
  // everything exported from the package root
  'index (full)': `export * from ${JSON.stringify(dist('index.js'))}`,
  // a minimal app: create a post
  'action: post': `export { post } from ${JSON.stringify(dist('actions/records.js'))}`,
  // record CRUD actions only
  'actions: records': `export * from ${JSON.stringify(dist('actions/records.js'))}`,
  // graph actions only
  'actions: graph': `export * from ${JSON.stringify(dist('actions/graph.js'))}`,
  // preferences suite (largest action module)
  'actions: preferences': `export * from ${JSON.stringify(dist('actions/preferences.js'))}`,
  // moderation subpath export
  moderation: `export * from ${JSON.stringify(dist('moderation/index.js'))}`,
  // richtext subpath export
  richtext: `export * from ${JSON.stringify(dist('rich-text/index.js'))}`,
  // utils subpath export
  utils: `export * from ${JSON.stringify(dist('utils/index.js'))}`,
}

async function measure(name, entrySource) {
  const bundle = await rolldown({
    input: 'entry.js',
    plugins: [
      {
        name: 'virtual-entry',
        resolveId: (id) => (id === 'entry.js' ? id : null),
        load: (id) => (id === 'entry.js' ? entrySource : null),
      },
    ],
    logLevel: 'silent',
  })
  const { output } = await bundle.generate({
    format: 'esm',
    minify: true,
  })
  await bundle.close()

  const chunk = output.find((o) => o.type === 'chunk' && o.isEntry)
  const code = Buffer.from(chunk.code)

  // attribute minified bytes to sdk vs dependency modules, proportionally to
  // each module's pre-minification rendered length
  let sdkRendered = 0
  let totalRendered = 0
  for (const [id, mod] of Object.entries(chunk.modules)) {
    totalRendered += mod.renderedLength
    if (id.startsWith(join(sdkDir, 'dist'))) sdkRendered += mod.renderedLength
  }
  const sdkShare = totalRendered ? sdkRendered / totalRendered : 0

  return {
    name,
    minified: code.length,
    gzip: gzipSync(code).length,
    sdkMinifiedApprox: Math.round(code.length * sdkShare),
    moduleCount: Object.keys(chunk.modules).length,
  }
}

const results = []
for (const [name, source] of Object.entries(SCENARIOS)) {
  results.push(await measure(name, source))
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  const kb = (n) => `${(n / 1024).toFixed(1)} KiB`
  console.log(
    'scenario'.padEnd(22) +
      'minified'.padStart(12) +
      'gzip'.padStart(12) +
      '~sdk-only'.padStart(12) +
      'modules'.padStart(10),
  )
  for (const r of results) {
    console.log(
      r.name.padEnd(22) +
        kb(r.minified).padStart(12) +
        kb(r.gzip).padStart(12) +
        kb(r.sdkMinifiedApprox).padStart(12) +
        String(r.moduleCount).padStart(10),
    )
  }
}
