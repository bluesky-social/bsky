---
"@bsky/sdk": minor
"@bsky/jetstream": minor
---

Require `@atproto/lex` ^0.4.7 in the SDK and Jetstream, dropping support for the
0.3.x peer range. Upgrade development dependencies and generated schemas to the
new Lex release, which resolves the ambiguous `walk` export. Keep generated
schemas formatted with the new explicit `--pretty` codegen option.

Migrate the SDK lexicon manifest to version 2 for the upgraded installer without
changing retained lexicon URIs or CIDs. The installer prunes unused lexicons
already excluded from SDK code generation.

Strict NodeNext consumers with `skipLibCheck: false` remain blocked by TS2834 in
the transitive `cborg@4.5.8` declarations. This upgrade does not fix that upstream
compatibility issue.
