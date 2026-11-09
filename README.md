# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent provides a local task board for [DeepSeek Harness](https://www.deepseek.com/en/harness/). Save requests without starting a model, explicitly start work, let the Router choose a shared directory or Git worktree, and review the Worker's result before accepting it. Web and remote clients use the same authenticated DSH Connection and server-side task data.

## Use

The **Tasks** sidebar entry opens the board. Create a task with a title, request, server directory and optional images or files. Saving puts it in **Backlog**. **Start task** queues it for the Router and Worker. Questions and failures appear in **Needs attention**; ready results appear in **Awaiting review**. **Accept result** records your acceptance; merging, pushing and deploying require a separate request.

The board supports importance/urgency quadrants in Backlog, due dates, column visibility, directory/priority filters and a compact list view. Priority and date changes do not start models. Task details show the persisted routing choice and link to the Router's native Session. Dragging uses the same start/review/cancel actions as the buttons; a running task cannot be dragged directly to completion.

The task surface reuses Multica UI components, tokens and fonts with styles isolated from the DSH shell. It supports horizontal wheel scrolling and blank-area panning, independent column scrolling, virtualized large lists, and detail navigation that restores the view position. Frontend dependencies are bundled with the plugin; React comes from DSH. Copied Multica components retain their [license](src/client/multica/LICENSE.multica).

Ordinary DSH conversations also have `superagent_task_create`, `superagent_task_list` and `superagent_task_get`. Creation saves a draft and returns its ID and task link. It does not start work. The tool can copy explicitly selected attachments from the current user message and defaults to that Session's directory.

## Build and install

Requires Node 24+, pnpm and DSH `0.2.2-rc.1` APIs, with a working model route configured in DSH.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile web add "link:$PWD"
```

The install command changes the selected profile. Use your normal DSH restart procedure after installing. No dedicated profile, GitHub account, Feishu bot or extra port is required for local tasks. State defaults to `<DSH_HOME>/state/superagent`; `stateDir` can override it. See [SETUP.md](SETUP.md) and [006 Deployment](docs/006-deployment.md) for setup and isolated acceptance instructions.

Desktop remote mode requires a Host-side Remote build that allows `superagentTasks/request`. Unmodified `ds-harness-remote@0.6.3` blocks this endpoint; the companion fix is in `/data/ida/ai/ds-harness-remote`. The desktop profile must also load this bundle's UI, with `clientOnly: true` on its `dsh-superagent` entry to avoid a second local orchestrator. Remote carries business data, not third-party UI code. Web access does not require Remote.

## Execution and isolation

The Router and Worker use internal presets hidden from ordinary mode selection. Their host registrations remain available for creating and restoring managed Sessions; Session headers still show the mode actually in use.

For automatic directory selection, the Router receives the selected project path and requested strategy. Git code changes normally use a separate worktree; reading, non-Git files and existing environment operations use the selected directory. A task can override the choice. Multiple tasks may share a directory concurrently, subject to the global worker limit. Worktrees record their branch and base commit, preserve results across restarts, and are not automatically deleted or merged. Uncommitted changes in the project directory are not copied.

Tasks, attachments, settings and Sessions belong to the server's DSH instance. Separate `DSH_HOME` values isolate instances. Local execution inherits DSH's environment without replacing process-wide PATH or git configuration. Legacy GitHub/Feishu protocol readers remain for existing records, but their listener plugins are not included. Existing configured GitHub execution settings retain their account checks; a fresh local setup needs none.

## Documentation

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md)
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md)

The core domain documents describe execution Tickets and retained source protocols. The task board adds drafts and human acceptance around that execution lifecycle; it does not import Multica history.

## License

[MIT](LICENSE)
