---
name: delegation-triage
description: Decide whether a task should be delegated to sub-agents or done directly. Use before calling delegate_tasks.
tags: [system, delegation]
---

# Delegation Triage

Delegation has overhead (isolated sessions, context transfer). Do not delegate
tasks that are cheaper to do directly.

## Never delegate
- short reminders ("напомни в 15:00");
- simple memory CRUD (add/search a fact);
- simple lookups/lists;
- simple classifications.

## Consider delegating
- research across many sources;
- multi-document analysis;
- complex reports;
- independent long-running tasks.

## Workflow
1. Classify the task (SIMPLE / COMPLEX) with the adaptive router.
2. For SIMPLE — do it yourself.
3. For COMPLEX — you may call `delegate_tasks`, then `check_subagents`, then
   `get_shared_insights` and produce the final answer.
4. Delegation is a suggestion, not an obligation — if doing it directly is
   simpler and safer, do it directly.
