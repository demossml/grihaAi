# Griha AI — Architecture & Operating Principles

Griha is a TypeScript monorepo agent for Telegram (and CLI): one process per company deployment, long-polling bot, SQLite/JSON state under `~/.grish-ai/`, tools for documents/expenses/reports, optional Flash routing and token budgets.

## 1. High-level diagram

```
                ┌─────────────────────────────────────┐
                │           Telegram API              │
                └─────────────────┬───────────────────┘
                                  │ long polling
                ┌─────────────────▼───────────────────┐
                │     telegram-bot extension          │
                │  normalize → dedup → bridge         │
                └─────────────────┬───────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
 ┌────────────────┐    ┌──────────────────┐    ┌─────────────────┐
 │ Gate / prefilter│    │ Media pipeline   │    │ Secretary side  │
 │ ACL, mention,   │    │ download→OCR→    │    │ detect reminder │
 │ groupConfigured │    │ archive→expense  │    │ participants    │
 └────────┬───────┘    └────────┬─────────┘    └────────┬────────┘
          │  allowed agent path only        silent create
          ▼
 ┌────────────────────────────────────────────────────┐
 │              TelegramSessionPool                    │
 │  correlationId → preparePoolRouting → setModel      │
 │  → session.prompt (pi agent + tools) → restore      │
 └────────────────────────┬───────────────────────────┘
                          │
     ┌────────────────────┼────────────────────┐
     ▼                    ▼                    ▼
 ┌───────────────┐ ┌────────────────┐ ┌────────────────┐
 │ Rule + Flash  │ │ Generation     │ │ Tools / skills │
 │ Router        │ │ Policy budget  │ │ report-data,   │
 │ role,kind,cx  │ │ maxTokens,temp │ │ expenses, PDF  │
 └───────────────┘ └────────────────┘ └────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │ Observability        │
              │ JSONL ~/.grish-ai/obs │
              └──────────────────────┘
```

## 2. Principles (normative)

### 2.1 Single company instance
One Griha process serves one deployment (one bot token, one `~/.grish-ai`). A second company = second process.

### 2.2 Code over prompt for hard rules
Access control, group silence, mention gates, dedup, budget ceilings — enforced in TypeScript. The LLM cannot override gate/prefilter.

### 2.3 Tools own facts; LLM owns language
Money totals, expense lines, archive rows come from SQLite/tools (`report-data`, expenses, `group_history`). The model must not invent totals. Routing kind `report_dispatch` injects guidance to call tools.

### 2.4 Cheap path first
Routing: deterministic **rules** before Flash LLM. Flash is a **classifier**, not the main analyst. Generation model may be Flash for simple roles when wired; Pro/main for analysis.

### 2.5 Explicit scope
- **Group message** → data scope = that `chatId` only.
- **Private DM** → multi-group by title + ACL; never cross-group from inside a work group.

### 2.6 Silence by default in groups
Pending / not configured → no agent replies. Secretary/listen modes → reply only on mention/reply (plus scheduled reminder outbound).

### 2.7 Observability without secrets
JSONL events with `correlationId`; no raw user text, no tokens/api keys in logs.

### 2.8 Flags default OFF for new cost controls
`GRIHA_FLASH_ROUTER`, `GRIHA_GENERATION_POLICY` default off → behavior matches legacy until enabled.

## 3. Monorepo packages (conceptual)

| Area | Location |
|------|----------|
| Agent + Telegram | `apps/agent` |
| Shared types/config | `packages/*` |
| Observability | `packages/observability` |
| Report data / PDF | `packages/report-data`, `packages/render-tools` |
| Skills text | `packages/skills` |

## 4. Data on disk (`~/.grish-ai/`)

| Path | Purpose |
|------|---------|
| `config.json` | bot token, models, ACL (never log secrets) |
| `chat-setup.json` | group setup status, scenario |
| `documents.sqlite` | archive, expenses, media meta, dedup |
| `group-reminders.sqlite` | reminders |
| `group-participants.sqlite` | roles registry |
| `obs/events-*.jsonl` | observability |
| sessions | pi session files per sessionKey |

## 5. Related docs

- [TELEGRAM-BOT.md](TELEGRAM-BOT.md) — pipeline detail
- [SECRETARY.md](SECRETARY.md) — secretary contract
- [FLASH_ROUTER.md](FLASH_ROUTER.md) — routing
- [GENERATION_POLICY.md](GENERATION_POLICY.md) — tokens/temperature
- [OBSERVABILITY.md](OBSERVABILITY.md) — events
- [SECURITY.md](SECURITY.md) — sandbox & injection
