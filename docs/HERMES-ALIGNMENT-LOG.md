# Hermes Alignment Log (H1–H4)

Серия: убрать бесконечный/долгий DeepSeek thinking → быстрые ответы; чуть
усилить tool-discipline. Порядок строгий: H1 → H2 → H3 → H4.

---

## Phase H1 — Baseline (только факты, код приложения не менялся)

**Статус: PASS** (предусловие H2 подтверждено).

### 1. Версии
- `apps/agent/package.json`: `@earendil-works/pi-ai: ^0.85.1`,
  `@earendil-works/pi-coding-agent: ^0.85.1`.
- Установлено (node_modules): `pi-ai 0.85.1`, `pi-coding-agent 0.85.1`.
- pi-ai js: `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`.

### 2. provider-bootstrap — makeModel (apps/agent/src/utils/bootstrap/provider-bootstrap.ts:20–33)

```ts
export function makeModel(
  id: string,
  name?: string,
  opts?: { vision?: boolean },
): ProviderModelConfig {
  return {
    id,
    name: name ?? id,
    reasoning: false,
    input: opts?.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}
```

### 3. pi-ai 0.85.1 — DeepSeek thinking (openai-completions.js)

thinkingFormat определяется как `"deepseek"`, когда провайдер DeepSeek (строка 1288):

```
1288:        thinkingFormat: isDeepSeek
1289:            ? "deepseek"
```

Ветка deepseek (строки 681–690):

```
681:    else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
682:        if (options?.reasoningEffort) {
683:            params.thinking = { type: "enabled" };
684:        }
685:        else if (model.thinkingLevelMap?.off !== null) {
686:            params.thinking = { type: "disabled" };
687:        }
688:        if (options?.reasoningEffort && compat.supportsReasoningEffort) {
689:            params.reasoning_effort = ...
690:        }
691:    }
```

**Вывод**: при `model.reasoning === true` и отсутствии `reasoningEffort`
pi-ai шлёт `thinking: { type: "disabled" }` для DeepSeek
(`model.thinkingLevelMap?.off` → `undefined !== null` → true, ветка disabled
выполняется). Путь к `type: "disabled"` СУЩЕСТВУЕТ → стоп-критерий не сработал,
H2 разрешён.

`model.reasoning` — все вхождения: строки 634, 645, 654, 660, 666, 681, 693,
705, 711, 718, 727, 731, 774, 910, 1046.

### 4. STYLE_BLOCK — в user message, не system

`apps/agent/.pi/extensions/telegram-bot/TelegramSessionPool.ts`:

```
38:  const STYLE_BLOCK = "[STYLE]\nlength: short\nverbosity: low\n[/STYLE]";
322:      // R-GR-3: rulesContext — явный per-turn префикс (не только первый ход).
324:      const fullMessage = rulesContext
325:        ? `${rulesContext}\n\n${STYLE_BLOCK}\n\n${message}`
326:        : `${STYLE_BLOCK}\n\n${message}`;
327:      await session.prompt(fullMessage, {
```

`session.prompt(fullMessage, ...)` — это **user**-сообщение хода
(первый аргумент `prompt()`), а не system. Ожидание подтверждено.

### 5. Tool-use guidance

Поиск по `packages/skills/skills/core/SKILL.md` (`вызови инструмент`, `call the
tool`, «инструмент,» и т.п.): **явного guidance НЕТ**. Будет добавлено в H4.

### Полный stdout скрипта `scripts/hermes-audit/h1-baseline.sh`

```
=== makeModel reasoning ===
28:    reasoning: false,
=== STYLE_BLOCK ===
38:const STYLE_BLOCK = "[STYLE]\nlength: short\nverbosity: low\n[/STYLE]";
325:        ? `${rulesContext}\n\n${STYLE_BLOCK}\n\n${message}`
326:        : `${STYLE_BLOCK}\n\n${message}`;
pi-ai js: node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js
634:    if (compat.thinkingFormat === "zai" && model.reasoning) {
636:        zaiParams.thinking = options?.reasoningEffort ? { type: "enabled", clear_thinking: false } : { type: "disabled" };
645:    else if (compat.thinkingFormat === "qwen" && model.reasoning) {
654:    else if (compat.thinkingFormat === "qwen-chat-template" && model.reasoning) {
660:    else if (compat.thinkingFormat === "chat-template" && model.reasoning) {
666:    else if (compat.thinkingFormat === "baseten" && model.reasoning) {
681:    else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
686:            params.thinking = { type: "disabled" };
693:    else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
705:    else if (compat.thinkingFormat === "ant-ling" && model.reasoning && options?.reasoningEffort) {
711:    else if (compat.thinkingFormat === "together" && model.reasoning) {
718:    else if (compat.thinkingFormat === "string-thinking" && model.reasoning) {
727:    else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
731:    else if (!options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
737:    // Cap reasoning with a top-level budget field. Independent of thinkingFormat: the
774:    if (!options?.reasoningEffort || !model.reasoning)
910:        const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
1046:                model.reasoning &&
1288:        thinkingFormat: isDeepSeek
1339:        thinkingFormat: model.compat.thinkingFormat ?? detected.thinkingFormat,
```

### Итог H1
Код приложения не изменён (только скрипт + этот лог). Baseline тестов перед
серией: 850/850 unit green, turbo typecheck/build 12/12 (из P09).

---

## Phase H2 — Фикс скорости: reasoning: true (одна правка)

**Статус: PASS**.

### Изменение кода (ровно одна логическая строка)

`apps/agent/src/utils/bootstrap/provider-bootstrap.ts` — `makeModel`:

```diff
-    reasoning: false,
+    // H2: true → pi-ai emits thinking:{type:"disabled"} for DeepSeek V4.
+    // false → parameter omitted → API may run unbounded reasoning (slow).
+    reasoning: true,
```

Других файлов логики не трогали.

### Тест

Новый `apps/agent/tests/unit/provider-bootstrap-reasoning.test.ts`
(node:test, как соседние): 2 кейса — `reasoning === true` для основной и
vision-модели. До правки — красный, после — зелёный (2/2 PASS).

Существующих тестов с ожиданием `reasoning: false` в `apps/agent/tests` НЕТ
(grep пуст) — ничего не переписывалось.

### Проверки

- `npx tsx --test tests/unit/provider-bootstrap-reasoning.test.ts` → 2 pass / 0 fail.
- `npx turbo run typecheck test build` → **все tasks successful**
  (typecheck/build 12/12, test 8/8).
- `git diff --stat` H2:

```
 apps/agent/src/utils/bootstrap/provider-bootstrap.ts | 4 ++--
 apps/agent/tests/unit/provider-bootstrap-reasoning.test.ts | 19 +++++++++++++++++++
```

**H3 — за человеком (рестарт процесса + DM «Сколько будет 2+2?»).**

---

## Phase H3 — Live smoke

**Статус: DELEGATED — NOT RUN агентом (нет доступа к прод-процессу бота).**

Инструкция человеку:

1. Задеплоить/рестартнуть процесс Гриши на проде (systemd `griha-ai`):
   `systemctl --user restart griha-ai` (+ при необходимости `git pull`).
2. В **личке** боту отправить: `Сколько будет 2+2?`
3. Зафиксировать в этом логе:
   - пришёл ли ответ;
   - есть ли текст «Слишком долго обрабатываю запрос»;
   - грубо время до ответа.

PASS: ответ есть, timeout-сообщения нет, субъективно быстрее. FAIL: timeout
остался → не откатывать H2 без решения человека, в лог гипотезы
(не тот процесс, кэш сборки, другая модель, ошибка в H1).

---

## Phase H4 — Tool-use enforcement (только skill-текст)

**Статус: PASS.**

### Изменение

`packages/skills/skills/core/SKILL.md` — добавлена секция в стиле файла:

```markdown
## Tool-use enforcement
- Если нужно реальное действие (данные, файл, отправка, правило) — вызови инструмент. Не ограничивайся описанием намерения.
- Если действие нельзя выполнить (нет прав, нет tool, ошибка) — скажи прямо и кратко. Не выдумывай успех.
- Не утверждай «сделано», пока tool не вернул успех.
```

Никаких loader'ов промптов, `TelegramSessionPool` не тронут.

### Тест

`apps/agent/tests/unit/skill-catalog.test.ts` — новый кейс
«core skill includes tool-use enforcement (H4)» через `discoverSkills()`
(SkillMeta.path → чтение SKILL.md → regex). PASS.

### Проверки

- `npx turbo run typecheck test build` → **16/16 tasks successful**.
- `git diff --stat` H4:

```
 apps/agent/tests/unit/skill-catalog.test.ts   | 9 +++++++++
 packages/skills/skills/core/SKILL.md          | 6 ++++++
```

## Итог серии

- [x] H1: доказана связь reasoning + pi-ai thinking (deepseek-ветка, 0.85.1)
- [x] H2: reasoning: true + unit green + typecheck/test/build green
- [ ] H3: простой DM без «Слишком долго» — **DELEGATED** (нужен доступ к проду)
- [x] H4: tool-use в core skill + тест
- [x] git: telegram-bot runtime не менялся в H1–H4
