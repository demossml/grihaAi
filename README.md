# grish-ai

Modern rewrite of the core capabilities of the **Nous Research Hermes Agent** on top of **pi.dev**, aligned with latest Hermes (2026): closed learning loop, layered memory, named Bot Mode, and autonomous skill creation.

## Stack

- **Platform**: [pi.dev](https://pi.dev) — `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`
- **Language**: TypeScript (strict, NodeNext/ESM)
- **Memory**: `better-sqlite3` + FTS5 (sqlite-rag / sqlite.ai compatible hybrid memory)
- **Tests**: `node:test` via `tsx`

## Final agent role

Professional assistant for a **manager / secretary / accountant** — scheduling, documents, reports, communication, research, meeting notes, light financial support. Coding tools are secondary.

## Features (initial working project)

- Hybrid FTS5 memory — durable facts, session search, recent-facts listing (`memory_add` / `memory_search`)
- Skills with `autoCreated` support (agentskills.io frontmatter, closed learning loop)
- Named Bot registry (Bot Mode spirit)
- pi extensions: `sqlite-rag-memory`, `core-agent`, `multi-agent`
- Strict tests + clean TypeScript

## Project structure

```
grish-ai/
├── package.json
├── tsconfig.json
├── .pi/settings.json
├── .pi/extensions/
│   ├── sqlite-rag-memory/   # hybrid memory + memory tools
│   ├── core-agent/          # skills injection + /skills
│   └── multi-agent/         # Bot Mode registry + /bots commands
├── skills/
│   └── core/SKILL.md        # manager/secretary/accountant core skill
├── src/
│   ├── types/               # shared TypeBox schemas + types
│   └── utils/               # skills discovery/formatting
├── tests/
│   ├── unit/
│   ├── integration/
│   └── setup.ts
└── README.md
```

## Commands

```bash
npm install       # install dependencies
npm run build     # compile to dist/
npm test          # run tests
npm run typecheck # strict type check
```

## Status

See [STATUS.md](./STATUS.md) for phase-by-phase progress.

## Telegram bot (long polling)

Встроенный Telegram-бот работает через **long polling** (без webhook).

```bash
# 1. Создать бота в @BotFather и получить токен

# 2. В pi: настроить токен и whitelist
/telegram-setup
```

Полезные команды:

- `/telegram-setup` — интерактивная настройка токена и списка разрешённых `user_id`
- `/telegram-status` — статус бота (токен, whitelist, запущен ли polling)
- `/telegram-start` — запустить long polling
- `/telegram-stop` — остановить long polling

## Constraints honored

- Platform: only pi.dev, all application code in TypeScript
- Storage: only sqlite-rag / sqlite.ai (better-sqlite3 + FTS5)
- Excluded: billing, monetization, payment tracking, trajectory generation for training/sale
