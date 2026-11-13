---
"@bsky/sdk": patch
"@bsky/jetstream": patch
---

Support `@atproto/lex` 0.4.8 and newer 0.4 releases while retaining the existing
0.3.x peer range. Development builds now use 0.4.8.

Migrate the SDK lexicon manifest to v2 without removing vendored schemas, and
retain explicit formatting in code generation. Packed-consumer checks cover the
earliest and latest supported release in each Lex minor line.
