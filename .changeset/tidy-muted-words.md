---
'@bsky/sdk': patch
---

Optimize mute-word matching by reusing regular expressions and preparing post text and punctuation variants once per call.
