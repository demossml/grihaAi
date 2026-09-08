---
name: approval-thresholds
description: User-defined financial approval policy. Use when deciding whether a monetary action needs confirmation.
tags: [system, finance, approval]
---

# Approval Thresholds

Financial approval is governed by a structured policy, not by model guesswork.

## Policy shape
- `currency`
- `autoApproveBelow` — auto-approve amounts up to this value.
- `alwaysConfirmAbove` — always confirm amounts at/above this value.
- `categoriesAlwaysConfirm` — categories that always require confirmation.

## Workflow
1. For a monetary action, read the policy with `policy_get`.
2. Decide with `approval_required` (pass `amount`, `currency`, `category`).
3. If no policy is set, the default is conservative: confirm everything.

## Rules
- Never hardcode amounts or thresholds in the prompt.
- The policy always takes precedence over any model assumption.
- The user may set/update the policy with `policy_set` — but changing the policy
  itself requires explicit user consent.
