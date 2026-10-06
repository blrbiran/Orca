# Agent entry (N2): control socket, `orca control` CLI, skill and MCP bridge — design

Owner: Claude Code session `6cc0c1e9`; date: 2026-10-07 Asia/Shanghai.
Status: written design for human review; no implementation yet.
Source observation: Orca main at `9912d23` (subject `docs(sdd): record the post-fix-wave gate of the project filtering round`).
Goal reference: `docs/handoff/goal.md` §3.2 and item N2 (CLI `--json` → skill → MCP thin shell).

## 1. Intent and agreed scope

An AI agent (Claude Code, Codex, or anything that can run a command or speak MCP) must be able to read Orca's control state and deliver control commands to a running panel, so that work the human now does by clicking in the Web UI can also be done by an agent acting for that human.

Human rulings in this design's conversation:

- H1. One spec covers all three layers; implementation order is CLI → skill → MCP.
- H2. Direction: the panel exposes its existing control routes on a unix domain socket (owner-only file permissions instead of a token). Agreed after studying openclaw (one Gateway, deterministic discovery, MCP server as an ordinary client, no auto-start) and hermes-agent (fixed-path `gateway.sock`, mode 0600, bound only after the pidfile claim is won).
- H3. Agents may do everything the Web UI can, except set a budget amount (the human's reason, paraphrased: behind an agent there is often a person operating it). The human-only surface is every input that sets a group's limit: the verb `set-limit`, the optional `limit` field of `requirement-open`, and the optional `proposedGroupLimit` field of `proposal-edit` (§5).
- H4. A global spend cap across groups is out of scope (§10).

Success: with a panel running, `orca control get summary` prints the control summary as JSON, and `orca control send …` delivers a command whose result is retrievable by its commandId; the same works through `orca mcp serve`; with no panel running both answer `panel-not-running` and start nothing; the Web UI and `--no-control` behave byte-for-byte as before.

Not in this round: event streams or push notifications, remote (cross-machine) agent access, a global spend cap, Web UI display of command client attribution, modelling a run as an MCP Task (goal.md §6 item 4), any scheduler, ccloop or ccmem change.

## 2. Observed state and approaches

The panel already serves a complete control API at `/api/control/*` (`src/panel/controlApi.ts`): read routes registered by `registerControlReadRoutes` (:109) and 23 mutation routes in the table at :259, all funnelled through one handler (:331) that parses `commandEnvelopeSchema` (`{commandId, expectedRevision, payload}`), adds `actorId = ensurePanelOperatorId(store)`, the route's verb and target, and calls the service. Results are idempotent by commandId and retrievable at `GET /api/control/groups/:scope/commands/:commandId`. Access needs the one-time `x-orca-token`, printed on the panel's stdout ready line (`src/cli.ts:346`) and injected into the HTML; agents have no stable way to obtain it. The control store is single-writer (`src/control/store.ts` `service-lock`), so no second process may open it.

Approaches considered:

1. Recommended: the panel also listens on a unix socket in its control state directory, serving the same control routes with no token; the CLI and the MCP bridge are clients of that socket. One writer, one validator, auth by filesystem permission.
2. Publish the TCP token to a 0600 file and have clients read it. Works, but adds a credential file with its own lifecycle and leaves every request going through Host and token checks designed for browsers.
3. A CLI or MCP server that opens the store directly. Impossible while a panel runs (`control-writer-active`) and would duplicate recovery and the wake pump; hermes can do this only because it allows multiple SQLite writers.

Choose approach 1. The wire protocol stays HTTP + JSON (goal.md §3.2's "HTTP first"); only the transport for agents changes.

## 3. Panel side: the control socket

### 3.1 Where and when

- Path: `<stateDir>/control.sock`, where `stateDir` is the resolved control state directory (`resolveControlOptions`, `src/panel/controlOptions.ts`). In the default file/registry mode that is `$ORCA_CONTROL_DIR/panel`, i.e. `~/.orca/control/panel/control.sock` unless relocated.
- Bound only when the control plane assembled (`control !== null` in `createPanelServer`), therefore only by the process holding the store's `service-lock`, and only after recovery completes (the same ordering as the TCP listen, ruling R4 of the assembly design).
- The path is built from the store's resolved state directory (`privateDirectory` realpaths it; on macOS `/tmp/…` becomes `/private/tmp/…`, 8 bytes longer), and the `sun_path` length check (§3.3) applies to that exact string.
- Because the lock is held, any existing `control.sock` is a leftover of a dead owner: unlink it (only if it is a socket; any other file type at that path is refused, see §3.3), then listen, then `chmod 0600`. Between listen and chmod the socket carries umask permissions; the window is closed by the directory, which `openControlStore` creates 0700 (`privateDirectory`, `src/control/paths.ts:5`). An existing directory's mode is not changed (Rule 17); the socket's own 0600 still applies once set, since connecting needs write permission on the socket file.
- `--no-control`, or a panel that lost the store to another process: no socket; behaviour byte-for-byte as before.

### 3.2 What it serves

A second express app on a second `http.Server`, built in `createPanelServer`, sharing the same `control` runtime object (store, service, config, port, epoch):

- `express.json({ limit: "64kb", verify: verifyControlJsonBody })`, as the TCP app.
- `registerControlReadRoutes` with the same deps (it registers the mutation routes itself, `controlApi.ts:110`, and the `/api/control` 404 and error handlers), plus a channel argument `"socket"` that it passes on to `registerControlMutationRoutes` (the TCP app passes `"web"`).
- No static route, no token middleware, no Host allowlist (there is no network peer), none of the non-control `/api/*` routes (reviews, corrections, metrics, chains, memory, projects).
- The client header check (§4.2) and the human-only gate (§5) apply on the socket channel only.

### 3.3 Lifecycle and failure

- Shutdown: the socket server stops accepting in the same path as the TCP server (signal handler and `close()`), before `control.close()` releases the store, so no socket request reaches a closed store; in-flight requests meet the same admission gate as Web requests. `control.sock` is unlinked once the socket server has closed. Clients send `Connection: close`, so no idle keep-alive connection holds the close open. A crash leaves the file; the next owner unlinks it (§3.1).
- If the socket cannot be bound (path longer than the platform's `sun_path` limit — 104 bytes on macOS, 108 on Linux — or a non-socket file at the path, or a listen error), the panel still starts and serves the Web UI, and writes one stderr line `orca-panel: control socket unavailable: <code>` with code `control-socket-path-too-long`, `control-socket-path-occupied` or `control-socket-listen-failed`. Rationale: the socket is an additional entry; refusing to start would take the human's own UI away over it. The line is the loud failure (Rule 12).
- The stdout ready line gains a field: `orca-panel ready url=… token=… socket=<path>` when bound, unchanged otherwise. (Any test that parses the ready line must keep passing; the field is appended.)

### 3.4 Out-of-repo writer registration (Rule 17)

| Path | Written by | Mode | Residue on failure |
|---|---|---|---|
| `<stateDir>/control.sock` (default `~/.orca/control/panel/control.sock`, relocated by `ORCA_CONTROL_DIR` or `--control-state-dir`) | `orca panel` at startup, after recovery, when the control plane mounted | socket 0600 in a 0700 directory | a dead socket file after a crash; the next panel that wins the store lock unlinks it |

Every criterion uses a temporary `ORCA_CONTROL_DIR` under a short `TMPDIR`.

## 4. CLI: `orca control`

### 4.1 Commands

```
orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
orca control send <route> --expected-revision <n> (--payload <json> | --payload-file <file>)
                  [--command-id <id>] [--control-state-dir <dir>] [--client-name <name>]
```

- `<path>` is a control read path without the `/api/control/` prefix: `config`, `summary`, `groups`, `groups/<id>`, `groups/<id>/requirement`, `groups/<scope>/commands/<commandId>`, `recovery`, `repositories/<id>/workspace`, `operator/agent-preferences`, `agents`, `groups/<id>/agent-preview`, `runs/<id>/evidence`. A query string is passed through (`summary?sinceChangeSeq=…`). The binary artifact route (`runs/<id>/evidence/<artifactId>`) is refused locally by name (`control-cli-binary-route`); agents read the manifest instead.
- `<route>` is a mutation path without the prefix, e.g. `groups/g1/requirement/answer`, `requirements`, `recovery/retry`.
- The CLI is a generic passthrough. It does not know the 23 verbs or their payloads; the panel's zod schemas remain the one validator. The CLI validates only what it needs to build a request: path syntax (no `..`, no leading `/`, ASCII segments), `--expected-revision` a safe non-negative integer, payload parsing as JSON, `--command-id` matching `idSchema`.
- Without `--command-id`, the CLI generates `cli-<uuidv4>` (matches `idSchema`).

### 4.2 Client attribution header

Every socket request carries `x-orca-client`: `cli` or `cli:<name>` from the CLI, `mcp` or `mcp:<name>` from the bridge; `<name>` matches `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$` (from `--client-name`, or the MCP client's reported name when it matches, else omitted). A socket request without a valid header is answered 400 `control-client-invalid` before any route logic, and is not ledgered. The Web channel ignores the header and is attributed `web`.

### 4.3 Discovery

Socket path, first match wins, mirroring how the panel resolves its state directory in the default file/registry mode (`controlOptions.ts:135`):

1. `--control-state-dir <dir>` → `<dir>/control.sock`;
2. the projects file's `controlStateDir` (`src/panel/projectsFile.ts:16`), read-only, from the same path the panel uses (`projectsFilePath(env)`), when the file exists, parses, and sets it;
3. `$ORCA_CONTROL_DIR/panel/control.sock` if `ORCA_CONTROL_DIR` is set and non-empty;
4. `~/.orca/control/panel/control.sock`.

A projects file that exists but does not parse is not guessed past: local error `control-projects-file-invalid`. A panel started with an explicit `--control-state-dir`, `--projects-file` elsewhere, or in legacy `--repo` mode needs the same directory passed to the CLI.

- Socket file absent, or connect fails with `ECONNREFUSED`/`ENOENT`: local error `panel-not-running`, message naming the path tried and the next step (`start it with: orca panel --by <who>`). Never auto-starts a panel.
- Path longer than the `sun_path` limit: local error `control-socket-path-too-long`.

### 4.4 Output contract

stdout always carries exactly one JSON object followed by a newline, and nothing else:

```json
{"schema":"orca-cli-response-v1","status":200,"commandId":"cli-…","body":{…}}
```

- `status`: the HTTP status the panel answered; `0` for a local error.
- `commandId`: present for `send` (given or generated), absent for `get`. It is here because the panel's error body does not carry it, and an agent retrying after a timeout or a `retryable` error must resend the same commandId.
- `body`: the panel's response body, verbatim (error codes are not translated). For a local error: `{"error":{"code":"<local code>","message":"…","retryable":<bool>}}` (`panel-not-running` is retryable; argument errors are not).

Exit codes: `0` panel answered 2xx; `1` local refusal (bad arguments, `panel-not-running`, path too long); `2` panel answered non-2xx (the body names the code and `retryable`); `3` unhandled error (existing CLI convention). stderr is free-form diagnostics and never needed to interpret the result.

## 5. The human-only gate

On the socket channel only, before the command envelope is turned into a raw command and before any service call:

- Verb `set-limit`: refused 403 `control-verb-human-only`.
- Verb `requirement-open` whose payload object has an own property `limit`: refused 403 `control-field-human-only` (message names the field). Without it, the requirement opens with the default clarifying limit, as from the Web UI.
- Verb `proposal-edit` whose payload object has an own property `proposedGroupLimit` (`webProtocol.ts:679`, applied at `webService.ts:359`): refused the same way. Allocation operations without it stay open; they are bounded by the existing limit (the reserve is the residual of it).

The rules are code constants in one module: `HUMAN_ONLY_VERBS = ["set-limit"]` and `HUMAN_ONLY_FIELDS = { "requirement-open": ["limit"], "proposal-edit": ["proposedGroupLimit"] }`. A criterion walks the raw command payload schemas for every `amountSchema` field and fails on any that is neither human-only nor listed, with a reason, in `AGENT_AMOUNT_FIELDS` (C19), so a future verb that carries an amount cannot slip past unreviewed. A refusal uses the existing error envelope (`sendControlError`), carries `retryable:false`, and writes nothing to the command ledger (like a schema refusal today), so an agent cannot burn a commandId against it.

Rationale (recorded from the conversation): the group budget limit is the bound under which every other agent-permitted action (confirm, start, resume, retry, continue) stays safe; an agent able to raise it removes that bound. `import-plan` needs no gate: its limit is computed from the plan (`src/control/planImport.ts:267`), not supplied. Agents reduce spending with `pause-dispatch` and `handoff-stop`, so lowering the limit is not needed and the whole verb is gated rather than only increases.

All other verbs and all reads are open to socket clients.

## 6. Identity and attribution

- `actorId` stays `ensurePanelOperatorId(store)` on both channels. It is load-bearing: agent preferences and estimator slots are keyed by it (`src/control/agentPreferences.ts:45`, `webService.ts`), and `set-agent-preferences` requires target = actor. An agent acts as the panel's operator.
- Attribution: migration `schema6To7` adds `ALTER TABLE commands ADD COLUMN client TEXT;` (null for rows written before it and for rows not originating from a route, e.g. recovery or the wake pump). Values: `web`, or the validated `x-orca-client` header value.
- The value reaches `persistCommandOutcome` (`src/control/commandLedger.ts`) through an `AsyncLocalStorage` set by the route handler around the service call, holding `{ commandId, client }`; it is written only when the row's commandId equals that commandId, so work the call leaves running in the background (which inherits the async context) cannot stamp another row. It does not travel in the raw command, so it enters neither `rawRequestHash` nor `authorityCommandHash`, and the 23 service methods keep their signatures. A replay of an existing commandId writes no new row, so the original's client is kept.
- `client` is attribution only: never read for authorization, never returned in response bodies this round.

## 7. Skill

`skills/orca-control/SKILL.md` in this repository: frontmatter `name: orca-control` and a description that triggers on operating Orca from an agent. It teaches:

1. Read before write: `orca control get groups/<id>` (or `summary`) for the current revision, then `send` with `--expected-revision`; on `revision-conflict` re-read and decide again.
2. Idempotency: keep the `commandId` from the output envelope; after a timeout or a `retryable` error, resend with the same `--command-id`; check a result with `get groups/<scope>/commands/<commandId>`.
3. Long work: runs take minutes to hours; poll the group view at a modest interval instead of waiting on a command.
4. The human-only surface (§5) and `panel-not-running` (ask the human to start the panel; never start one).
5. A route table: each mutation route, its verb, and a minimal payload example taken from the schemas in `src/control/webProtocol.ts`.

Distribution is out of scope: no write to any real skills directory in this round; the human installs it (or syncskill does, later).

## 8. MCP bridge: `orca mcp serve`

- stdio MCP server using `@modelcontextprotocol/sdk` (new runtime dependency; the human sees it in the plan before it is added).
- Two tools, thin over the same socket client module as the CLI:
  - `orca_read { path: string }`
  - `orca_send { route: string, expectedRevision: integer, payload: object, commandId?: string }`
- Each returns the CLI's `orca-cli-response-v1` envelope as JSON text content; a non-2xx or local error sets the tool result's `isError: true`. Discovery and `x-orca-client: mcp[:<name>]` as §4.2–§4.3; `--control-state-dir` accepted on `serve`.
- No resources, no prompts, no MCP Tasks, no store access, no auto-start.

## 9. Criteria

All criteria use a temporary `ORCA_CONTROL_DIR` and HOME under a short `TMPDIR`, start a real panel (`--no-control` where stated), run no paid model and touch no real `~/.orca`.

| # | Criterion |
|---|---|
| C1 | Panel with control: `control.sock` exists, is a socket, mode 0600; ready line ends with `socket=<path>`. |
| C2 | Stale socket: a leftover socket file at the path is replaced and the new socket answers; a regular file at the path yields the `control-socket-path-occupied` stderr line and a working Web UI. |
| C3 | Shutdown (signal and `close()`) removes `control.sock`. |
| C4 | `--no-control` and a panel that lost the store: no socket; existing panel criteria unchanged. |
| C5 | Socket serves no token-protected non-control route (e.g. `/api/reviews` → 404) and no static page. |
| C6 | CLI `get summary` returns envelope status 200 and a body matching `controlSummarySchema`; exit 0. |
| C7 | CLI `send` of an agent-permitted command (e.g. `requirement-open` without limit, or `pause-dispatch` on a fixture group) returns 2xx; `get groups/<scope>/commands/<id>` returns the same body; resending with the same `--command-id` replays byte-identically. |
| C8 | Generated commandId matches `idSchema` and is echoed in the envelope even when the panel answers an error. |
| C9 | `set-limit` over the socket → 403 `control-verb-human-only`, exit 2, ledger row count unchanged; same route over the Web channel still works. |
| C10 | `requirement-open` with `limit`, and `proposal-edit` with `proposedGroupLimit`, over the socket → 403 `control-field-human-only`, no ledger row; without the field → accepted. |
| C11 | Missing or malformed `x-orca-client` on the socket → 400 `control-client-invalid`, no ledger row. |
| C12 | Attribution: a socket command's row has `client` = the header value; a Web command's row has `web`; the same command (same commandId, revision and payload) sent once over each channel to two fresh stores yields byte-equal `raw_request_hash` and `authority_command_hash`; a row written by background work after the route returns has `client` null. |
| C13 | Migration: a version-6 store upgrades to 7 with existing rows' `client` null; a fresh store has the column. |
| C14 | No panel: CLI and `orca_read` answer `panel-not-running`, exit 1, and no process is spawned. |
| C15 | Socket path over the limit → local `control-socket-path-too-long` (CLI) and the stderr line (panel). |
| C16 | CLI output: stdout is exactly one JSON line in every outcome, including local errors. |
| C17 | MCP: an SDK client over stdio lists exactly `orca_read` and `orca_send`; both round-trip against the panel; a human-only refusal comes back with `isError: true` and the panel's code. |
| C18 | Skill file exists with valid frontmatter and every route it lists exists in `controlApi.ts`'s table (a mechanical check, so the table cannot drift). |
| C19 | A walk of the raw command payload schemas (`rawAuthorityCommandVariants`) finds every `amountSchema` field; each is either covered by `HUMAN_ONLY_VERBS`/`HUMAN_ONLY_FIELDS` or listed in a code constant `AGENT_AMOUNT_FIELDS` with a one-line reason; any other fails the criterion. |
| C20 | Discovery: with a projects file setting `controlStateDir`, the CLI finds the panel's socket with no flag; an unparsable projects file → `control-projects-file-invalid`. |

Mutation coverage (Rule 9): for each new branch — the stale-socket unlink, the chmod, the shutdown unlink, the human-only verb check, each human-only field check, the client header check, the `client` write, the commandId match on the `client` write, the projects-file step of discovery, the discovery order, `panel-not-running`, the exit-code mapping — the plan names the deletion mutation and the criterion that must turn red, run in a `git clone --local` copy.

Regression gates: `npm test`, `verify:control`, `verify:panel`, typecheck, web check, the tmp-leak check, all in an isolated clone with HOME and the four XDG variables relocated.

## 10. Known not done

- The limit bounds spending only as tightly as the budget mode does; this design does not change what `strict` and `soft` mean (`strict` currently refuses with `strict-proof-unimplemented`, `executionDriver.ts:218`). Agents get the same bound the Web UI has.
- No global spend cap. An agent (or the Web UI today) can open many requirements or plans, each with its default limit; total exposure is groups × default limit. A later design can add a cap at the operator scope.
- Client attribution is stored but not shown anywhere.
- No event stream; agents poll.
- The socket is single-machine; cross-machine access stays deferred (goal.md §3.8).
- A panel started with a custom `--control-state-dir` is found only if the agent is told the same directory.

## 11. Rulings needed from the human

None open. H1–H4 are recorded in §1. The new dependency (`@modelcontextprotocol/sdk`) is listed again in the plan for explicit approval before it is installed.
