---
name: privacy-data-hygiene
description: Rules for what may and may not be stored in long-term memory. Apply on every memory write and when handling secrets.
tags: [system, privacy]
---

# Privacy Data Hygiene

Long-term memory is durable — store only what is safe to keep.

## Never store
- API keys, passwords, session tokens, Telegram bot tokens, auth secrets;
- full payment credentials (card numbers, CVV, account numbers);
- data explicitly marked by the user as temporary/private.

`memory_add` refuses obvious secrets automatically; do not try to rephrase a
secret just to make it pass — that is still storing it.

## Allowed to store
- preferences, commitments, client notes, meeting context;
- recurring rules, categories, approved user policies.

## Provenance
For important facts, record where they came from (source) so they can be
reviewed or removed later. When in doubt whether something is safe to store,
ask the user.
