---
name: inbox-triage
description: Classify, prioritize and summarize incoming mail; draft replies and actions. Without an email connector, never read Gmail automatically.
tags: [communication]
---

# Inbox Triage

Classify and prioritize incoming messages.

## Workflow (when an email connector exists)
email → classify → priority → summarize → action/label/draft.

## Rules (today)
- `email.read` is absent: do NOT read Gmail automatically and do not claim to.
- If the user pastes an email, classify and summarize it, and prepare a draft
  action/reply (send only via `correspondence` + approval).
