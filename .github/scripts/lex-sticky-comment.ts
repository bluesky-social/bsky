// Upsert a marker-tagged ("sticky") PR comment from a markdown body on
// stdin. Empty body marks a previously posted comment resolved, or skips.
// Runs under Node type stripping (erasable syntax only, no transforms).
import { parseArgs } from 'node:util'

export interface IssueComment {
  id: number
  body: string
}

export type UpsertPlan =
  | { action: 'skip' }
  | { action: 'create'; finalBody: string }
  | { action: 'update'; commentId: number; finalBody: string }

export function planUpsert({
  comments,
  marker,
  body,
}: {
  comments: IssueComment[]
  marker: string
  body: string
}): UpsertPlan {
  const existing = comments.find((c) => c.body.includes(marker))
  if (body.trim() === '') {
    if (!existing) return { action: 'skip' }
    return {
      action: 'update',
      commentId: existing.id,
      finalBody: `${marker}\n✅ Previous findings resolved by the latest push.`,
    }
  }
  const finalBody = `${marker}\n${body}`
  if (existing) return { action: 'update', commentId: existing.id, finalBody }
  return { action: 'create', finalBody }
}

async function githubRequest(
  method: string,
  path: string,
  payload?: unknown,
): Promise<any> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(
      `github api ${method} ${path}: ${response.status} ${await response.text()}`,
    )
  }
  return response.json()
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { marker: { type: 'string' } } })
  if (!values.marker) throw new Error('--marker is required')
  const repo = process.env.GITHUB_REPOSITORY
  const pr = process.env.PR_NUMBER
  if (!repo || !pr)
    throw new Error('GITHUB_REPOSITORY and PR_NUMBER are required')

  let body = ''
  for await (const chunk of process.stdin) body += chunk

  const marker = `<!-- ${values.marker} -->`
  // One page of 100 is plenty for these bot comments; the marked comment is
  // created early in a PR's life and updated in place thereafter.
  const comments: IssueComment[] = await githubRequest(
    'GET',
    `/repos/${repo}/issues/${pr}/comments?per_page=100`,
  )
  const plan = planUpsert({ comments, marker, body })

  if (plan.action === 'skip') {
    console.log('no findings and no existing comment; nothing to do')
  } else if (plan.action === 'create') {
    await githubRequest('POST', `/repos/${repo}/issues/${pr}/comments`, {
      body: plan.finalBody,
    })
    console.log('created comment')
  } else {
    await githubRequest(
      'PATCH',
      `/repos/${repo}/issues/comments/${plan.commentId}`,
      {
        body: plan.finalBody,
      },
    )
    console.log(`updated comment ${plan.commentId}`)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
