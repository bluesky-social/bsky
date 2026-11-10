---
"@bsky/sdk": minor
"@bsky/jetstream": minor
---

Require `@atproto/lex` ^0.4.8 in the SDK and Jetstream, dropping support for the
0.3.x peer range. Upgrade development dependencies and generated schemas to the
new Lex release, which resolves the ambiguous `walk` export. Keep generated
schemas formatted with the new explicit `--pretty` codegen option.

Migrate the SDK lexicon manifest to version 2 for the upgraded installer without
changing retained lexicon URIs or CIDs. The installer prunes unused lexicons
already excluded from SDK code generation.

Require `@atproto/lex-cbor` ^0.1.10 in Jetstream. The fixed CBOR option
declarations no longer expose cborg's incompatible declarations, allowing strict
NodeNext consumers to keep `skipLibCheck: false`.
