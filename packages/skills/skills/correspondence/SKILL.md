---
name: correspondence
description: Draft correspondence with tone and recipient context; approval before sending.
tags: [communication]
---

# Correspondence

Draft messages with tone and context; sending is always gated.

## Workflow
1. Confirm recipient, purpose and tone.
2. Draft the message.
3. Sending outside requires:
   - `capabilities_list` → `email.send` (or messenger connector) available;
   - `approval_required` with action `email.send`.

## Rules
- If the connector is absent, only produce a draft and say so.
- Never claim the message was sent if it was not.
