import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planUpsert } from './lex-sticky-comment.mjs'

const marker = '<!-- lex-lint-report -->'

test('creates a comment when findings exist and none is present', () => {
  const plan = planUpsert({ comments: [], marker, body: '### findings' })
  assert.equal(plan.action, 'create')
  assert.ok(plan.finalBody.startsWith(marker))
  assert.match(plan.finalBody, /### findings/)
})

test('updates the existing marked comment', () => {
  const comments = [
    { id: 1, body: 'unrelated' },
    { id: 2, body: `${marker}\nold findings` },
  ]
  const plan = planUpsert({ comments, marker, body: '### new findings' })
  assert.equal(plan.action, 'update')
  assert.equal(plan.commentId, 2)
  assert.match(plan.finalBody, /### new findings/)
})

test('empty body with existing comment posts a resolved note', () => {
  const comments = [{ id: 7, body: `${marker}\nold findings` }]
  const plan = planUpsert({ comments, marker, body: '' })
  assert.equal(plan.action, 'update')
  assert.equal(plan.commentId, 7)
  assert.match(plan.finalBody, /resolved/i)
})

test('empty body with no existing comment skips', () => {
  const plan = planUpsert({ comments: [], marker, body: '' })
  assert.equal(plan.action, 'skip')
})
