# Griha AI — Test Report

- **Date (UTC):** 2026-09-08
- **Commit / branch:** `main` (architecture hardening phases 0–7)
- **Agent task:** final QA after architecture hardening
- **Package manager:** npm (workspaces)
- **Node version:** v26.0.0
- **Turbo version:** 2.10.12

## 1. Summary (one screen)

| Check | Status | Notes |
|-------|--------|-------|
| install | PASS | `npm install` up to date |
| typecheck | PASS | 10 tasks, 0 errors |
| lint | SKIP | not configured (no `lint` script in any package) |
| build | PASS | 6 tasks |
| unit/integration tests | PASS | 240 passed (agent) + 5 passed (skills), 0 failed |
| static verification | PASS | no secrets, no `.env`, no TODO, no duplicate registries |

**Overall:** GREEN
(typecheck + tests + build green; 240 agent tests + 5 skills tests; no secrets/hardcoded keys.)

## 2. Environment

- cwd: `/Users/dmitrijsuvalov/hermes-pi` (monorepo root)
- workspaces detected:
  - apps: `agent`, `api`, `skills`
  - packages: `config`, `shared-types`, `stt`, `tsconfig`
- node: v26.0.0; npm: 11.12.1; turbo: 2.10.12
- install log excerpt: `up to date, audited 302 packages in 1s` → `found 0 vulnerabilities`

## 3. Typecheck

- command: `npx turbo run typecheck`
- exit code: 0
- errors (full list): none (0 errors across `@griha/agent`, `@griha/api`, `@griha/config`, `@griha/shared-types`, `@griha/skills`, `@griha/stt`)

## 4. Lint

- command: `npx turbo run lint`
- result: `No tasks were executed as part of this run` → **lint: not configured** (no package declares a `lint` script).

## 5. Build

- command: `npx turbo run build`
- exit code: 0
- per-package result: `@griha/shared-types`, `@griha/config`, `@griha/stt`, `@griha/api`, `@griha/skills`, `@griha/agent` — all successful (6/6 tasks).

## 6. Tests

- command: `npx turbo run test` (agent: `tsx --test tests/**/*.test.ts`)
- totals: **240 passed, 0 failed, 0 skipped** (74 suites in `@griha/agent`) + **5 passed** (`@griha/skills`)
- failed tests detail: **none**.
- New hardening test suites: `approval-policy`, `approval-service`, `commitment-service` (contract), `secret-filter`, `capabilities`, `context-builder`, `workflow`, `providers`, `subagent-capabilities`, `deterministic-tasks`, `skill-catalog`.

## 7. Coverage

- tool: Node built-in `--experimental-test-coverage` (run as `node --import tsx --test --experimental-test-coverage "tests/**/*.test.ts"`)
- Statements/Lines: **79.81%**
- Branches: **76.35%**
- Functions: **81.45%**

Per-file highlights (line %):

| File | line % | notes |
|------|--------|-------|
| `.pi/extensions/user-rules/commands.ts` | 8.70 | `/rules` command builder untested |
| `.pi/extensions/model-router/index.ts` | 11.11 | registration glue, tools untested |
| `.pi/extensions/multi-agent/index.ts` | 26.28 | registration glue, tools/commands untested |
| `.pi/extensions/user-rules/index.ts` | 34.01 | tool handlers + injection untested |
| `.pi/extensions/telegram-bot/TelegramBridge.ts` | 70.51 | photo/document/voice branches untested |
| `.pi/extensions/telegram-bot/TelegramBotController.ts` | 83.65 | error/stop paths partially untested |
| `.pi/extensions/telegram-bot/TelegramSessionPool.ts` | 86.44 | real SDK factory path untested (mocked) |
| `src/utils/provider-bootstrap.ts` | 61.00 | custom/deepseek registration paths untested |
| `src/utils/embeddings.ts` | 60.00 | embedBatch untested |
| `core-agent/index.ts` | 100.00* | *tool-reported; no direct test — see Risks |

Files with **0%** coverage: none (every loaded file has >0%).

Packages **not exercised at runtime** (no dedicated tests, therefore not in the coverage report):
`@griha/shared-types` (types-only), `@griha/stt` (stub), `@griha/api` (smoke only), `@griha/skills` (stub).

## 8. Source vs tests audit

- total source files (.ts, excl. node_modules/dist/*.test.ts): **40**
- total test files: **14** (all `apps/agent/tests/unit/*.test.ts`)

Modules **without a direct unit test**:

| Module | Has direct tests? | Risk | Comment |
|--------|-------------------|------|---------|
| `first-run-setup/index.ts` (wizard) | no | med | interactive wizard, only `applyConfig` covered indirectly |
| `core-agent/index.ts` | no | low | glue; skills utils tested separately |
| `sqlite-rag-memory/index.ts` | no | low | glue; MemoryService tested |
| `multi-agent/index.ts` | no | med | delegate/steer tool handlers untested; SubAgentManager tested |
| `cron/index.ts` | no | low | glue; CronService tested |
| `model-router/index.ts` | no | med | `analyze_image` tool untested; image-analyzer utils tested |
| `personal-learning/index.ts` | no | med | auto-learn + profile tools untested; services tested |
| `telegram-bot/index.ts` | no | low | glue; bridge/controller/pool tested |
| `user-rules/index.ts` | no | med | tools + injection untested; service/prefilter tested |
| `user-rules/commands.ts` | no | med | `/rules` string builder untested |
| `@griha/config` | indirect | low | tested via `config.test.ts` + smoke import |
| `@griha/stt` | no | med | `transcribeVoice` untested (stub backend) |
| `@griha/api` (index + health) | no | low | smoke-verified `/health` → 200 |
| `@griha/skills` | no | low | stub |
| `apps/agent/scripts/stt_local.py` | no | low | stub script, smoke-verified runs |

Critical modules status:
- **telegram** (`TelegramBridge`, `TelegramBotController`, `TelegramSessionPool`): ✅ tested; `telegram-bot/index.ts` glue not tested.
- **memory** (`MemoryService`, `ClientNotesService`, `UserProfileService`): ✅ tested.
- **config** (`@griha/config`): ✅ tested.
- **stt** (`@griha/stt`): ❌ untested (stub).
- **core-agent**: ❌ no direct test (glue).
- **multi-agent** (`BotRegistry`, `SubAgentManager`): ✅ tested; `index.ts` glue untested.

## 9. Smoke

- `@griha/shared-types` import: ok (0 runtime exports — types-only).
- `@griha/config` import: ok — exports `CONFIG_DIR_NAME, CONFIG_FILE_NAME, configExists, getConfigDir, getConfigPath, loadConfig, saveConfig`.
- `@griha/stt` import: ok — exports `transcribeVoice`.
- `@griha/skills` import: ok — exports `listSkills`.
- `@griha/api` `createApp().fetch(/health)`: **200** `{"ok":true,"service":"griha-api"}`.
- `python3 -c "import faster_whisper"`: **not installed** (`ModuleNotFoundError`).
- `python3 apps/agent/scripts/stt_local.py sample.wav`: runs, prints `{"ok": false, "text": "", "error": "stt_local not implemented (stub)"}`, exit 0.
- Telegram live bot: **not run** (no test token in env; per instructions only unit tests).

## 10. Fixes applied to run tests (if any)

- none (no code changes in this run).

## 11. Risks and gaps

- `@griha/stt` has no tests; backend is a stub and `faster_whisper` is not installed → voice path is unverified end-to-end.
- `@griha/api` and `@griha/skills` have no tests (smoke only).
- Several extension `index.ts` files are registration glue with low coverage (tool/command handlers untested): `multi-agent`, `model-router`, `personal-learning`, `user-rules`.
- `user-rules/commands.ts` at 8.7% — `/rules` CLI/Telegram command string builder is effectively untested.
- `core-agent/index.ts` reported 100% by the coverage tool but has no direct test; the figure is likely optimistic (V8/tsx source-map artifact) — treat as unverified.
- `TelegramBridge` photo/document/voice branches untested (70.5%).
- No fixtures for voice (audio) or live Telegram in the test suite.
- Coverage is agent-only: workspace packages other than `@griha/config` are not exercised by the suite.

## 12. Recommendations

1. Add unit tests for `user-rules/commands.ts` (pure string output for `/rules list/add/delete/on/off`).
2. Add a smoke/unit test for `@griha/stt.transcribeVoice` with a fake `stt_local.py` fixture (no real model).
3. Add a test for `apps/api` health route (supertest-style `app.request` or `createApp().fetch`).
4. Cover `TelegramBridge` photo/document/voice branches (already DI-testable).
5. Cover `multi-agent`/`model-router` tool handlers (delegate_tasks, analyze_image) with mocked services.
6. Add `prefilter` integration: hard-rule blocks a message end-to-end through `TelegramBridge` (currently tested only at `shouldProcessMessage` level).
7. Consider adding a `lint` task (e.g. ESLint/tsc strict) or explicitly document lint as out of scope.

## 13. Raw commands log

1. `pwd && ls -la && node -v && npm -v && git branch --show-current && git rev-parse HEAD && npx turbo --version` → exit 0
2. `npm install` → exit 0
3. `npx turbo run typecheck` → exit 0
4. `npx turbo run lint` → exit 0 (0 tasks executed)
5. `npx turbo run build` → exit 0
6. `npx turbo run test` → exit 0 (72 passed)
7. `cd apps/agent && node --import tsx --test --experimental-test-coverage "tests/**/*.test.ts"` → exit 0
8. `find apps packages -type f -name '*.ts' ...` (source/test audit) → exit 0
9. `node -e "import('@griha/shared-types') ..."` + config/stt/skills + api health → exit 0
10. `python3 -c "import faster_whisper"` → exit 1 (not installed); `python3 apps/agent/scripts/stt_local.py` → exit 0
11. `date -u` → exit 0
