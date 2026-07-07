# bsky

TypeScript monorepo for Bluesky packages published under the [`@bsky.app`](https://www.npmjs.com/org/bsky.app) npm organization.

## Layout

- `packages/*` — publishable libraries (node-only and isomorphic)
- `services/*` — private service entrypoints (not published)
- `tsconfig/*` — shared TypeScript presets (`node`, `isomorphic`, `tests`)

## Development

Requires Node.js >=22.12 and pnpm 11 (enforced via `devEngines`).

```sh
pnpm install
pnpm build      # tsgo project builds, topological
pnpm typecheck  # tsgo --build tsconfig.json
pnpm lint       # eslint
pnpm format     # prettier --write
pnpm test       # vitest
pnpm verify     # format:check + lint + typecheck + test (what CI runs)
```

## Package conventions

- ESM-only: `"type": "module"`, single-entry `exports` with `types` + `default` conditions
- Built with `tsgo --build tsconfig.build.json` into `dist/`
- `tsconfig.json` is references-only, pointing at `tsconfig.build.json` (and `tsconfig.tests.json` if present), which extend a preset from `tsconfig/`
- Tests live in `tests/` and run with vitest via a per-package `vitest.config.ts`
- New packages must be added to the root `tsconfig.json` `references` list

## Releases

Versioning and publishing are handled by [changesets](https://github.com/changesets/changesets). Every PR that changes a published package needs a changeset (`pnpm changeset`); merges to `main` open/refresh a "Version packages" PR, and merging that publishes to npm with provenance.

## License

This project is dual-licensed under MIT and Apache 2.0 terms:

- MIT license ([LICENSE-MIT.txt](LICENSE-MIT.txt) or http://opensource.org/licenses/MIT)
- Apache License, Version 2.0, ([LICENSE-APACHE.txt](LICENSE-APACHE.txt) or http://www.apache.org/licenses/LICENSE-2.0)

Downstream projects and end users may chose either license individually, or both together, at their discretion. The motivation for this dual-licensing is the additional software patent assurance provided by Apache 2.0.

Bluesky Social PBC has committed to a software patent non-aggression pledge. For details see [the original announcement](https://bsky.social/about/blog/10-01-2025-patent-pledge).
