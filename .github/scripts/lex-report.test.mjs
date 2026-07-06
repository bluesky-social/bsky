import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildReport } from './lex-report.mjs'

test('empty findings produce empty report', () => {
  assert.equal(buildReport('lint', []), '')
})

test('lint findings group by file-path', () => {
  const findings = [
    {
      'file-path': 'lexicons/app/bsky/feed/post.json',
      nsid: 'app.bsky.feed.post',
      'lint-level': 'warn',
      'lint-name': 'unlimited-string',
      message: 'no max length',
    },
    {
      'file-path': 'lexicons/app/bsky/feed/post.json',
      nsid: 'app.bsky.feed.post',
      'lint-level': 'warn',
      'lint-name': 'missing-primary-description',
      message: 'primary type missing a description',
    },
  ]
  const report = buildReport('lint', findings)
  assert.match(report, /### Lexicon lint findings/)
  assert.equal(report.match(/lexicons\/app\/bsky\/feed\/post\.json/g).length, 1)
  assert.match(report, /`unlimited-string` \(warn\): no max length/)
  assert.match(report, /`missing-primary-description` \(warn\): primary type missing a description/)
})

test('breaking findings fall back to nsid when file-path is absent', () => {
  const findings = [
    {
      nsid: 'app.bsky.feed.like',
      'lint-level': 'error',
      'lint-name': 'object-required',
      message: 'required fields change (main)',
    },
  ]
  const report = buildReport('breaking', findings)
  assert.match(report, /### Lexicon breaking-change findings/)
  assert.match(report, /app\.bsky\.feed\.like/)
  assert.match(report, /`object-required` \(error\): required fields change \(main\)/)
})

test('unknown kind throws even with empty findings', () => {
  assert.throws(() => buildReport('bogus', []), /unknown report kind/)
})
