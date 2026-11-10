# 007 Architecture

本地入口：DSH Gateway → task-api → Tasks → Preparation → Router → 目录准备 → 原生 Session。用户开始后 Tasks → Engine → DshExecutor → 同一 Session；Worker report → Engine → task 事件与看板。

Runtime 装配 Store、Tasks、Sessions、调度与效果队列。Store 在 SQLite 事务中提交状态和待投递效果。Sessions 管理 Router 与任务会话的注册生命周期；执行器通过持久化 execution.sessionId 识别会话。没有外部监听器、Channel 或 Outbox。

## Modules

| File | Responsibility |
| --- | --- |
| `src/admission.ts` | The admission table's values, each cell's options and defaults, shared with the panel |
| `src/app/api.ts` | `Api`, every route with its parameters, query, body and response, and the filters of the lists; it imports only types, so the panel bundles it |
| `src/app/assessment.ts` | The MasterAssessor, the assessment schema and the window `orchestrator_eval` answers |
| `src/app/cache.ts` | `TextCache`: texts kept in memory within a size, the least recently used dropped first |
| `src/app/cards.ts` | Compact cards of Triggers, Tickets, Threads and Decisions for models, the closed set of ticket card states `TICKET_STATES`, and `textPage` |
| `src/app/context.ts` | The built-in prompt text, read from `prompts/`, and the transcript entries Sessions read |
| `src/app/delivery.ts` | `AgentDelivery`: delivers a message to a DeepSeek Harness agent once per request id, also across a restored Session |
| `src/app/effects.ts` | Effects |
| `src/app/execution-environment.ts` | The execution environment: its variables, a Ticket's values, the directory root and the lines of the prompt section, which `src/app/prompts.ts` fills into its template |
| `src/app/http.ts` | The `/orchestrator/api` routes: the same-origin check, request limits and one status per kind of failure |
| `src/app/links.ts` | `sourceLink`, the page of a Trigger's message, and `candidateCard` |
| `src/app/local-prompts.ts` | Local Router and Worker instructions |
| `src/app/migration.ts` | The schema 11 migration: one step from schema 10 that writes every stored record in its current shape |
| `src/app/notices.ts` | The main Session's notices and relays: `eventNotice`, `reportRelay`, `resultRelay` and `followupRelay` |
| `src/app/passes.ts` | Passes, the pass scheduler |
| `src/app/prompts.ts` | Prompts, `builtInParts`, the built-in parts a team may override, and `promptParts`, the order of a role's prompt sections |
| `src/app/resources.ts` | `RESOURCES` and `readResource`: what `orchestrator_read` reads, for each role |
| `src/app/retry-health.ts` | `RetryHealth`: which Sessions wait on a model budget retry, for the `models` health entry |
| `src/app/role-models.ts` | Resolves the Eval and Executor models, and seeds a new Session with its role's model |
| `src/app/runtime.ts` | The Runtime, the composition root, with its start and stop |
| `src/app/sessions.ts` | Sessions |
| `src/app/settings-history.ts` | `policyHistory`: each saved settings revision with what it changed from the one before |
| `src/app/settings.ts` | Settings |
| `src/app/setup.ts` | Setup, and `setupChanged`, whether a save changes a field setup reads |
| `src/app/skill-files.ts` | Packaged text: `promptFile`, which joins a file's one-sentence lines into paragraphs, and the bundled skills |
| `src/app/source-context.ts` | `sourceContextOf`: each Source kind's `SourceContext` |
| `src/app/store-read.ts` | `storeReads`: the Store's read queries for the views, the tools and the Sources' polls, which never write |
| `src/app/store.ts` | The Store, and `Receipt`, a message of the outbox |
| `src/app/task-api.ts` | Authenticated Gateway task and management methods |
| `src/app/task-model.ts` | Task and attachment view types |
| `src/app/task-tools.ts` | Task tools for ordinary Sessions and native attachment content |
| `src/app/tasks.ts` | Persistent local task commands, review and linked execution projection |
| `src/app/tools/executor.ts` | An Executor Session's tools |
| `src/app/tools/main.ts` | The main Session's tools |
| `src/app/tools/tool.ts` | The `Tool` type, `readTool`, the `orchestrator_read` of both roles, and `AcknowledgementSchema` |
| `src/app/versions.ts` | `Versions`: a record kept as numbered snapshots with a pointer to the current one, for the settings and the prompts |
| `src/app/views/overview.ts` | The overview: Tickets that need a person, problems, the last day's flow and the Executor's load |
| `src/app/views/records.ts` | 触发、执行、线程与决定的共享视图，以及一次读取中的后续消息归属。 |
| `src/app/views/settings.ts` | The settings page's view: each block with its revision, each Source's settings with its kind's form, and the execution environment |
| `src/app/views/sources.ts` | The Source status: each Source instance's state, its last day's counts, and what it filtered and dropped in that day |
| `src/app/views/text.ts` | The two forms of a view's text: `preview`, plain text on one line, and `markdown` without HTML; `plain` and `readable` |
| `src/app/views/threads.ts` | The Thread lists, a Thread's timeline, the search and the Decision list |
| `src/app/views/tickets.ts` | The Ticket lists by stage, a Ticket's page, the Mandate basis facts and the Executor's load |
| `src/client/api.ts` | Calls and polls of the management API, typed by `src/app/api.ts`, and the Decision filters of the Eval status |
| `src/client/app.tsx` | The panel: header, search, glossary, tabs and the page of the current route |
| `src/client/chrome.tsx` | Bundle-owned sidebar and welcome decoration visibility, with the original More menu navigation retained |
| `src/client/client.css` | The panel's stylesheet, loaded as text |
| `src/client/controls.tsx` | Local copies of DeepSeek Harness's controls, which follow its markup, keyboard behaviour and design tokens, since the bundle does not import `@deepseek-ai/dsh-client-ui-primitives`; they read no context |
| `src/client/css.d.ts` | The panel's stylesheet, loaded as text |
| `src/client/deployment.tsx` | The Deployment settings, also shown in DeepSeek Harness's Plugin Manager |
| `src/client/draft.tsx` | Settings drafts: `draftReducer`, their states and their merge with a newer saved revision, `saveBarText`, the save bar's line, and the save bar |
| `src/client/eval.tsx` | One file per stage: its status, and its settings where it has some |
| `src/client/execution.tsx` | One file per stage: its status, and its settings where it has some |
| `src/client/index.tsx` | The client plugin entry: the sidebar entry, the main panel and the page in DeepSeek Harness's Plugin Manager |
| `src/client/locales.ts` | All copy in both languages, and the glossary of [001 Domain model](001-domain.md) |
| `src/client/markdown.ts` | The Markdown subset of reports and questions, and the bare addresses in messages, as blocks and inline parts |
| `src/client/marks.ts` | The marks of the states the views classify: a Ticket's or a Thread's stage, a Source's state and a Decision's outcome, each as a dot, an icon, a tone and a label |
| `src/client/multica/LICENSE.inter.txt` | License for the embedded Inter fonts |
| `src/client/multica/LICENSE.multica` | License for the copied Multica components and tokens |
| `src/client/multica/button.tsx` | Multica button variants with React 18 ref forwarding |
| `src/client/multica/controls.tsx` | Task controls and calendar, selection and dialog adapters |
| `src/client/multica/dropdown-menu.tsx` | Multica keyboard-accessible action menus |
| `src/client/multica/editor.tsx` | Markdown editing and read-only rendering |
| `src/client/multica/fonts.css` | Embedded Inter faces used by the deployed reference |
| `src/client/multica/generated.css` | Scoped Tailwind output from build:task-css |
| `src/client/multica/popover.tsx` | Anchored Multica popovers |
| `src/client/multica/portal.tsx` | Owned overlay container with isolated task styling |
| `src/client/multica/scroll-memory.ts` | View and task scroll offsets across navigation and reload |
| `src/client/multica/select.tsx` | Multica selection controls |
| `src/client/multica/status-icon.tsx` | Multica status geometry mapped to task stages |
| `src/client/multica/theme.css` | Tailwind inputs for the task surface |
| `src/client/multica/tokens.css` | Multica light and dark theme tokens |
| `src/client/multica/use-board-drag-pan.ts` | Mouse blank-area horizontal panning |
| `src/client/multica/utils.ts` | Multica class merging |
| `src/client/overview.tsx` | The overview |
| `src/client/preset-visibility.ts` | Client subplugin that filters the two internal presets from DSH's picker snapshot; settings retain the complete catalog while reusing the registered components, callbacks and subscriptions; unloading restores the original entries |
| `src/client/prompt-config.ts` | The prompt configuration by section, by the team sections, skill names, built-in parts (`part/<key>`, with `withOverride`) and part headings the prompt views give, and the line diff of the full prompt, as pure functions |
| `src/client/prompts.tsx` | The Prompts settings: the page owns the view it read and its editor the draft, and the Edit, Full prompt and History tabs render from them; a built-in part's editor shows a changed default and keeps or drops the override |
| `src/client/provider.tsx` | What every page reads from its host: copy, calls, navigation, notices, the state poll, and `restart`, which reads the state quickly while dsh-superagent restarts |
| `src/client/route.ts` | The tabs, the settings groups, the typed routes that `parseRoute` reads, and the route memory with the settings group opened last |
| `src/client/rows.tsx` | The rows the pages share: a Ticket, a Thread and a Decision, a Thread's chip, and the folding of runs of automated messages |
| `src/client/settings-kit.tsx` | The building blocks of settings blocks: the settings the stage groups share, `useBlockDraft`, the fields, among them a Source kind's, and the history of saves |
| `src/client/settings.tsx` | The Settings tab: the group navigation and the group on screen |
| `src/client/task-api.ts` | Connection transport for local and remote clients |
| `src/client/tasks.css` | Scoped task layout and Markdown presentation using Multica tokens |
| `src/client/tasks.tsx` | Multica task surface connected to DSH task commands |
| `src/client/text.ts` | Copy by key and the wording of domain values, reasons, senders and times |
| `src/client/thread.tsx` | The record pages: a Thread with its timeline, and a Ticket with its authorization, Inputs and Assignments |
| `src/client/ticket.tsx` | The record pages: a Thread with its timeline, and a Ticket with its authorization, Inputs and Assignments |
| `src/client/trigger.tsx` | One file per stage: its status, and its settings where it has some |
| `src/client/widgets.tsx` | The small components the pages share, which read the panel's context: sections, page heads, load states, times, links, confirmed actions, the setup check and Markdown |
| `src/core/assignments.ts` | `Assignments`: the Executor's facts and its workers' Reports |
| `src/core/engine.ts` | The Engine, the core's entry point, and the role interfaces `EngineForSources`, `EngineForMainSession`, `EngineForPeople`, `EngineForSettings` and `EngineForExecutor` |
| `src/core/errors.ts` | `UserError` and `USER_ERRORS` |
| `src/core/evals.ts` | `Evals`: the Evals of Threads and their Decisions |
| `src/core/ids.ts` | `key`: ids derived from their inputs, equal for equal inputs |
| `src/core/index.ts` | The core's exports |
| `src/core/intake.ts` | `Intake`: Triggers from Sources, to their Tickets and, unless a person's message reached one, to Eval |
| `src/core/memory.ts` | `MemoryRepositories`: the Store's repositories in memory, in the Store's order and with its nested rollback, for domain tests |
| `src/core/model.ts` | The domain types, among them the typed Ticket and `MandateBasis`, with `threadKey`, `ticketOutcome`, `reached`, `followupOwners`, `settled`, `waitsForPerson`, `liveTicket`, `runningAssignment`, `latestAssignment` and `latestReport` |
| `src/core/part.ts` | `EnginePart`, the base of the Engine's parts, and `EngineOptions` |
| `src/core/ports.ts` | 核心状态库、策略、准入、评估和执行接口及领域事件。 |
| `src/core/reasons.ts` | `Reason`, `REASONS` and `reasonText`: why the core recorded a Decision or set a Trigger aside, by code |
| `src/core/stage.ts` | `ticketStage` and `canRetry`: the Ticket stages of [003 Execution](003-execution.md) |
| `src/core/tickets.ts` | `Tickets`: the Ticket lifecycle, the Threads a Ticket follows, Subscriptions and Inputs |
| `src/deployment.ts` | 插件 Config、Machine 及宿主配置字段校验。 |
| `src/executor/background.ts` | A worker's background work in DeepSeek Harness, the shell jobs its Session owns (`ctx.jobs`) and its subagents (`ctx.subagents`): `runningJobs`, `untilQuiet`, `killJobs`, `collectJobs`, `stopSubagents`, `stopBackground`, `until`, and `cancelled`, the workers whose turn a stop of their subagents cancelled |
| `src/executor/dsh.ts` | The DshExecutor, `WorkerSlots`, `ticketExecution`, `inputMessage` and `mandateInstructions` |
| `src/executor/local-directory.ts` | Shared directory validation and recoverable Git worktrees |
| `src/index.ts` | The main plugin entry: reads the machine settings, starts the Runtime, and gives it the restart that a save of a Source's account uses |
| `src/infra/commands.ts` | 本地子进程的超时、取消与结构化错误，供准备和管理读取使用。 |
| `src/infra/environment.ts` | The agent's process environment: command shims, the git configuration and credential helper, `runAsWorker`, and the checks of the environment and of a Ticket's directory |
| `src/infra/health.ts` | The `HealthBoard`, every part's health entry, each claimed by its one writer |
| `src/infra/paths.ts` | The package's root, where packaged files are |
| `src/infra/text.ts` | Word counts and the chat message limit, `fill` and `sameName` |
| `src/kv.ts` | `KV`: every family of `kv` records with its key, its value's type and its owner, and the `Key` and `Family` types the Store and `SourceContext.state` take |
| `src/limits.ts` | The limits of the values a person sets, which the settings schemas check and the panel's fields offer |
| `src/navigation.ts` | Opens a DeepSeek Harness Session from the panel once the host's catalog lists it |
| `src/policy.ts` | The Policy: the settings schemas by block, the Policy version, the gate and Mandate revalidation |
| `src/setup.ts` | Setup problems: `SetupError`, with a code, the place that fixes it and the English text the log, the main Session and the panel share |
| `src/sources/admission-context.ts` | The bounded window an assessment starts from: the first pages of a Trigger's Thread, read through its kind, and the messages around the Trigger |
| `src/sources/host.ts` | `SourceHost`, `SourceContext`, `Health`, `health` and the fixed health texts |
| `src/sources/kind.ts` | The `SourceKind` protocol |
| `src/sources/local.ts` | Owner task intake and activity replies |
| `src/sources/registry.ts` | `SourceRegistry` |

## Tests

| File | Behavior |
| --- | --- |
| `tests/assessment.spec.ts` | What the MasterAssessor keeps per Eval, and when it lets go |
| `tests/background.spec.ts` | Waiting for a worker's shell jobs and subagents: an end that woke it, and a host that stops |
| `tests/bundle-patch.spec.ts` | The bundle's patch, read as DeepSeek Harness reads it, and the agent preset of Executor Sessions it defines |
| `tests/cache.spec.ts` | `TextCache` |
| `tests/cards.spec.ts` | The rules the built-in text must state, file by file |
| `tests/chrome.spec.tsx` | Real slot priority selection and unload restoration for bundle UI overrides, preserving other menu registrations |
| `tests/class-docs.spec.ts` | Every class in `src` has a JSDoc block before it |
| `tests/client-only.spec.ts` | Desktop UI entry without a local task database or host agent services |
| `tests/client.spec.tsx` | The client plugin's registration and polling, Session navigation and route memory, the local controls, and the panel's imports, which have no cycle |
| `tests/controls.spec.tsx` | The client plugin's registration and polling, Session navigation and route memory, the local controls, and the panel's imports, which have no cycle |
| `tests/core-engine.spec.ts` | Domain rules on in-memory repositories: receiving, Eval, fan-out, resume and stop, interrupted Assignments, the pause, Policy changes, reports and outcomes, attaching, replies, failed deliveries and dismissed problems |
| `tests/delivery.spec.ts` | `AgentDelivery` |
| `tests/deployment.spec.ts` | The plugin configuration and setup, the agent's process environment, the plugin entry |
| `tests/docs.spec.ts` | Numbered documents link only to earlier ones, every local link resolves, no document has merge conflict markers, and this document's tables list every module and every test |
| `tests/draft.spec.ts` | Draft states, merges and the save bar's line; the prompt configuration by section and the line diff; the Markdown subset and its links; the mark of every state the views classify |
| `tests/effects.spec.ts` | The effect queue: coalescing, limits, retries with backoff, health and shutdown |
| `tests/environment.spec.ts` | The plugin configuration and setup, the agent's process environment, the plugin entry |
| `tests/followups.spec.ts` | A person's follow-up on a Ticket's Thread: its notice to the main Session, the tools that act on it, what a burst costs; a worker's hand-back and context follow, and the main Session's note |
| `tests/health.spec.ts` | One health entry per part, each cleared by its own next success |
| `tests/http.spec.ts` | The same-origin and loopback checks, the status of each kind of failure, the body limit, path parameters and queries |
| `tests/index.spec.ts` | The plugin configuration and setup, the agent's process environment, the plugin entry |
| `tests/local-prompts.spec.ts` | Local prompt preview, team edits and source skill isolation |
| `tests/locales.spec.ts` | The copy in both languages, the stylesheet |
| `tests/markdown.spec.ts` | Draft states, merges and the save bar's line; the prompt configuration by section and the line diff; the Markdown subset and its links; the mark of every state the views classify |
| `tests/marks.spec.ts` | Draft states, merges and the save bar's line; the prompt configuration by section and the line diff; the Markdown subset and its links; the mark of every state the views classify |
| `tests/migration.spec.ts` | The schema 11 migration: every stored record in its current shape, and the refusal of older schemas |
| `tests/model-surface.spec.ts` | Everything models read: tools, prompts, skills and inputs, checked against the tool schemas, the execution environment and the glossary, within a size budget per role |
| `tests/navigation.spec.ts` | The client plugin's registration and polling, Session navigation and route memory, the local controls, and the panel's imports, which have no cycle |
| `tests/panel-deployment.spec.tsx` | The settings groups, drafts and history, the prompts, the Deployment page, and the panel's search, glossary and route memory |
| `tests/panel-eval.spec.tsx` | Each page of the panel, against a fake management API answered by route |
| `tests/panel-execution.spec.tsx` | Each page of the panel, against a fake management API answered by route |
| `tests/panel-overview.spec.tsx` | Each page of the panel, against a fake management API answered by route |
| `tests/panel-panel.spec.tsx` | The settings groups, drafts and history, the prompts, the Deployment page, and the panel's search, glossary and route memory |
| `tests/panel-prompts.spec.tsx` | The settings groups, drafts and history, the prompts, the Deployment page, and the panel's search, glossary and route memory |
| `tests/panel-settings.spec.tsx` | The settings groups, drafts and history, the prompts, the Deployment page, and the panel's search, glossary and route memory |
| `tests/panel-trigger.spec.tsx` | Each page of the panel, against a fake management API answered by route |
| `tests/passes.spec.ts` | Passes: one at a time, the ones asked for during a pass run as one after it, and the runtime health a failed pass reports |
| `tests/policy.spec.ts` | Source scope, the gate, the admission table, Mandate revalidation, the Policy version, settings migrations and assessment outcomes |
| `tests/preset-visibility.spec.tsx` | Internal-preset filtering through real SlotCore priority selection, original component interactions, snapshot subscriptions, late registration and unload recovery |
| `tests/prompt-config.spec.ts` | Draft states, merges and the save bar's line; the prompt configuration by section and the line diff; the Markdown subset and its links; the mark of every state the views classify |
| `tests/prompts.spec.ts` | Prompt validation, assembly and versions |
| `tests/queue.spec.ts` | The Runtime's work through the effect queue, and what earlier versions stored |
| `tests/registry.spec.ts` | 本地来源注册、注销与缺失外部插件的行为。 |
| `tests/retry-health.spec.ts` | Model budget retries, and the models of the two roles |
| `tests/role-models.spec.ts` | Model budget retries, and the models of the two roles |
| `tests/runtime-concurrency.spec.ts` | Work that overlaps: Triggers during a pass, Tickets that change during deliveries and launches |
| `tests/runtime.spec.ts` | The whole application on a simulated DeepSeek Harness host, through tools and HTTP |
| `tests/service-script.spec.ts` | `scripts/dsh-superagent` against fake `ps`, `tmux` and `dsh` |
| `tests/settings.spec.ts` | Settings saves that race a model or account check, a Policy sync that a save outran, and the refusals of the pause, a sync and a block |
| `tests/stage.spec.ts` | The Ticket stages, row by row |
| `tests/store.spec.ts` | Repositories and their working sets, in SQLite as in memory, the kv area, with every key of `KV` spelled only in `src/kv.ts` and the migration, settings history and queries |
| `tests/styles.spec.ts` | The copy in both languages, the stylesheet |
| `tests/task-transport.spec.ts` | Connection carrier invocation and error feedback |
| `tests/task-ui.spec.tsx` | Scroll restoration, pointer pan exclusions, semantic classes and overlay lifecycle |
| `tests/tasks.spec.ts` | Local task draft, execution, review, idempotency and persistence |
| `tests/timeline.spec.ts` | A Thread's pages and a Trigger's neighbours by time and then id, with every received Trigger's time in one form |
| `tests/tools.spec.ts` | The Sessions' tools: what `orchestrator_read` reads for each role, and the shapes and checks of the other main Session tools |
| `tests/views.spec.ts` | What the management views derive from the Store, such as the Thread a dropped message belongs to |
| `tests/task-session.spec.ts` | 本地任务准备、原生 Session 绑定及 Worker 直接汇报。 |
