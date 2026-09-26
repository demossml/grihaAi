# STATUS

## Current

- Learning: audit done (L0 call graph — docs/LEARNING_AUDIT_REPORT.md).
- Learning: L1 experience wire (turn_end + pool finish → TurnExperienceStore, idempotent).
- Learning: L2 quality wire (SkillQualityTracker.recordOutcome success/fail).
- Learning: L3 review lessons → routeLesson → handlers (no skill auto-apply).
- Learning: L4 gated skill proposals from repeated procedural evidence.
- Learning: L5 active skill version loader + eval gate + rollback (L0–L5 done).
- Core: Flash router + Generation policy (flags default OFF); pool wire; obs v2.
- Phase: report tool timeout (data 30s / render 90s) + flash_error diagnostics + cheap fallback.
- Secretary n2: silence, reminders (Moscow TZ, auto_reminders before add), participants, record expense.
- Security: execute_code runsc/refuse, env scrub, OCR injection scan, session trust (default untrusted).

## Enable on server

```
GRIHA_FLASH_ROUTER=1 GRIHA_GENERATION_POLICY=1

# GRIHA_OBS=1 default
```

## Docs canon

See README Documentation table. Detailed principles: docs/ARCHITECTURE.md.
