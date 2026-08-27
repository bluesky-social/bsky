import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(sdkDir, '..', '..')
const rootLexiconsDir = join(repoRoot, 'lexicons')
const localDependenciesDir = join(sdkDir, 'lexicon-deps')
const buildInputDir = join(sdkDir, '.lexicons', 'input')
const outputDir = join(sdkDir, 'src', 'lexicons')
const lex = join(sdkDir, 'node_modules', '.bin', 'lex')

function runLex(args) {
  try {
    execFileSync(lex, args, { cwd: sdkDir, encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout)
    if (err.stderr) process.stderr.write(err.stderr)
    throw err
  }
}

rmSync(buildInputDir, { recursive: true, force: true })
mkdirSync(buildInputDir, { recursive: true })
cpSync(localDependenciesDir, buildInputDir, { recursive: true })
// Root lexicons are canonical and are copied last so they win any collision.
cpSync(rootLexiconsDir, buildInputDir, { recursive: true })

runLex([
  'build',
  '--clear',
  '--index-file',
  '--lexicons',
  buildInputDir,
  '--out',
  outputDir,
  '--include',
  'app.bsky.*',
  '--include',
  'chat.bsky.*',
  '--include',
  'com.atproto.*',
  '--exclude',
  'app.bsky.unspecced.*',
])
