## Run / Test

Install workspace dependencies from the repository root:

```bash
pnpm install
```

Run the dev server:

```bash
pnpm --filter @bsky/sdk build
pnpm --filter @bsky/embed dev
```

You can see the embed homepage at http://localhost:5173

### Testbed

In another terminal window, run the snippet dev script:

```bash
pnpm --filter @bsky/embed dev-snippet
```

You can then see the testbed page at http://localhost:5173/test

The root `pnpm build` builds the SDK first, then the embed page bundle and
snippet in `services/bskyembed/dist`. The root lint, typecheck, and CI jobs
cover this private service. Production `embedr` in `social-app` still builds
its local copy until deployment is migrated separately.
