// Convert goat `lex lint --json` / `lex breaking --json` JSON-lines output
// into a markdown report for a PR comment. Empty stdout means no findings.
import { parseArgs } from 'node:util'

const TITLES = {
  lint: 'Lexicon lint findings',
  breaking: 'Lexicon breaking-change findings',
}

export function buildReport(kind, findings) {
  const title = TITLES[kind]
  if (!title) throw new Error(`unknown report kind: ${kind}`)
  if (findings.length === 0) return ''
  const byFile = new Map()
  for (const finding of findings) {
    // `goat lex breaking --json` output has no file-path, only nsid.
    const key = finding['file-path'] ?? finding.nsid
    if (!key) throw new Error(`finding missing file-path and nsid: ${JSON.stringify(finding)}`)
    if (!byFile.has(key)) byFile.set(key, [])
    byFile.get(key).push(finding)
  }
  const lines = [`### ${title}`, '']
  for (const [key, items] of byFile) {
    lines.push(`**\`${key}\`**`)
    for (const f of items) {
      lines.push(`- \`${f['lint-name']}\` (${f['lint-level']}): ${f.message}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const { values } = parseArgs({ options: { kind: { type: 'string' } } })
  if (!values.kind) throw new Error('--kind is required')
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const findings = input
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
  process.stdout.write(buildReport(values.kind, findings))
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
