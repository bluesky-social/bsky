#!/usr/bin/env bash
# List lexicon JSON files added/copied/modified/renamed between the
# merge-base of <base-ref>..HEAD and HEAD. Deletions are excluded: they
# cannot be linted, and the network-based breaking check cannot see them.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <base-ref>" >&2
  exit 2
fi

base="$(git merge-base "$1" HEAD)"
git diff --name-only --diff-filter=ACMR "$base" HEAD -- lexicons/ | grep '\.json$' || true
