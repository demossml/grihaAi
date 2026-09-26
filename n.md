# ЗАДАЧА: ДОСТРОИТЬ ПОЛНОЦЕННУЮ СИСТЕМУ ОБУЧЕНИЯ GRIHA ИЗ СУЩЕСТВУЮЩЕГО КОДА

Ты работаешь с существующим репозиторием Griha AI.

Твоя задача — не написать новую систему рядом с существующей, а внимательно исследовать текущий проект и довести уже имеющуюся архитектуру обучения до реально работающего полного цикла.

Критически важно:

**НЕ ПЕРЕПИСЫВАЙ ПРОЕКТ С НУЛЯ.**

Сначала изучи существующий код, найди реальные точки входа и зависимости, затем минимально необходимыми изменениями соедини уже существующие компоненты в единый работающий механизм.

---

# 1. ГЛАВНАЯ АРХИТЕКТУРНАЯ ИДЕЯ

Griha должен уметь учиться на собственной работе.

Полный цикл должен выглядеть примерно так:

```text
Пользовательская задача
        ↓
Выполнение задачи Griha
        ↓
Результат / tools / ошибки / контекст
        ↓
Experience
        ↓
Background Review / Learning Review
        ↓
Извлечение уроков
        ↓
Классификация урока
        ↓
┌───────────────┬────────────────┬─────────────────┐
│               │                │                 │
▼               ▼                ▼                 │
Memory       User Model       Skill Learning       │
│               │                │                 │
└───────────────┴────────────────┴─────────────────┘
                                ↓
                         Skill Proposal
                                ↓
                         Evaluation
                                ↓
                       Human Approval
                                ↓
                         Skill Version
                                ↓
                         Active Skill
                                ↓
                         Реальное выполнение
                                ↓
                         Quality Outcome
                                ↓
                         Regression Detection
                                ↓
                    новый цикл обучения
```

Система должна быть замкнутой.

Сейчас в проекте уже существуют части этой архитектуры, но часть из них является чистыми компонентами/тестами и не обязательно подключена к production execution path.

Твоя задача — проверить это фактически по call graph и соединить компоненты там, где это необходимо.

---

# 2. КРИТИЧЕСКОЕ ТРЕБОВАНИЕ: КАЖДЫЙ КЛИЕНТ — ОТДЕЛЬНЫЙ ЭКЗЕМПЛЯР GRIHA

Это НЕ SaaS multi-tenant архитектура.

Не делай одну общую БД:

```text
database
 ├── client A
 ├── client B
 └── client C
```

Так делать НЕ надо.

Нужна архитектура:

```text
Linux server
│
├── Griha Client A
│   ├── отдельный container
│   ├── отдельная database
│   ├── отдельный persistent volume
│   ├── отдельный learning state
│   ├── отдельные memories
│   ├── отдельные experiences
│   ├── отдельные skills
│   ├── отдельные skill versions
│   ├── отдельный quality history
│   └── отдельные proposals
│
├── Griha Client B
│   ├── отдельный container
│   ├── отдельная database
│   ├── отдельный persistent volume
│   ├── отдельный learning state
│   ├── отдельные memories
│   ├── отдельные experiences
│   ├── отдельные skills
│   ├── отдельные skill versions
│   ├── отдельный quality history
│   └── отдельные proposals
│
└── Griha Client C
    └── полностью независимый экземпляр
```

Все экземпляры могут работать на одном Linux-сервере.

Общими могут быть только инфраструктурные ресурсы:

* CPU;
* RAM;
* диск;
* container runtime;
* read-only базовая модель;
* общий исходный image;
* общие инфраструктурные сервисы, если это безопасно.

Но persistent learning state между клиентами НЕ должен быть общим.

---

# 3. ПРАВИЛО ИЗОЛЯЦИИ КЛИЕНТОВ

Если клиент A научился:

```text
"Для этого клиента отчёт надо формировать по определённому шаблону."
```

клиент B никогда не должен получить это знание автоматически.

Если клиент A создал:

```text
skill v2
```

клиент B не должен начать использовать `skill v2`.

Если клиент A получил:

```text
experience
user preference
memory
proposal
quality history
```

эти данные не должны попадать в клиент B.

---

# 4. КОНТЕЙНЕРИЗАЦИЯ

Исследуй текущий проект и определи, используется ли уже Docker/Podman.

Если containerization отсутствует или недостаточна, добавь минимальную инфраструктуру для независимых экземпляров.

Предпочтительно сделать:

```text
Griha source
     ↓
Dockerfile / Containerfile
     ↓
один базовый image
     ↓
несколько независимых containers
```

Например:

```text
griha-client-001
griha-client-002
griha-client-003
...
```

Но:

**НЕ создавай копию исходного кода для каждого клиента.**

Один image должен использоваться несколькими контейнерами.

Каждый контейнер получает свой persistent volume.

Например:

```text
/var/lib/griha/clients/client-001
/var/lib/griha/clients/client-002
/var/lib/griha/clients/client-003
```

или эквивалентную безопасную структуру.

---

# 5. ОТДЕЛЬНАЯ БАЗА ДАННЫХ

Каждый экземпляр должен иметь собственную БД.

Например:

```text
client-001 → DB-001
client-002 → DB-002
client-003 → DB-003
```

Не допускается:

```text
one.db
 ├── client-001
 ├── client-002
 └── client-003
```

если только текущая архитектура не требует этого для инфраструктурной БД.

Learning state должен быть физически изолирован.

---

# 6. НАЙДИ СУЩЕСТВУЮЩУЮ СИСТЕМУ ОБУЧЕНИЯ

В репозитории уже существуют компоненты, которые необходимо исследовать.

Особенно внимательно проверь:

```text
apps/agent/src/runtime/learning/
```

Там уже есть:

```text
background.ts
experience.ts
index.ts
quality.ts
routing.ts
user-model.ts
```

Также исследуй:

```text
apps/agent/src/utils/learning/
```

Особенно:

```text
learning-extractor.ts
skill-improver.ts
personal-context.ts
```

Также обязательно исследуй:

```text
runtime/skill/
```

и существующий:

```text
SkillVersionStore
```

а также:

```text
core-agent
background-review
skill-commands
profile-section
```

Не полагайся на комментарии.

Проверь реальные импорты, вызовы и production paths.

---

# 7. ЧТО УЖЕ ЕСТЬ В EXPERIENCE

Существующий `ExperienceStore` содержит примерно такую модель:

```ts
ExperienceRecord {
  id
  task
  contextRef
  tools
  errors
  result
  evaluation
  lesson
  createdAt
  deprecated
}
```

Сейчас он является in-memory реализацией.

Твоя задача:

1. определить, где он должен получать реальные данные;
2. определить, где он должен сохраняться;
3. если архитектура проекта использует БД — добавить persistence;
4. не ломать существующий API;
5. сделать его пригодным для production learning loop.

Обязательно добавить идентификатор экземпляра/контекста клиента на архитектурном уровне, но поскольку каждый клиент теперь является отдельным процессом/БД, не надо искусственно превращать систему в multi-tenant database.

---

# 8. EXPERIENCE ДОЛЖЕН СОЗДАВАТЬСЯ ПОСЛЕ РЕАЛЬНОГО ВЫПОЛНЕНИЯ

После существенного хода Griha необходимо сохранить:

```text
task
context
tools
tool results
errors
result
evaluation
active skills
execution metadata
timestamp
```

Не нужно записывать абсолютно каждый технический чих.

Но должно быть достаточно информации, чтобы позднее понять:

```text
что пользователь хотел;
что сделал Griha;
какие инструменты использовал;
какой был результат;
была ли ошибка;
что сработало;
что не сработало.
```

---

# 9. LEARNING НЕ ДОЛЖЕН БЛОКИРОВАТЬ ОСНОВНОЙ ОТВЕТ

Это очень важно.

Пользователь не должен ждать:

```text
Griha ответил
→ анализирует обучение
→ вызывает дополнительную модель
→ сохраняет lesson
→ считает quality
→ ...
→ наконец закончено
```

Основной pipeline:

```text
User
 ↓
Griha
 ↓
Response
```

должен оставаться быстрым.

Learning должен выполняться:

```text
после ответа
```

или в фоне.

Если learning сломался:

```text
learning error
```

это НЕ должно превращаться в:

```text
agent error
```

Основная задача пользователя должна завершиться независимо.

---

# 10. BACKGROUND REVIEW

В проекте уже существует:

```text
background.ts
```

с логикой:

```text
ошибка → review сразу
tool usage → review сразу
иначе → периодический review
```

Также существуют:

```text
everyNTurns
minTurns
```

Не переписывай эту логику без необходимости.

Проверь, вызывается ли реально background review из production execution path.

Ключевая проблема, которую нужно решить:

**результат review не должен заканчиваться просто telemetry.**

Если review обнаружил:

```text
lesson
```

он должен попасть в реальный learning pipeline:

```text
review
 ↓
lesson
 ↓
classification
 ↓
routing
 ↓
persistence
```

---

# 11. ROUTING

В проекте уже существует routing:

```text
factual
procedural
preference
unknown
```

и targets:

```text
memory
skill
user-model
drop
```

Проверь существующий:

```text
routeLesson()
```

Используй существующую архитектуру, а не создавай второй router.

Ожидаемая логика:

```text
fact
 ↓
memory

procedure
 ↓
skill learning

preference
 ↓
user model

unknown
 ↓
drop / review
```

Но routing должен реально приводить к действию.

Недостаточно вернуть:

```ts
{
  target: "skill"
}
```

если после этого ничего не происходит.

---

# 12. USER MODEL

В проекте уже есть:

```text
UserModelStore
```

с:

```text
candidate
confirmed
deprecated
```

и:

```text
confidence
evidenceCount
provenance
```

Сохрани эту модель.

Пример:

```text
User repeatedly says:

"Делай отчёты короткими."

       ↓

candidate

       ↓

повторное подтверждение

       ↓

confidence ↑

       ↓

confirmed
```

Если пользователь позже говорит обратное:

```text
"Теперь делай подробные отчёты."
```

старое правило должно быть обработано через contradiction/deprecation, а не просто добавлено вторым конфликтующим фактом.

---

# 13. LEARNING EXTRACTION

В проекте уже есть:

```text
learning-extractor.ts
```

Он извлекает:

```text
facts
preferences
procedural notes
```

Не создавай второй extractor.

Улучшай существующий.

LLM должен возвращать структурированный результат.

Не разрешай модели возвращать произвольный текст, который затем невозможно безопасно обработать.

Нужно валидировать JSON.

Ошибочный JSON:

```text
learning failed
```

но:

```text
agent response remains successful
```

---

# 14. SKILL LEARNING

Процедурные знания должны иметь возможность становиться skill improvement.

Пример:

Griha несколько раз выполняет:

```text
"Сформируй отчёт по продажам."
```

и каждый раз пользователь исправляет:

```text
"Добавляй ещё закупки."
```

После достаточного количества подтверждений система может сформировать:

```text
Skill Proposal
```

Но НЕ должна автоматически менять защищённый skill.

---

# 15. SKILL PROPOSALS

В проекте уже есть:

```text
SkillProposalStore
```

и статусы:

```text
pending
applied
rejected
```

Сохрани этот механизм.

Правильный цикл:

```text
experience
 ↓
repeated lesson
 ↓
proposal
 ↓
pending
 ↓
human approval
 ↓
applied
```

Нельзя:

```text
experience
 ↓
LLM
 ↓
сам переписал core skill
```

---

# 16. ЗАЩИЩЁННЫЕ ОБЛАСТИ

Нельзя позволять learning автоматически менять:

```text
security
permissions
authentication
authorization
approval rules
financial policy
access restrictions
system safety
secrets
credentials
passwords
API keys
tokens
```

Даже если LLM считает, что это "улучшение".

Такие изменения должны либо блокироваться, либо проходить отдельный явный административный workflow.

---

# 17. SKILL VERSIONING

В проекте уже есть:

```text
SkillVersionStore
```

Исследуй его.

Не допускай ситуации:

```text
создали новую skill version
```

но runtime продолжает использовать старый skill.

Должен существовать реальный цикл:

```text
Skill v1
 ↓
Proposal
 ↓
Evaluation
 ↓
Approval
 ↓
Skill v2
 ↓
Activation
 ↓
Runtime uses v2
```

---

# 18. EVALUATION

Перед активацией нового skill желательно выполнить evaluation.

Если в проекте уже есть evaluation framework — используй его.

Если его недостаточно — добавь минимальный.

Evaluation должен позволять определить:

```text
v1 result
vs
v2 result
```

на наборе тестовых/репрезентативных задач.

Важно:

**не разрешай learning самостоятельно объявлять новую версию успешной только потому, что LLM так сказала.**

Должны учитываться реальные outcomes.

---

# 19. QUALITY TRACKER

В проекте уже есть:

```text
SkillQualityTracker
```

с:

```text
attempts
successes
score
regression
```

и:

```text
decay
regressionWindow
regressionDrop
```

Сейчас это чистый in-memory tracker.

Твоя задача — проверить, где он реально подключён.

Нужно сделать:

```text
skill execution
 ↓
success/failure
 ↓
recordOutcome()
 ↓
quality
 ↓
regression
```

а не просто оставить класс существовать отдельно от runtime.

---

# 20. REGRESSION

Если новый skill ухудшил результаты:

```text
v2
 ↓
плохие outcomes
 ↓
regression detected
```

система должна иметь возможность:

```text
rollback
```

или хотя бы:

```text
mark version unhealthy
```

и вернуть предыдущую рабочую версию, если существующая архитектура это позволяет.

Не удаляй старую версию.

Version history должна сохраняться.

---

# 21. ИДЕМПОТЕНТНОСТЬ

Одна из важнейших вещей.

Если один и тот же turn/review будет обработан дважды:

```text
turnId = X
```

learning не должен создать:

```text
2 experiences
2 identical lessons
2 identical proposals
```

Добавь idempotency mechanism.

Например:

```text
experienceId
turnId
reviewId
proposal source
```

Используй то, что лучше соответствует существующей архитектуре.

---

# 22. PERSISTENCE

Все важные learning state должны переживать:

```text
restart container
restart process
reboot Linux
```

если это persistent state.

В частности:

```text
experience
memory
user model
skill versions
proposals
quality history
learning metadata
```

не должны исчезать просто потому, что процесс перезапустился.

---

# 23. ВАЖНО: НЕ ДЕЛАТЬ ОБЩУЮ БАЗУ ДЛЯ КЛИЕНТОВ

Архитектура должна выглядеть:

```text
                    Linux
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
      Client A    Client B    Client C
          │           │           │
        DB-A        DB-B        DB-C
          │           │           │
       Memory      Memory      Memory
       Skills      Skills      Skills
       Learning    Learning    Learning
```

а не:

```text
                  Shared DB
                     │
       ┌─────────────┼─────────────┐
       A             B             C
```

---

# 24. ОБЩИЙ IMAGE

Несмотря на отдельные базы и контейнеры, не нужно собирать отдельную копию кода вручную для каждого клиента.

Должен быть:

```text
Griha source
      ↓
Docker/Podman image
      ↓
┌─────────────┬─────────────┬─────────────┐
│             │             │
Client A      Client B      Client C
container     container     container
```

Все используют одну версию образа.

Каждый имеет:

```text
свой config
свой environment
свой DB volume
свой data volume
свои learning files
```

---

# 25. ОБНОВЛЕНИЕ ВСЕХ КЛИЕНТОВ

Продумай механизм:

```text
Griha image v1
       ↓
client A
client B
client C
```

после обновления:

```text
Griha image v2
       ↓
client A → v2
client B → v2
client C → v2
```

Но:

**обновление кода не должно уничтожать клиентское обучение.**

То есть:

```text
image = code
volume = client state
```

Это принципиально.

---

# 26. РАЗДЕЛИ CODE И DATA

Очень желательно:

```text
IMAGE
 ├── application code
 ├── runtime
 ├── base skills
 └── dependencies

VOLUME
 ├── database
 ├── learned memory
 ├── experiences
 ├── proposals
 ├── skill versions
 └── client configuration
```

После пересоздания контейнера volume должен подключаться снова.

---

# 27. СКОЛЬКО КЛИЕНТОВ МОЖЕТ БЫТЬ

Не устанавливай искусственное число:

```text
10
20
50
100
```

если оно не следует из hardware.

Количество клиентов определяется:

```text
CPU
RAM
VRAM
disk I/O
database load
LLM concurrency
network
model size
container overhead
```

Поэтому архитектура должна поддерживать:

```text
N clients
```

где N ограничивается ресурсами конкретного Linux-сервера.

Если возможно, добавь механизм resource limits:

```text
CPU limit
RAM limit
restart policy
disk quota
```

на экземпляр.

---

# 28. КРИТИЧЕСКИ: НЕ ЛОМАЙ СУЩЕСТВУЮЩУЮ АРХИТЕКТУРУ

Перед изменением кода:

1. прочитай package.json;
2. найди workspace structure;
3. найди database layer;
4. найди runtime entrypoint;
5. найди agent execution path;
6. найди tool execution;
7. найди skill loader;
8. найди skill versioning;
9. найди learning imports;
10. найди tests.

Построй фактический call graph.

Не предполагай.

---

# 29. ОСОБЕННО ПРОВЕРЬ

Нужно найти:

```text
кто вызывает ExperienceStore
```

```text
кто вызывает BackgroundReview
```

```text
кто вызывает extractLearning
```

```text
кто вызывает routeLesson
```

```text
кто вызывает UserModelStore
```

```text
кто вызывает SkillProposalStore
```

```text
кто вызывает SkillVersionStore
```

```text
кто вызывает SkillQualityTracker
```

и главное:

```text
какой реально используемый runtime path проходит от пользовательского сообщения
до skill execution.
```

---

# 30. НЕ СОЗДАВАЙ ПАРАЛЛЕЛЬНУЮ СИСТЕМУ

Если уже существует:

```text
ExperienceStore
```

не создавай:

```text
NewExperienceStore
```

Если существует:

```text
SkillProposalStore
```

не создавай:

```text
LearningProposalManager
```

Если существует:

```text
UserModelStore
```

не создавай вторую модель пользователя.

Сначала используй существующие компоненты.

Новые абстракции допустимы только если существующих действительно недостаточно.

---

# 31. LEARNING PIPELINE

Если в проекте нет единой точки orchestration, создай её.

Например концептуально:

```ts
interface LearningPipelineInput {
  turnId: string;
  task: string;
  context?: string;
  tools?: string[];
  toolResults?: unknown[];
  errors?: string[];
  result?: string;
  userId?: string;
}
```

Но не копируй этот интерфейс вслепую.

Сначала посмотри реальные типы проекта.

Pipeline должен делать:

```text
1. record experience
2. determine whether review is needed
3. run review
4. extract lessons
5. classify lessons
6. route lessons
7. persist learning
8. generate skill proposal if justified
9. evaluate proposal if applicable
10. expose pending proposal for approval
11. measure future outcomes
```

---

# 32. НЕ КАЖДАЯ ФРАЗА ПОЛЬЗОВАТЕЛЯ — ОБУЧЕНИЕ

Не надо превращать Griha в систему, которая запоминает всё подряд.

Пример:

```text
"Спасибо"
```

не lesson.

```text
"Окей"
```

не lesson.

```text
"Сегодня сделай отчёт"
```

не обязательно persistent learning.

А вот:

```text
"Всегда формируй отчёты в таком формате."
```

может быть preference.

И:

```text
"При закрытии смены сначала проверь сверку итогов."
```

может быть procedural lesson.

---

# 33. ПОВТОРНОЕ ПОДТВЕРЖДЕНИЕ

Один случай:

```text
procedure observed once
```

не должен автоматически создавать новый skill.

Нужна достаточная evidence.

Например:

```text
experience 1
experience 2
experience 3
       ↓
same lesson
       ↓
confidence ↑
       ↓
proposal
```

Используй существующую систему confidence/evidence, если она подходит.

---

# 34. ПРОТИВОРЕЧИЯ

Если новое обучение противоречит старому:

```text
старое:
"Отчёт должен быть коротким."

новое:
"Теперь отчёт должен быть подробным."
```

не должно возникать две бессвязные истины.

Нужно:

```text
old insight
 ↓
deprecated
```

и:

```text
new insight
 ↓
candidate / confirmed
```

с сохранением provenance.

---

# 35. TELEMETRY

Добавь структурированную telemetry для learning:

```text
learning.started
learning.experience_recorded
learning.review_started
learning.review_completed
learning.lesson_extracted
learning.lesson_routed
learning.proposal_created
learning.proposal_approved
learning.proposal_rejected
learning.skill_version_created
learning.skill_version_activated
learning.skill_outcome
learning.regression_detected
learning.rollback
learning.error
```

Но не логируй:

```text
password
API key
token
secret
private credential
```

---

# 36. FEATURE FLAG

Если в проекте уже используется:

```text
GRIHA_AGENT_RUNTIME
```

не ломай его.

Когда runtime/learning выключен:

```text
старое поведение должно продолжать работать.
```

Когда включён:

```text
learning pipeline активируется.
```

Не должно быть ситуации, когда выключение feature flag ломает основной agent.

---

# 37. ОШИБКИ LEARNING

Любая ошибка:

```text
LLM extraction failed
JSON invalid
DB learning write failed
review failed
proposal generation failed
quality calculation failed
```

не должна ломать пользовательскую задачу.

Используй принцип:

```text
try learning
catch learningError
log
continue
```

Но не делай бездумный `catch {}`.

Ошибка должна быть диагностируема.

---

# 38. ТЕСТЫ

Добавь/обнови тесты.

Минимальный набор:

### Experience

```text
experience created
experience persisted
experience survives restart
```

### Background review

```text
error → immediate review
tool usage → review
periodic turn → review
normal turn → no unnecessary review
```

### Routing

```text
fact → memory
procedure → skill
preference → user model
unknown → safe handling
```

### User model

```text
candidate
confidence increase
confirmed
contradiction
deprecated
provenance
```

### Skill proposals

```text
repeated procedure → proposal
insufficient evidence → no proposal
protected domain → blocked
approval → applied
rejection → rejected
```

### Skill versions

```text
v1 exists
proposal creates v2
evaluation
activation
runtime actually uses v2
rollback possible
```

### Quality

```text
execution → outcome
outcome → tracker
score changes
regression detected
```

### Idempotency

```text
same turn processed twice
        ↓
one learning result
```

---

# 39. ОБЯЗАТЕЛЬНЫЕ ТЕСТЫ ИЗОЛЯЦИИ КЛИЕНТОВ

Это отдельный блок.

Создай минимум такие тесты:

```text
Client A learns X
Client B must NOT know X
```

```text
Client A creates Skill v2
Client B must continue using its own skill
```

```text
Client A creates proposal
Client B must NOT see proposal
```

```text
Client A quality history
Client B quality history must be independent
```

```text
Client A restarts
Client B state remains untouched
```

```text
Client A database
Client B database
must be physically/logically independent
```

---

# 40. CONTAINER TEST

Если добавляется Docker/Podman:

проверь сценарий:

```text
build image
 ↓
run client-A
 ↓
run client-B
 ↓
A learns X
 ↓
B doesn't know X
 ↓
restart A
 ↓
A still knows X
 ↓
B still doesn't know X
```

Это должен быть integration test или максимально близкая к нему автоматическая проверка.

---

# 41. ОБНОВЛЕНИЕ IMAGE

Проверь:

```text
client A data survives image update
client B data survives image update
```

То есть:

```text
old container
 ↓
stop
 ↓
new image
 ↓
new container
 ↓
same volume
 ↓
learning state preserved
```

---

# 42. ПЕРСИСТЕНТНЫЕ VOLUMES

Для каждого клиента:

```text
container
    ↓
persistent volume
    ↓
client database / learning data
```

Удаление контейнера:

```text
docker rm container
```

не должно автоматически уничтожать learning state.

Удаление клиента должно быть отдельной сознательной операцией.

---

# 43. БЕЗОПАСНОСТЬ

Особенно проверь:

```text
path traversal
volume paths
client names
environment variables
database paths
secret handling
file permissions
container permissions
```

Не позволяй клиентскому конфигу произвольно читать:

```text
/root
/home/other-client
другой volume
секреты host
```

---

# 44. НЕ ИСПОЛЬЗУЙ ROOT БЕЗ НЕОБХОДИМОСТИ

Если используется Docker/Podman, проверь возможность:

```text
rootless
```

если это совместимо с существующей инфраструктурой.

Не добавляй привилегированный container без необходимости.

---

# 45. ГЛАВНЫЙ ПРИНЦИП

Запомни архитектурное правило:

```text
ONE CODEBASE
      ↓
ONE IMAGE
      ↓
MANY INDEPENDENT INSTANCES
      ↓
ONE INSTANCE = ONE CLIENT
      ↓
ONE INSTANCE = ONE DATABASE
      ↓
ONE INSTANCE = ONE LEARNING HISTORY
```

Это НЕ:

```text
one Griha
 ├── client A
 ├── client B
 └── client C
```

Это:

```text
Griha image
 ├── instance A
 ├── instance B
 ├── instance C
 └── instance N
```

---

# 46. НЕ ПУТАЙ GLOBAL CODE И CLIENT LEARNING

Общий код:

```text
Griha engine
```

может быть одинаковым.

Но:

```text
learned behavior
```

должен быть независимым.

То есть:

```text
                   COMMON
                     │
             Griha application
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
    CLIENT A      CLIENT B      CLIENT C
       │             │             │
    learning      learning      learning
       │             │             │
      DB-A          DB-B          DB-C
```

---

# 47. НЕ ДЕЛАЙ АВТОМАТИЧЕСКОГО GLOBAL LEARNING

Если клиент A научил Griha какой-либо процедуре, это знание не должно автоматически попадать в общий skill.

То есть запрещено:

```text
Client A lesson
      ↓
global skill
      ↓
all clients
```

Если когда-либо понадобится перенос полезного знания из клиента в глобальную систему, это должен быть отдельный административный процесс с явным approval.

На текущем этапе это можно вообще не реализовывать.

---

# 48. ПОРЯДОК РАБОТЫ

Работай строго в таком порядке.

## Этап 1 — AUDIT

Сначала ничего существенного не меняй.

Изучи:

```text
repository
package structure
runtime
database
agent entrypoint
core-agent
learning
skills
skill versions
tests
containerization
configuration
```

Построй фактическую архитектурную схему.

---

## Этап 2 — CALL GRAPH

Найди реальный путь:

```text
incoming user message
 ↓
agent
 ↓
LLM
 ↓
tools
 ↓
result
 ↓
response
```

и отдельно:

```text
response
 ↓
learning
```

Покажи, где сейчас цепочка обрывается.

---

## Этап 3 — GAP ANALYSIS

Сделай таблицу:

```text
Component | Exists | Wired | Persistent | Missing
```

Например:

```text
ExperienceStore       yes   no   no   wiring
BackgroundReview      yes   partial ...
UserModel             yes   ...
QualityTracker        yes   ...
SkillProposalStore    yes   ...
SkillVersionStore     yes   ...
```

Не придумывай значения.

Проверяй код.

---

## Этап 4 — IMPLEMENTATION

После аудита реализуй недостающие части.

Не переписывай существующее без причины.

---

## Этап 5 — PERSISTENCE

Сделай learning state реально persistent.

---

## Этап 6 — CONTAINER ISOLATION

Сделай возможность запускать:

```text
client-001
client-002
client-003
```

из одного образа.

---

## Этап 7 — TESTS

Запусти существующие тесты.

Добавь новые.

Исправь регрессии.

---

# 49. НЕЛЬЗЯ СЧИТАТЬ ЗАДАЧУ ВЫПОЛНЕННОЙ, ЕСЛИ

Просто существуют классы:

```text
ExperienceStore
SkillQualityTracker
UserModelStore
SkillProposalStore
```

но они не участвуют в реальном execution path.

Система должна быть реально связана.

---

# 50. ФИНАЛЬНЫЙ END-TO-END TEST

Обязательно реализуй или продемонстрируй сценарий:

```text
1. Пользователь ставит задачу.

2. Griha выполняет задачу.

3. Griha использует tool.

4. Результат сохраняется как experience.

5. Background review анализирует выполнение.

6. Review обнаруживает lesson.

7. Lesson классифицируется.

8. Lesson попадает в правильный target.

9. Повторные подтверждения увеличивают evidence/confidence.

10. При достаточном основании создаётся skill proposal.

11. Proposal получает pending status.

12. Пользователь подтверждает proposal.

13. Создаётся новая skill version.

14. Новая версия проходит evaluation.

15. Новая версия активируется.

16. Следующая задача использует новую версию.

17. Реальный результат записывается в quality tracker.

18. Если результаты ухудшаются — фиксируется regression.

19. При необходимости выполняется rollback.

20. После перезапуска контейнера learning state сохраняется.
```

---

# 51. END-TO-END CLIENT ISOLATION TEST

Дополнительно:

```text
Client A
    ↓
задача
    ↓
learning
    ↓
skill A-v2
```

Одновременно:

```text
Client B
    ↓
та же задача
```

Client B НЕ должен получить:

```text
skill A-v2
experience A
memory A
proposal A
quality A
```

После restart:

```text
A → state A preserved
B → state B preserved
```

---

# 52. ПРОИЗВОДИТЕЛЬНОСТЬ

Learning не должен создавать бесконечный поток LLM-вызовов.

Проверь:

```text
review frequency
LLM cost
concurrency
queue
retry
backpressure
```

Если 50 клиентов одновременно используют Griha, система не должна породить неконтролируемый шторм background LLM calls.

Используй очередь/ограничение concurrency, если это соответствует существующей архитектуре.

---

# 53. ОТДЕЛЬНО ПРО КОЛИЧЕСТВО КЛИЕНТОВ

Не пытайся заранее определить максимальное количество контейнеров.

Добавь возможность масштабирования:

```text
N containers
```

и возможность задавать каждому:

```text
CPU
RAM
restart policy
storage
```

Конкретный максимум должен определяться реальным сервером.

Если в проекте уже есть deployment configuration — расширь её.

---

# 54. ЧТО НУЖНО ПОЛУЧИТЬ В КОНЦЕ

После выполнения задачи предоставь подробный отчёт.

Формат:

## 1. Audit

Что было найдено.

## 2. Existing architecture

Что уже существовало.

## 3. Problems

Где обучение было разорвано.

## 4. Changes

Какие файлы изменены.

Для каждого:

```text
file
what changed
why
```

## 5. Learning call graph

Покажи:

```text
user
 ↓
agent
 ↓
experience
 ↓
review
 ↓
lesson
 ↓
memory/user-model/skill
 ↓
proposal
 ↓
approval
 ↓
version
 ↓
execution
 ↓
quality
```

## 6. Container architecture

Покажи:

```text
Linux
 ├── image
 ├── client A container + DB A + volume A
 ├── client B container + DB B + volume B
 └── client N container + DB N + volume N
```

## 7. Persistence

Что и где сохраняется.

## 8. Tests

Какие тесты добавлены.

## 9. Test results

Команды и реальные результаты.

НЕ ПИШИ "tests passed", если ты их реально не запускал.

## 10. Remaining limitations

Честно перечисли то, что осталось.

---

# 55. ОСОБОЕ ПРАВИЛО ДЛЯ DEEPSEEK

Ты можешь обнаружить, что часть требований уже реализована.

В таком случае:

```text
НЕ ДЕЛАЙ ЭТО ЗАНОВО.
```

Проверь существующий код и подключи его.

Если существующая реализация плохая — объясни почему и исправь минимально необходимым образом.

Если изменение архитектуры действительно необходимо — сначала покажи:

```text
Current
→ Problem
→ Proposed
→ Why
```

и только потом меняй код.

---

# 56. ПРАВИЛО ПРО КОМПИЛЯЦИЮ

После каждого крупного этапа запускай соответствующие проверки.

Минимально:

```text
typecheck
lint
unit tests
integration tests
build
```

используй реальные команды проекта из package.json.

Не придумывай команды, если в проекте уже есть свои scripts.

---

# 57. ПРАВИЛО ПРО СУЩЕСТВУЮЩИЕ ТЕСТЫ

Нельзя просто удалить старые тесты потому, что они мешают новой архитектуре.

Если тест устарел:

```text
объясни почему
```

и адаптируй его.

Сохрани существующую функциональность.

---

# 58. ИТОГОВАЯ ЦЕЛЬ

После выполнения Griha должен представлять собой систему:

```text
                 Griha source
                       │
                       ▼
                 Docker image
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Client A     Client B     Client C
          │            │            │
         DB-A         DB-B         DB-C
          │            │            │
      Learning A   Learning B   Learning C
          │            │            │
       Skills A     Skills B     Skills C
          │            │            │
       Quality A    Quality B    Quality C
```

При этом внутри каждого клиента:

```text
User task
   ↓
Execution
   ↓
Experience
   ↓
Review
   ↓
Lesson
   ↓
Memory / User Model / Skill
   ↓
Proposal
   ↓
Human approval
   ↓
Evaluation
   ↓
Skill version
   ↓
Activation
   ↓
Real execution
   ↓
Outcome
   ↓
Quality
   ↓
Regression / improvement
```

То есть Griha должен не просто иметь папку `learning`, а **реально учиться на результатах своей работы**.

И одновременно:

**обучение клиента A никогда не должно становиться обучением клиента B.**

Один Linux-сервер — много независимых Griha-инстансов.

Один Griha-инстанс — один клиент.

Один клиент — своя БД и своё persistent learning state.

Общий только код/образ и инфраструктурные ресурсы, если это безопасно.

Начинай с полного аудита репозитория.

Не меняй код до того, как поймёшь существующий call graph.
