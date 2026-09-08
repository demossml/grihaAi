# Security — изоляция и периметр

## 1. Периметр (что может выполнять недоверенный код или обрабатывать внешний ввод)

| Поверхность | Что делает | Риск |
|---|---|---|
| **Субагенты** (`createRealSubAgentRunner`) | Изолированный `AgentSession` с инструментами pi (`read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`) | LLM может вызвать `bash`/`edit`/`write` — code-execution / файловая мутация |
| **Cron-задачи** (`createRealCronRunner`) | Тот же `SubAgentRunner`-путь + автономность по расписанию | То же + выполнение без человека в цикле |
| **Входящие файлы от Telegram** | Фото → vision (base64), документ → описание, голос → faster-whisper | Данные, не исполняемый код; риск — имена файлов/декодирование/будущие файловые тулзы |
| **Будущие инструменты** с shell/code-execution | TBD | Выполнение произвольного кода |

## 2. Модель доверия

- **`trusted`** — основная интерактивная сессия (владелец в UI) и Telegram-сессии владельца. Инструменты pi работают как обычно.
- **`untrusted`** — сессии субагентов и cron (создаются через `createRealSubAgentRunner`; помечаются в `src/sandbox/gateway-context.ts` сразу после `bindExtensions`). Для них gateway запрещает shell и мутацию файлов.

## 3. Слои защиты (defense-in-depth)

Каждый слой — дополнение, а не замена предыдущего:

1. **Whitelist Telegram** — `allowedUserIds` (`TelegramBridge.isAllowed`): входящие сообщения принимаются только от разрешённых `user_id`.
2. **Prefilter user-rules** — `shouldProcessMessage` (hard rules): «отвечай только мне»-правила блокируют сообщение ещё до LLM (0 токенов).
3. **Gateway** — единая точка проверки side-effect tool-calls (см. §4).
4. **Sandbox** — изоляция исполнения кода, когда оно разрешено (см. §5).

> Примечание: отдельного rate-limiter в коде сейчас нет (whitelist + prefilter — это текущие ограничители). Если он появится, это будет ещё один слой между whitelist и gateway.

## 4. Gateway (`apps/agent/.pi/extensions/gateway`)

Единственный chokepoint для tool-calls с side-effects. Слушает `pi.on("tool_call")` (до выполнения) и применяет политику из `src/utils/gateway-policy.ts` — **не** встраивается в каждый extension.

| Инструмент | trusted | untrusted |
|---|---|---|
| `read`, `grep`, `find`, `ls` | ✅ | ✅ |
| `bash`, `powershell` | ✅ | ❌ «shell execution is disabled» |
| `edit`, `write` | ✅ | ❌ «file mutation is disabled» |
| кастомные (safe) | ✅ | ✅ (в саб-сессиях биндятся только безопасные расширения) |

SDK позволяет заблокировать вызов: обработчик возвращает `{ block: true, reason }` (`ToolCallEventResult`). Контекст доверия берётся из `ctx.sessionManager.getSessionId()` → `getSessionTrust()`.

## 5. Sandbox (`src/sandbox`)

`SandboxProvider` — DI-интерфейс (§7 ARCHITECTURE.md) для реального выполнения кода, если оно появится в будущих инструментах:

```ts
interface SandboxProvider {
  readonly kind: "dev" | "runsc";
  run(options: SandboxRunOptions): Promise<SandboxResult>;
}
```

- **`dev`** (`LocalSandboxProvider`) — обычный `child_process`, только для локальной разработки.
- **`runsc`** (`RunscSandboxProvider`) — **gVisor** (userspace-ядро): `runsc do --rootless --network=none -- <cmd>`. Сильнее обычного контейнера (своё ядро-эмуляция), дешевле microVM. Выбор согласован с пользователем (gVisor/runsc); путь и network-политика конфигурируемы, без привязки к облачному вендору.

Выбор бэкенда — через `createSandboxProvider("dev" | "runsc", options)`, не зашит в инструменты.

## 6. Почему не обычный контейнер

Контейнер делит ядро хоста; эксплойт ядра = побег из контейнера. Поэтому для по-настоящему недоверенного кода берут microVM (Firecracker/Kata) или, как компромисс по стоимости/скорости, gVisor (userspace-ядро). В griha-ai субагенты сейчас **вообще не исполняют shell** (gateway блокирует), а `runsc`-бэкенд — готовый задел для будущих code-execution-инструментов.

## 7. Известные ограничения

- Telegram-сессии пока `trusted` (bash доступен). При необходимости их можно пометить `untrusted` тем же механизмом.
- `runsc`-бэкенд требует установленного gVisor (`https://gvisor.dev`); без него возвращает ошибку spawn.
- Rate-limiting не реализован.
- Это архитектурный задел: сейчас нет инструмента, который реально выполняет произвольный код через `SandboxProvider`.
