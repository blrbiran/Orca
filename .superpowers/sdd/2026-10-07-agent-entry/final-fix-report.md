# Final-review fix wave report — N2 agent entry

Who: final fix agent, session 6cc0c1e9 (orca-dev-6cc0c1e9). When: 2026-10-07. Base: 145467b. Result HEAD: 8b8a022 (main, not pushed).
Scratch: /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6cc0c1e9-7313-4a5e-942a-f02129bf4027/scratchpad/n2/ff (all outputs cited below live there).

Status: DONE_WITH_CONCERNS (one deletion mutation survives for a known reason, see Concerns).

## Commits

| SHA | Subject | Findings |
| --- | --- | --- |
| 786d959 | fix(entry): turn transport and discovery I/O failures into envelopes | I1, H3 (test), H5, H6 |
| affbb4a | fix(panel): require the control channel and fail loud without a gated client | H1, H7, triage 10 |
| d82826f | test(entry): harden the C19 walker, the C12 Web header and child envs | H2, H4, triage 18 |
| 8b8a022 | docs(skill): say where each revision and id comes from; correct the gate's reach | I2, I3 |

I4 is evidence only (no commit): mutation M6 below.

## Per finding (line numbers measured at 8b8a022 with grep -n)

I1. `src/entry/socketClient.ts`:7 `RETRYABLE_TRANSPORT = {ECONNRESET, EPIPE}`; :10-13 `transportRejection` maps any non-EntryRejection error to `EntryRejection("control-socket-error", "<code>: <message>", retryable = code in the set)`; :31-40 `http.request` now runs inside try, the synchronous `ERR_UNESCAPED_CHARACTERS` throw is rejected through the mapping; :45 the error handler's last arm is `reject(transportRejection(error))` (was `reject(error)`). `controlSend` already returns `localError(error, commandId)`, so the commandId survives (tested). I also took the brief's optional path: `src/entry/operations.ts`:14 `checkPath` refuses a query that is not printable ASCII (`/^[\x21-\x7e]*$/`) with `control-cli-path-invalid` before any request; the socketClient try/catch stays as defence for anything else http.request refuses. Discovery: `src/entry/discovery.ts`:19-21 wraps `readProjectsFile` (whose `signatureOf` rethrows EACCES/ENOTDIR) as `control-projects-file-invalid`. Usage: `src/cli.ts`:117 adds "3 is reserved for crashes (unexpected errors)"; `tests/panel/usage.test.ts` asserts it. SKILL.md lists `control-socket-error` (:67-68).
Tests: new `tests/entry/socketClient.test.ts` (drop mid-request → envelope status 0, `control-socket-error`, retryable true, message `ECONNRESET: …`, commandId echoed, exit 1; sync throw → rejection; `summary?x=a b` / non-ASCII / tab → `control-cli-path-invalid`, zero requests); `tests/entry/discovery.test.ts` ENOTDIR case (parent is a regular file) → `control-projects-file-invalid` with "ENOTDIR" in the message. EACCES is not separately tested (same code path as ENOTDIR).

I2. Spec `docs/superpowers/specs/2026-10-07-agent-entry-design.md`:209 new "## 13. Correction after the final review (2026-10-07, session 6cc0c1e9)", appended only; earlier sections untouched. Facts verified before writing: the static route in `src/panel/api.ts` (buildApi) is registered before the `/api` token middleware and serves `index.html` for `/`; `src/panel/staticFiles.ts`:93 injects `window.__ORCA_TOKEN__`. Route count verified: 22 `path: "/api/control/..."` entries in `registerControlMutationRoutes`, `commandVerbSchema` (`src/control/webProtocol.ts`:591) has 23 verbs including `shutdown`. SKILL.md:56 adds "The refusal is a policy for agents, not a security boundary: do not look for a way around it (not the Web UI's token, not the control store)." (existing "Do not look for a way around them" kept).

I3. SKILL.md:102 new "## 9. Where the expected revision comes from", plus a miss-handling bullet in section 4 (:40) and section 3 step 1 now points at section 9. Verified against code:
- The revision check is `src/control/commandLedger.ts` preflight/apply: current revision = setting revision for repository/operator scopes, else the group row's `revision`, else 0 when no group row exists.
- Group-scoped: `groupViewSchema.summary.commandRevision` (`get groups/<id>` → `.summary.commandRevision`); a clarifying group's group view is refused (DR25), so `requirementViewSchema.summary.commandRevision`; or `controlSummarySchema.groups[].commandRevision`.
- requirement-open and import-plan for a new groupId: `0` — confirmed by the ledger rule above and by `tests/panel/requirementRoutes.test.ts` / `tests/control/planImport.test.ts` using `expectedRevision: 0`.
- recovery-retry: route target is the payload's group (`scope:"group"`) or the run's group (`scope:"run"`, `controlApi.ts` recovery-retry target looks up `runs.group_id`), so the revision is that group's `commandRevision`; run ids from `get recovery` `.blockers[]` (`recoveryViewBlockerSchema` has `groupId`, `runId`) or `.summary.requirement.blockedRun.runId`.
- set-workspace-mode: `repositoryWorkspaceSchema.revision`, 0 when no row (`readWorkspaceSetting`). set-agent-preferences: `agentPreferencesViewSchema.revision`, 0 when no row (`readAgentPreferences`).
- Ids: `controlConfigSchema.repositories[].repoId`, `.plans[].planId` (+ `repoId`), `agentPreferencesViewSchema.operatorId`.
- Miss handling: confirmed `@repository:`/`@operator:` misses answer `group-not-found` (`readVersions` in `src/control/queries.ts`:36-39 throws it when there is no group row); the skill now says to replay with the same `--command-id` rather than infer absence.
`tests/entry/skill.test.ts` gains the new phrases; its route/verb/payload checks still pass (new table rows do not start with `` `POST ``).

I4. See mutation M6 (seen red for the right reason, after a first attempt that was red for the wrong reason — see below).

Triage 10. `src/panel/controlApi.ts`:111 comment now: "socket" applies the human-only gate and records the header's client; "web" records "web".

Triage 18. `tests/entry/panelSocketE2e.test.ts`: `childEnv()` puts `ORCA_AGENTS_TABLE: ""`, `ORCA_CCLOOP_BIN: ""` before the test env (both spawn sites use it); `tests/entry/mcp.test.ts` likewise. When `boot(…, { port: true })` configured a fake port, `w.env` is spread after and carries the fixture's values. Empty is the explicit "no port" answer (`controlOptions.ts`:110, `ccloopBin.ts` header).

H1. `controlApi.ts`:114 and :257 — `channel` is required. Callers updated: `src/panel/api.ts`:190 passes "web"; `controlSocket.ts` already passed "socket"; test callers `tests/panel/requirementApi.test.ts`, `tests/control/agentFreeze.test.ts`, `tests/control/proposal.test.ts`, `tests/control/stopIntent.test.ts` pass "web" (allowed by the brief).

H2. `tests/panel/humanOnly.test.ts`: whitelist of leaf kinds; anything else throws `unhandled zod kind <Name> at <verb>:<path>`. It threw for `ZodRecord` at `set-agent-preferences:preferences.perAgent`, so the walker now recurses into `valueSchema` (path segment `{}`), as the brief required. No new amount field surfaced.

H3. `tests/entry/socketClient.test.ts` "D3": fake server never answers, `timeoutMs: 50` → `control-socket-timeout`, retryable true. (Passed before any code change: it covers existing behaviour.)

H4. `tests/panel/controlSocketGate.test.ts` C12: the Web POST carries `x-orca-client: cli:x`; the existing assertion that the row's client is "web" now covers "Web ignores the header". (Passed before and after: the behaviour was already right.)

H5. `discovery.ts`:13-14 — an explicit `--control-state-dir ""` is `control-cli-argument-invalid` (in discovery, so both the CLI and `orca mcp serve` get it). Tests in discovery.test.ts and controlCommand.test.ts.

H6. `socketClient.ts`:27 — `control-cli-response-invalid` retryable true. Test in socketClient.test.ts.

H7. `controlApi.ts`:340-343 — the client is computed first in the route's try; on the socket channel a non-string `res.locals.orcaClient` throws, mapped to 500 `control-internal-error`, before anything is parsed or booked. Test: new `tests/panel/controlChannel.test.ts` mounts the routes with channel "socket" and no header gate → 500 `control-internal-error`, no ledger row.

## TDD red (before the fixes), red1.txt

All new tests were run before the code changes: 9 failed as intended (I1 ×3, discovery ENOTDIR, H5 ×2, H6, H7, H2 walker on ZodRecord); H3 timeout and H4 passed (existing behaviour). Read whole.

## Verification (at the tree committed as 8b8a022; status clean)

| Command | Output file | Result |
| --- | --- | --- |
| `npm run typecheck` | tc.txt | rc=0 |
| `npx vitest run tests/entry tests/panel tests/control/commandClient*.test.ts tests/control/web*.test.ts` | suite.txt | 71 files passed; 534 passed, 3 skipped (the skips are in tests/control/webCcloopSmoke.test.ts, pre-existing); rc=0 |
| `npx vitest run tests/control/agentFreeze.test.ts tests/control/proposal.test.ts tests/control/stopIntent.test.ts` (edited callers, outside the brief's set) | callers.txt | 3 files, 70 passed; rc=0 |

The full suite was not run (per brief; the controller's isolated gate does).

## Mutations (Rule 9), clone `n2/mut-ff` (`git clone --local` at 8b8a022, node_modules symlinked; web/dist symlinked for M6)

Each: apply, run the named test, record, `git checkout -- .`, then `git diff` and `git diff --cached` byte counts. Runner: ff/mut.py, ff/runmut.py, ff/runmut2.py. M1 was run by hand before the runner.

| # | Finding | Mutation | Test | Red evidence | Restore (diff / cached bytes) |
| --- | --- | --- | --- | --- | --- |
| M1 | I1 | `else reject(transportRejection(error))` → `else reject(error)` | socketClient.test.ts | "drops the connection" fails: `Error: socket hang up` (m1.txt) | 0 / 0 |
| M1b | I1 | sync-throw catch → `throw error` | socketClient.test.ts | "unsendable path" fails: got TypeError `ERR_UNESCAPED_CHARACTERS` (m1b.txt) | 0 / 0 |
| M1c | I1 | query ASCII guard → `if (false)` | socketClient.test.ts | "refuses a query" fails: code `control-socket-error` not `control-cli-path-invalid` (m1c.txt) | 0 / 0 |
| M1d | I1 | discovery catch → `throw error` | discovery.test.ts | ENOTDIR case fails: raw `Error: ENOTDIR: not a directory, stat …` (m1d.txt) | 0 / 0 |
| M2 | H5 | delete the empty-flag check | discovery.test.ts, controlCommand.test.ts | both empty-flag tests fail; CLI answers `panel-not-running` (m2.txt) | 0 / 0 |
| M3 | H6 | drop `, true` on response-invalid | socketClient.test.ts | "not JSON" fails: retryable false (m3.txt) | 0 / 0 |
| M5 | H7 | delete the `typeof client !== "string"` guard | controlChannel.test.ts | SURVIVED, rc=0 (m5.txt). See Concerns | 0 / 0 |
| M5b | H7 | restore the old coercion `String(res.locals.orcaClient)` | controlChannel.test.ts | fails: 200 not 500 (m5b.txt) | 0 / 0 |
| M7 | H2 | delete the ZodRecord branch | humanOnly.test.ts | throws `unhandled zod kind ZodRecord at set-agent-preferences:preferences.perAgent` (m7.txt) | 0 / 0 |
| M8 | H1 | api.ts drops the "web" argument | `npm run typecheck` | `src/panel/api.ts(190,21): error TS2554: Expected 3 arguments, but got 2.` rc=2 (m8.txt) | 0 / 0 |
| M6 | I4 | delete the `orca-panel: control socket <path>` stderr write in src/cli.ts | panelSocketE2e.test.ts -t C3 | C3 fails after 30 s: `no socket line: …` and the captured stderr shows the other panel lines (`open http://127.0.0.1:… in a browser`) but no socket line (m6.txt) | 0 / 0 |

M6 note: the first M6 run (in m6.txt's earlier version, superseded) was red for the wrong reason — the clone has no `web/dist`, so the panel refused with `panel-dist-missing`. I symlinked the main tree's `web/dist` into the clone, ran the unmutated C3 green in the clone (m6-baseline.txt: 3 passed), then re-ran M6 with `-t C3`; the red recorded above is the real one. The clone's `web/dist` and `node_modules` symlinks are untracked and do not appear in `git diff`.

Main worktree never mutated: `git status --short` clean, `git diff` 0 bytes, `git diff --cached` 0 bytes after all runs.

## Findings judged wrong on inspection

None. Every finding reproduced as described (I1's crash shapes were seen red in red1.txt: `socket hang up`, `ERR_UNESCAPED_CHARACTERS`, raw `ENOTDIR`).

## Concerns

1. M5 survives: deleting only the new `typeof` guard still yields 500 `control-internal-error` and no ledger row, because the downstream ledger insert refuses to bind an `undefined` client (`commandClientFor` returns it as-is) and the transaction rolls back. The regression the guard exists for — the old `String(...)` coercion that booked `"undefined"` — is killed by M5b. The guard's added value is that it fails earlier, with a named message, before the payload is parsed or the service runs; no test distinguishes that. I left it as is rather than add a test that reaches into service internals.
2. The query guard in `checkPath` refuses any query byte outside printable ASCII. A caller who needs a space must percent-encode it; the message says so. The only query the panel accepts today is `summary?sinceChangeSeq=<n>`, so nothing legitimate is lost.
3. A PreToolUse hook reported "Context ~367k tokens (37% of 1M window)" mid-task. That is the hook's own estimate, not a figure I can check; the per-task budget (Rule 6: 330,000 context occupancy) may be crossed by that measure. Surfaced, not estimated further.
4. Tests not run: full `npm test`, `verify:*`, web check (per brief, the controller's gate runs them).
