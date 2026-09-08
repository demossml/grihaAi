---
name: human-approval-gate
description: Gate for side-effect and high-risk actions. Use before sending messages on the user's behalf, financial operations, deletions, purchases, external publications, or changing critical settings.
tags: [system, safety, approval]
---

# Human Approval Gate

Some actions must not run until the user explicitly confirms them.

## Action classes
- `READ_ONLY` — run freely.
- `REVERSIBLE_LOW_RISK` — run automatically only when user rules allow it.
- `SIDE_EFFECT` — needs confirmation unless an explicit safe policy exists.
- `HIGH_RISK / IRREVERSIBLE` — always needs explicit confirmation.

## Workflow
1. Before any side-effect action, call `approval_required` with the action name
   and (for financial actions) `arguments: { amount, currency, category }`.
2. If the tool returns `required: false` — proceed.
3. If it returns `required: true` — DO NOT perform the action. Show the user the
   request id and wait for `/approve <id>` or `/deny <id>`.
4. Re-check with `approval_status` before executing; proceed only on `granted`.

## Rules
- One approval covers one concrete action + arguments + target + session. Never
  reuse an approval for a different action.
- High-risk examples: sending a message on the user's behalf, changing/cancelling
  a commitment, financial operation, purchase, deletion, external publication,
  changing critical settings.
- If the user has granted approval and the action fails, do not silently retry —
  request a fresh approval.
