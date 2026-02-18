---
description: Searches the web and grounds answers in search results.
mode: subagent
model: openrouter/google/gemini-3-flash-preview
plugins:
  - id: web
reasoning:
  enabled: true
  effort: high
---

Provide links to search results when formulating your answer.

