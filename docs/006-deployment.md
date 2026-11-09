# 006 Deployment

This guide covers local task setup and operation. The Ticket domain described in [001 Domain model](001-domain.md) through [005 Panel](005-panel.md) remains the execution engine underneath task drafts and human acceptance.

## Install into an existing Web profile

Use Node 24+, pnpm and DSH within `engines.dsh` in `package.json`. Configure a working DSH model route before starting tasks.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile web add "link:$PWD"
```

Restart the target DSH instance through its existing launch mechanism, then open **superagent** in the sidebar. Installing into `web` does not require a separate profile, account, listener or port. Do not recreate an existing profile with `--from-default-profile`: that replaces its configuration.

The main plugin configuration accepts `stateDir` (default `<DSH_HOME>/state/superagent`), `clientOnly` (default false) and volatile prompt/context limits. Each state directory holds a lock and `orchestrator.sqlite`. Concurrent instances must use different state directories. Independent `DSH_HOME` values also separate Sessions, durable attachments, credentials and plugin configuration.

## Models and execution

**Settings and diagnostics → Settings → Eval / Execution** selects Router and Worker models. Omitted role models use DSH's default. An explicit Router setting change applies to its next input; an unchanged role setting does not override a later manual Session choice. Worker selection initializes a new worker Session and preserves subsequent manual choices.

A fresh local deployment does not probe GitHub or Feishu, create credential wrappers, or change process-wide PATH/git settings. Retained GitHub execution settings from an earlier deployment still use their account setup checks. Removing a listener never rewrites existing records or credentials.

A task selects a server project directory. Its execution strategy is Router-selected by default or explicitly shared/worktree. The Router records its choice; the execution host validates and prepares the directory. Shared mode uses the selected directory without switching branches or running the legacy prepare command. Worktree mode records a base commit and a task branch, creates a separate checkout, and validates an existing checkout when recovering. It does not copy uncommitted project changes, merge results, remove branches or delete task directories.

Same-directory tasks may run concurrently. The global worker limit still applies. Cancellation requests the existing worker shutdown path and preserves task history and files.

## Task lifecycle

| Stage | Meaning |
| --- | --- |
| Backlog | Saved request; no Router or Worker has been started |
| Queued | Explicitly started, waiting for routing or a worker slot |
| In progress | The linked execution is active |
| Needs attention | A question, blocked/failed/waiting report, input delivery failure or Router failure |
| Awaiting review | Worker delivered a ready result; owner acceptance is pending |
| Completed | Owner accepted the result |
| Cancelled | Owner requested cancellation; files and history remain |

Follow-up requirements append to activity and reach the linked execution. A ready Ticket may resume on a human follow-up. Accepting a result does not merge, push or deploy. Integration is a separate explicit instruction. Reopening a completed/cancelled task returns it to Backlog; starting it again creates a new execution round while retaining prior Tickets.

Tasks use optimistic revisions and client command IDs. Retrying the same command returns its result without a second start or mutation. Stale edits are refused with a refresh instruction. Lists are paginated; open pages poll by default every five seconds and refresh after their own changes.

## Connection and attachments

The plugin exposes `superagentTasks/request` through DSH Gateway. Browser and remote clients use the currently selected authenticated Connection; they do not fetch a remote client's localhost or open another management listener. Task APIs cover draft creation/editing, start, follow-up, retry, cancellation, acceptance, reopening, directory discovery and attachments. The retained `/orchestrator/api/` compatibility routes mount only on a loopback web listener and retain their same-origin header checks.

The Host-side Remote bridge must explicitly allow this unary endpoint. Stock `ds-harness-remote@0.6.3` refuses it. The companion checkout at `/data/ida/ai/ds-harness-remote` adds the exact endpoint and refuses stream calls; it must be built and installed on the target Host before desktop remote access can use the task page. No Client-side Remote change or extra listener is needed. Remote does not distribute third-party client modules: the desktop profile must also load the Superagent bundle, setting its main entry's `clientOnly: true`. That entry starts no local task database, Router or Worker; its client UI uses the selected Connection. A local-only desktop without a task Host will report an unavailable method instead of starting tasks locally.

Images and generic files are admitted through `ctx.attachments` and saved in DSH's durable attachment store. Tasks hold references, and execution delivery uses native image/file content parts in the Session log. File paths are projected by DSH for tools; unsupported model image capabilities remain a model-route decision. Downloads also use the authenticated Connection. Uploads and the Connection retain their existing admission/body policies; cancelled drafts may leave unreferenced immutable objects under DSH's normal retention behavior.

The ordinary-Session tools `superagent_task_create`, `superagent_task_list` and `superagent_task_get` share the same task service. The create tool saves only a draft, records its source Session, defaults to its server cwd and can reference selected files/images in the most recent user message. Internal Router/Worker presets remain registered and hidden from the ordinary mode picker.

## Isolated acceptance

Use a fresh temporary `DSH_HOME`, a fresh profile copied from the Web template, and an unused loopback port. Install this checkout into that temporary profile. Configure only the model routes needed for testing; never mount a production task database or work directory.

Verify draft saving produces no model request, then start a small task in a temporary directory. Check the actual output file and native Session events, require **Awaiting review**, submit a follow-up, and accept the final result. Also verify worktree branch/base recovery, cancellation, stale/duplicate commands, image/file delivery, a normal chat creating a draft, and an authenticated call through an alternate Connection carrier.

In a real browser cover desktop and a 390px viewport, keyboard focus, long titles, empty results, upload failures and failed/offline reads. Test attachment download after restart. Screenshots and test logs belong to the acceptance artifacts, not the task database. Stop the temporary instance when verification finishes.

For Router acceptance, run `node scripts/accept-router.mjs --url http://127.0.0.1:8081 --home <test-DSH_HOME> --cookies <private-cookie-JSON> --output <artifact-directory>` with Node 24 and Git. The script requires an authenticated local test instance and a working role model. It creates its own fixture directories and fifteen tasks: three variations each of non-Git file work, Git read-only work, automatic Git code isolation, explicitly shared Git work and concurrent independent worktrees. Results preserve correlated Router calls and successful tool results, actual directories, file hashes, uncommitted-file checks and task/ticket identities. A refused attempt followed by a corrected call is recorded separately from duplicate execution. `--resume` rechecks the same tasks and files without starting new model runs; `--scenario` and `--repetitions` narrow a new run. Fixtures and task history are retained.

## Upgrade and recovery

Back up `orchestrator.sqlite` while the instance is stopped, together with the instance's Sessions and attachments. Schema 12 adds task, asset and command records; schema 11 execution records remain intact, and the existing schema 10 migration runs before the additive upgrade. A database marked with a newer schema is refused. Rollback requires the matching pre-upgrade backup.

Priority and due date are optional fields on stored task records. Earlier records read as no priority/no date without a data rewrite; the routing view projects existing decision and ticket records.

The bundle no longer includes `github-watch` or `feishu-watch`. Old channel records remain readable in diagnostics; no Multica history is imported automatically. Keep both internal preset registrations while their Sessions exist so they can resume.

Task setup/model errors belong in the task detail and advanced diagnostics. Fix a missing directory or model route before retrying. A worktree mismatch is an error; the host does not replace an unrelated directory. Restart recovery must preserve assigned directories and avoid launching an already accepted command twice.
