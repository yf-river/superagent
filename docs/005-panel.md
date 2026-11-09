# 005 Panel

Open **superagent** in the DeepSeek Harness Web sidebar. The default page is the local task board; **Settings and diagnostics** opens the retained supervision pages described below. The panel prioritizes work that needs a person, then system health and history. This document builds on [000 Philosophy](000-philosophy.md) through [004 Prompts](004-prompts.md).

## Task board

The compact toolbar switches between All, Needs attention and Awaiting review. Filters select directory, priority and status; Display controls visible columns, summaries and priority quadrants. The board uses fixed-width columns with independent scrolling, while the list uses compact rows. Columns are Backlog, Queued, In progress, Needs attention, Awaiting review and Completed; Cancelled is a filter. Each column loads its own pages, so one busy stage does not hide tasks in another. The narrow layout stacks columns vertically.

Create a task with a title, request, server directory, optional images/files, priority and due date. Saving creates only a draft. Priority uses four importance/urgency quadrants in Backlog; tasks without a priority have a separate group. Counts cover all matching tasks, including unloaded pages. Priority and date may be changed during execution without sending new model input or changing queue scheduling. Dates are stored as calendar dates and compared with the viewer's local day for overdue display.

Task UI uses the deployed Multica task surface as its reference: 280px columns, a horizontally scrollable board, independent vertical column scrolling, blank-area mouse panning and dnd-kit card dragging. Detail occupies the content area with a separate property sidebar. View offsets survive detail navigation and refresh. Base UI menus and dialogs share an owned overlay container; scoped Tailwind styles and embedded Inter fonts do not change the DSH shell. The editor saves Markdown through the existing task API. Copied primitives, tokens and pointer panning come from Multica source snapshot `a1a958e562d55d3b7905a9f834b8b453daa5a7ee`; rendered acceptance uses its deployed `working-20261030T194522` frontend, reused from `insights-20261030T193945`. `pnpm build` generates the scoped CSS and rejects unexpected browser runtime dependencies. Business controls for members, accounts and external agents are excluded.

Backlog quadrant headings toggle their content and retain the priority icon, name and total count. Empty groups start collapsed; populated groups start expanded. Explicit choices persist in browser local storage. A collapsed drop target opens after 500ms of drag hover; this temporary expansion does not overwrite a saved choice.

The task detail separates request, results and activity from its property sidebar. It starts work, appends requirements, retries a failure, requests cancellation, accepts a result or reopens a task. Drafts can be edited; requirements after start append rather than overwrite. Project and execution paths are shown separately, alongside the selected strategy, branch and base commit when available.

Opening a card exposes the task commands as a pointer and keyboard alternative to dragging. Stage drops support Backlog to Queued, Awaiting review to Completed, Completed/Cancelled to Backlog, and cancellation. They call the same validated commands as task detail. Other transitions are refused; a running task cannot be marked completed by dragging. Within one stage, dropping into a priority group changes its priority. A move that changes both stage and priority is refused, so neither action is applied partially.

The expandable Routing record reads each execution round's stored Decision and Ticket: requested strategy, chosen directory mode, reason, decision id and ticket id. Open Router session navigates to the original DSH Session with the model's tool calls; the panel does not synthesize a model explanation.

Worker questions/results are shown before secondary history. **Open execution session** navigates to the native DSH conversation; **Source conversation** returns to the chat that saved the task. Attachment downloads use the active Connection. Acceptance records a human decision and starts no Git operation. Further work or integration is requested through the follow-up form. A result remains Awaiting review until accepted.

## Three questions

Opening the panel answers three questions, in this order:

1. Does anything need me now?
2. Is the system healthy and doing the right things?
3. What is the history of one piece of work, from Trigger through Eval to Ticket?

## Tabs

The tabs follow the workflow: **Overview**, **Source**, **Trigger**, **Eval**, **Execution**, and **Settings**. Until repository and account setup succeeds, Overview shows what is missing and links to the relevant setting.

| Tab | Shows |
| --- | --- |
| Overview | Tickets needing action, system problems, activity counts for the last 24 hours, and Executor load. Each block links to its detailed page |
| Source | Source state, setup problems and non-zero counts. Filtered Triggers and dropped messages cover the same 24-hour window as Overview |
| Trigger | Threads filtered by Subscribed, Evaluating, New Triggers in 24 h, or All Threads. Each Thread shows its Triggers newest first, Decisions and Subscriptions |
| Eval | Decisions with their reason and matched rules |
| Execution | Executor state, Pause processing, and Tickets filtered by Open, Pending, Working, Waiting for a Trigger or Ended. Ticket details show actions, authorization, waiting Inputs, Subscriptions and Assignments |
| Settings | Sources, Eval, Execution, Prompts and Deployment. Each group includes its save history |

### Reading individual records

A dropped message links to its Ticket, or to its Thread when it has no Ticket. The Source page explains whether its conversation disappeared or the Source stopped listening to it.

A human follow-up still owned by an Executor is marked **Delivered to Ticket**, without an Eval. The Thread also shows hand-back reasons and context-only Subscriptions. **Evaluate again** can send that follow-up to Eval, or retry a Trigger with no effective judgement: one filtered by its Source, an unavailable Eval, or a delivered message with neither a non-stop Decision nor an Executor acknowledgement.

Ticket details show the originating Trigger, Decision and reason, scope and Policy version. Assignments and secondary details are folded below the immediate actions. **Retry** is available for failed Input delivery or a Ticket waiting for a person after a blocked or failed Report. Ended Tickets show outcomes such as **Pull request merged** or **Stopped by a person**.

## Settings groups

- **Sources:** one card per Source with its switch, fields and verified account facts. GitHub also offers receive-all switches for new Issues, pull requests, comments and default-branch CI. Polling and read limits are under Advanced.
- **Eval:** the Policy version and rules, followed by **On each Source** and the Eval settings. Each Source tab contains its allowed list, membership sync, admission table and bot list. Sync runs at startup and on **Sync now**. The admission table distinguishes receiving scope, sender membership and whether the message addresses the agent. Eval settings select the accept mode, timeout and assessment model.
- **Execution:** worker model, concurrency, directory root, prepare command and blocked commands. Clicking an available variable inserts it into the prepare command.
- **Prompts:** **Edit** changes team sections, built-in parts and skills. **Full prompt** shows the assembled text and compares it with saved text or defaults. **History** lists versions. Edited built-in parts are marked changed and can be reset; templates list their required placeholders.

  An upgrade that changes an overridden default marks it **Default updated** (默认内容已更新). The panel compares the old and new defaults above the team's text. If the old default was not recorded, it compares the team's text with the new default instead. Choose **Keep my text** or **Use the new default**. Overrides for removed parts are listed below the tab bar and dropped on the next save.
- **Deployment:** startup problems with **Check again**, the state directory and machine limits. Saved limits apply without restart. The DeepSeek Harness Plugin Manager exposes the same page.

## Search

The header search finds Triggers by text, id, Feishu message id or a stored link, such as a GitHub comment URL. A Feishu link missing from the original message becomes searchable only after the host reads it during the current process lifetime.

Search also finds Threads by references such as `#12` or a GitHub URL, and Tickets by title or a matching Thread.

## Principles

1. **Focus on what matters.** Every element answers one of the three questions, or it is removed. A number appears only when it changes what the supervisor does.
2. **Precise definitions.** Categories have checkable definitions, are mutually exclusive and cover every case, as the Ticket stages do. A label says whom a row waits for and what it needs, not an internal status code.
3. **One place per concept.** Source state belongs in Source; Threads and Triggers in Trigger; Decisions in Eval; Tickets in Execution. Settings are grouped by the concept they configure. Overview summarizes these pages and links to them instead of becoming another detailed view.
4. **Domain structure.** The panel uses the domain terms. Internal identifiers appear only in folded details, and names replace identifiers where they can be resolved.
5. **Honest state.** A count equals the length of the list it links to, and no state contradicts another fact.
6. **Quiet by default.** Healthy states take no extra space. Problems must be actionable; a one-off network error is not enough. Rows needing a person offer their action directly. Keep page explanations to one sentence and put further detail in the (?) tooltip. Destructive actions require confirmation.
7. **Consistent controls.** Use DeepSeek Harness design tokens and control behavior. The same information should look the same throughout the panel. Each settings block has one save bar, visible only while changes exist, a save runs or a save fails.
