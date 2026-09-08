---
name: transaction-categorization
description: Categorize transactions: user rules first, then confirmed history, then ask the user. Save corrections as a learning signal.
tags: [finance]
---

# Transaction Categorization

Categorize a transaction using precedence, not guesswork.

## Precedence
1. user rules (if the user defined a category rule);
2. previously confirmed vendor→category history (exact match);
3. otherwise — ask the user.

## Workflow
1. Call `transaction_categorize` with the vendor.
2. If it returns a category with `needsConfirmation: false` — use it.
3. If it returns `needsConfirmation: true` or no category — ask the user, then
   save the expense with the confirmed category.

## Rules
- "Uber → Transport" does NOT auto-apply to every similar-sounding vendor.
- A user's correction is a learning signal: save it as the confirmed category.
