# Status — Phase 3 (latest Hermes aligned)

- [x] Scaffold + modern types (BotConfig, layered memory)
- [x] Test harness green
- [x] Hybrid FTS5 memory (facts + session search + listRecentFacts)
- [x] `memory_add` / `memory_search` tools via pi extension
- [x] Skills discovery + `autoCreated` + prompt formatting (`src/utils/skills.ts`)
- [x] `skills/core/SKILL.md` (manager/secretary/accountant + memory policy)
- [x] `core-agent` extension (skills injection + closed loop + `/skills`)
- [x] README + .gitignore
- [x] File-backed Bot registry (Bot Mode spirit)
- [x] `multi-agent` extension (`/bots`, `/bots-create`)

## Phase 0.5 / 1b — First-run interactive setup

- [x] First-run interactive setup wizard
- [x] Config saved to ~/.grish-ai/config.json
- [x] /setup and /model commands
- [x] On first launch user chooses provider + model and can talk immediately

## Phase 1c — Provider + specific model selection

- [x] First-run wizard lets user choose provider AND concrete model from a list
- [x] DeepSeek is present with deepseek-v4-pro and deepseek-v4-flash-vision-exp
- [x] /model command allows changing model later
- [x] Custom model name is always possible

## Phase 4 — Vector Memory
- [x] EmbeddingService (pluggable; deterministic fallback — sqlite-ai/sqlite-rag not on npm)
- [x] Vectors stored for every new fact
- [x] Hybrid search (vector + FTS5 + RRF)
- [x] memory_search now understands meaning
- [x] Tests green (including semantic retrieval test)
- [x] DeepSeek and other providers still work

## Phase 5 — Smart Delegation
- [x] Adaptive routing (SIMPLE / COMPLEX)
- [x] Автоматическое разбиение задачи
- [x] Запуск нескольких субагентов
- [x] Изолированная память субагентов (subtreeSessionId)
- [x] Shared Insights layer
- [x] Tools: delegate_tasks, check_subagents, get_shared_insights
- [x] Tests green

## Phase 6 — Live Steering
- [x] SubAgentState + live tracking
- [x] list_subagents / steer_subagent tools
- [x] /status, /steer, /stop commands
- [x] Возможность остановить с сохранением partial result
- [x] Tests green

## Phase 7 — Cron with Memory
- [x] CronJob + continuity + monitorMode + notepad
- [x] Durable storage in sqlite
- [x] Tools + CLI
- [x] Background tick
- [x] Tests green

## Phase 8 — Telegram Bot
- [x] TypeScript only (grammy)
- [x] Long polling (без webhook)
- [x] Белый список пользователей
- [x] Двусторонняя связь с Гришей (реальный агент, не эхо-заглушка)
- [x] Изолированные сессии на пользователя (`TelegramSessionPool`, отдельный `AgentSession`/sessionId на `tg:<userId>`)
- [x] Поддержка текста и фото
- [x] /telegram-setup и статус
- [x] Tests green

## Phase 9 — Personal Learning
- [x] UserProfile layer
- [x] Client Notes (procedural)
- [x] Auto-extraction of facts/preferences/notes
- [x] Подмешивание профиля и заметок в контекст
- [x] /profile, /notes, /learn
- [x] Tests green
- [ ] Auto skill improvement (отложено)

## Phase 10 — Multi-Model Routing
- [x] Конфиг models.main + models.vision
- [x] ModelRouter
- [x] Tool analyze_image (OCR / describe)
- [x] Интеграция с Telegram (фото уходит к Main Brain)
- [x] /model и /setup умеют настраивать vision
- [x] Flash отсутствует (осознанно)
- [x] Tests green

**Initial Working Project reached — ready for further phases (hard isolation, gateway).**
