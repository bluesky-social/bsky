/*
 * Peer-compatibility matrix. Verifies the sdk works against representative
 * published @atproto/lex versions satisfying its declared peer range (or an
 * explicit list passed as CLI args): the earliest matching version, plus the
 * latest matching version within each minor.
 *
 * For each candidate version: packs the sdk into a tarball, installs it with
 * that lex version into a scratch project OUTSIDE the workspace (so peer
 * resolution matches a real consumer install, not workspace hoisting), then
 * typechecks peer-smoke.ts there (repo tsc, --noEmit) and executes it.
 *
 * Usage:
 *   node scripts/peer-matrix.mjs             # earliest + latest-per-minor
 *   node scripts/peer-matrix.mjs 0.3.0       # test specific version(s)
 *
 * Requires the sdk to be built (dist/ present) and network access to npm.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(sdkDir, '..', '..')
const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc')
const pkg = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'))
const peerRange = pkg.peerDependencies['@atproto/lex']
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const typesNodeRange = rootPkg.devDependencies['@types/node']

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts })

// Selects the versions worth testing from an in-range list: the earliest
// (oldest install the peer range still admits), plus the latest within each
// minor line (each minor may add features the sdk must not depend on when
// running against earlier minors).
function selectVersions(versions) {
  const parse = (v) => v.split('.').map(Number)
  const sorted = versions
    .filter((v) => !v.includes('-')) // ignore prereleases
    .sort((a, b) => {
      const [amaj, amin, apat] = parse(a)
      const [bmaj, bmin, bpat] = parse(b)
      return amaj - bmaj || amin - bmin || apat - bpat
    })
  const latestPerMinor = new Map()
  for (const v of sorted) {
    const [major, minor] = parse(v)
    latestPerMinor.set(`${major}.${minor}`, v) // ascending: last write wins
  }
  return [...new Set([sorted[0], ...latestPerMinor.values()])]
}

// Resolve candidate versions (npm is run outside the workspace so the
// root devEngines pnpm requirement doesn't reject it).
const scratchRoot = mkdtempSync(join(tmpdir(), 'sdk-peer-matrix-'))
let versions = process.argv.slice(2)
if (versions.length === 0) {
  const out = run(
    'npm',
    ['view', `@atproto/lex@${peerRange}`, 'version', '--json'],
    { cwd: scratchRoot },
  )
  const inRange = [JSON.parse(out)].flat()
  versions = selectVersions(inRange)
  console.log(`in range: ${inRange.join(', ')}`)
}
console.log(`peer range: ${peerRange}`)
console.log(`testing: ${versions.join(', ')}`)

// Pack the sdk once.
const packOut = run(
  'npm',
  ['pack', '--json', '--pack-destination', scratchRoot],
  {
    cwd: sdkDir,
  },
)
const tarball = join(scratchRoot, JSON.parse(packOut)[0].filename)

const failures = []
for (const version of versions) {
  const dir = join(scratchRoot, `lex-${version}`)
  console.log(`\n=== @atproto/lex@${version} ===`)
  try {
    // barrier: keep npm from walking up into unrelated package roots
    writeFileSync(join(scratchRoot, 'package.json'), '{}')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'peer-smoke', private: true, type: 'module' }),
    )
    run(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        tarball,
        `@atproto/lex@${version}`,
        `@types/node@${typesNodeRange}`,
      ],
      { cwd: dir, stdio: 'inherit' },
    )
    cpSync(join(sdkDir, 'scripts/peer-smoke.ts'), join(dir, 'peer-smoke.ts'))
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          lib: ['es2023', 'dom', 'dom.iterable'],
          types: ['node'],
          erasableSyntaxOnly: true,
          skipLibCheck: false, // the sdk/lex .d.ts surface IS the test subject
        },
        include: ['peer-smoke.ts'],
      }),
    )
    run(tsc, ['--project', '.'], { cwd: dir, stdio: 'inherit' })
    run('node', ['--experimental-strip-types', 'peer-smoke.ts'], {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, LEX_VERSION: version },
    })
  } catch (err) {
    console.error(`FAIL @atproto/lex@${version}: ${err.message}`)
    failures.push(version)
  }
}

rmSync(scratchRoot, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\npeer matrix FAILED for: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`\npeer matrix OK: ${versions.join(', ')}`)
