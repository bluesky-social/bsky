# Local lexicon dependencies

These schemas are inputs to SDK code generation that do not live in this
repository's root `lexicons/` directory. They include `com.atproto.*` schemas
and their unpublished `tools.ozone.*` transitive dependencies.

Code generation exports `com.atproto.*` through `@bsky/sdk/lexicons`, while the
Ozone dependencies are used only to resolve references.

Bluesky-owned schemas must live in the repository's root `lexicons/` directory,
not here.
