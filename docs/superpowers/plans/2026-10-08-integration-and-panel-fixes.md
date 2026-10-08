# Integration schemes and panel fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each task or each group, Orca carries a group's work from `orca/<g>` to where the person reviews it (a local branch, a remote branch, or one GitHub PR), with agent conflict resolution on approval; plus four panel fixes.

**Architecture:** A per-repository default scheme (in `repository_settings`) is copied into the group body when the group gets its plan, frozen by an owner's confirm (`integrationHash`), and executed by a new once-per-round driver pass `integratePendingGroups` next to `exportPendingRequirements`. All git work runs in Orca-owned workspaces with timeouts and a write-ahead record; conflicts become a group-level resolution machine reusing the landing reconciliation's pieces.

**Tech Stack:** TypeScript (Node 22, ESM), zod, node:sqlite control store, express panel, React + react-i18next web, vitest 5, real git (≥ 2.40) in tests, a fake `gh`.

**Spec:** `docs/superpowers/specs/2026-10-08-integration-and-panel-fixes-design.md` (read it whole first; §12 are the rulings).

## Global Constraints

- CLAUDE.md applies to every task (Rules 4, 9, 13, 14, 15, 17). Mutations only in `git clone --local` copies under the session scratchpad; restore proof = `git diff | wc -c` and `git diff --cached | wc -c` both `0`.
- Never touch the real `~/.orca`. Criteria use temporary roots (`ORCA_CONTROL_DIR`, `relocateHome` from `tests/control/fixtures/ccloopWorld.ts`).
- Shell: `/bin/cp`, `/bin/rm` (plain ones prompt); `/usr/bin/git` for checks; redirect every verification run to a file and read it back whole.
- Gate env: `ORCA_CCLOOP_BIN` = absolute path of a built clone of ccloop `c82b21261cf45c8a615a75ef2e724c1173176920`; a short real `TMPDIR`.
- `keep` is the absence of the `integration` field (group body, repository settings); a `keep` group body/view is byte-for-byte unchanged.
- Methods are `merge` and `squash` only (no `rebase`).
- Every git/gh child: argv array, `unsetInheritedGitEnv()`, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, timeout `ORCA_INTEGRATION_TIMEOUT_MS` (default 60000); workspace git with `QUIET_GIT` (`src/control/workspace.ts`).
- Branch name: `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`, no `..`, `@{`, `//`, not ending `/`, `.`, `.lock`, and `git check-ref-format --branch -- <name>` prints it unchanged. Remote: `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`.
- New error codes (errors.ts, 409 unless noted, none retryable): `integration-unapproved`, `integration-preflight-failed`, `integration-busy`, `integration-invalid` (400), `integration-no-checks`, `integration-not-blocked`.
- New verbs (all `human-only`): `set-integration-scheme` (target repository, projectionless), `set-group-integration`, `resolve-integration-conflict`, `retry-integration` (target group). `HUMAN_ONLY_FIELDS.confirm = ["integrationHash"]`.
- i18n: every new string in `web/src/locales/en.ts` and `zh.ts`.
- Ledger: `.superpowers/sdd/2026-10-08-integration-and-panel-fixes/progress.md` (append only; `git add -f`); every controller ruling is a `Ruling:` line with "cost if wrong".

## Review Focus

1. A `keep` repository (every existing user today) — nothing changes: no git child from the pass, group bodies and views identical. Pinned in Task 3 (`integrationKeep.test.ts`).
2. Orca restarted between a push and its record — no second push, no second PR. Pinned in Task 5.
3. The person working in the checked-out target branch with uncommitted edits — their files are untouched. Pinned in Task 3 (H5 dirty case compares file hashes).
4. The remote is unreachable or slow — runs of every group keep moving (the pass times out, backs off, stays `idle`). Pinned in Task 3 (fake remote that hangs, timeout 500 ms; a second group's run still advances in the same test).
5. An agent (socket principal) tries to confirm a pushing group or set a scheme — refused by name. Pinned in Task 2.

---

## File Structure

| file | responsibility |
|---|---|
| `src/control/integrationScheme.ts` (new) | scheme zod schema, name validation, defaults resolution, `schemeHash`, repository default read/write |
| `src/control/integrationCommands.ts` (new) | apply functions for the four verbs (inside `applyWebCommand`) |
| `src/control/integrationGit.ts` (new) | the git/gh child runner with env + timeout + failure classification; ref/remote/PR helpers |
| `src/control/integrationPass.ts` (new) | `integratePendingGroups`: due rule, steps §6.1, H5, write-ahead, record |
| `src/control/integrationPr.ts` (new) | GitHub PR flow (§6.4) via `ORCA_GH_BIN` |
| `src/control/integrationResolve.ts` (new) | conflict materialisation, `synthesizeIntegrationContract`, `advanceIntegrationResolution`, `recordIntegrationUsage` |
| `src/control/workspaceSettings.ts` | tolerant reader + RMW |
| `src/control/webProtocol.ts`, `errors.ts`, `webService.ts`, `src/panel/controlApi.ts`, `src/panel/humanOnly.ts`, `src/panel/controlViews.ts` | protocol, service, routes, view |
| `src/control/executionDriver.ts` | call the pass after `exportPendingRequirements` |
| `tests/control/fixtures/fakeGh.mjs` (new) | fake `gh`: logs argv, answers from a JSON script |
| `web/src/IntegrationScheme.tsx` (new), `GitScheme.tsx`, `ControlPanel.tsx`, `BudgetEditor.tsx`/confirm step | integration UI |
| `web/src/TokenInput.tsx` (new) | grouped numeric input |
| `web/src/DecisionsView.tsx`, `App.tsx`, `src/panel/api.ts` | decisions status filter |
| `web/src/MemoryView.tsx`, `styles.css` | memory split layout |
| `web/src/AgentSettings.tsx` / `ControlPanel.tsx` | Agents collapsed |

---

### Task 1: Scheme model, repository default and `set-integration-scheme`

**Files:**
- Create: `src/control/integrationScheme.ts`, `src/control/integrationCommands.ts`, `tests/control/integrationScheme.test.ts`
- Modify: `src/control/workspaceSettings.ts`, `src/control/webProtocol.ts` (verb enum ~:592-619, raw/effective unions ~:851/:897, `commandResultSchema` ~:1362-1450, `projectionless` ~:1493), `src/control/errors.ts`, `src/control/webService.ts` (beside `setWorkspaceMode` ~:541), `src/panel/controlApi.ts` (routes ~:311-429, GET beside `/repositories/:id/workspace` ~:220), `src/panel/humanOnly.ts`, `web/src/controlTypes.ts`, `web/src/controlApi.ts`, `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts`, `tests/control/workspaceSettings.test.ts` (only if a `toEqual` shape must widen — record it as a rewrite with reason in the ledger)

**Interfaces — Produces:**
```ts
// src/control/integrationScheme.ts
export type Trigger = "task" | "group";
export type Method = "merge" | "squash";
export type IntegrationScheme =
  | { delivery: "keep" }
  | { delivery: "local"; trigger: Trigger; method: Method; target: string }
  | { delivery: "push-target"; trigger: Trigger; method: Method; target: string; remote: string }
  | { delivery: "push-branch" | "github-pr"; trigger: Trigger; target: string; remote: string };
export const integrationSchemeSchema: z.ZodType<IntegrationScheme>; // .strict() per variant
export function validBranchName(name: string): boolean;             // regex part only (sync)
export async function checkBranchName(repo: string, name: string): Promise<boolean>; // + check-ref-format
export function validRemoteName(name: string): boolean;
export function schemeHash(scheme: IntegrationScheme): string;      // sha256 hex of canonicalBytes(scheme)
export function readIntegrationDefault(store: ControlStore, repoId: string): { scheme: IntegrationScheme; revision: number };
export async function checkScheme(repo: string, scheme: IntegrationScheme): Promise<string | null>; // null ok, else the failing check name
export function githubRepoOf(remoteUrl: string): { host: string; slug: string } | null; // "https://github.com/o/r(.git)", "git@github.com:o/r(.git)", "ssh://git@github.com/o/r"
```

- [ ] **Step 1: Failing tests** in `tests/control/integrationScheme.test.ts` (open a store the way `tests/control/workspaceSettings.test.ts` does):
```ts
it("reads keep when the settings body has no integration, and the workspace reader tolerates one that does", () => {
  expect(readIntegrationDefault(store, "repo")).toEqual({ scheme: { delivery: "keep" }, revision: 0 });
  applySetIntegrationScheme(deps, cmd({ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" }));
  expect(readWorkspaceSetting(store, "repo")).toEqual({ workspaceMode: "worktree", revision: 1 });
  expect(readIntegrationDefault(store, "repo").scheme).toMatchObject({ delivery: "push-branch" });
});
it("each setter keeps the other's field (read-modify-write)", () => {
  applySetIntegrationScheme(deps, cmd(PB));
  applySetWorkspaceMode(deps, modeCmd("clone", 1));
  expect(readIntegrationDefault(store, "repo").scheme).toEqual(PB);
  expect(readWorkspaceSetting(store, "repo").workspaceMode).toBe("clone");
});
it("setting keep removes the field from the body", () => { /* body JSON has no "integration" key */ });
it.each(["-x", "a..b", "a@{1}", "a//b", "a/", "a.", "a.lock", "", "x".repeat(201)])("refuses branch %j", (name) => {
  expect(validBranchName(name)).toBe(false);
});
it.each(["--upload-pack=x", "a b", ""])("refuses remote %j", (name) => expect(validRemoteName(name)).toBe(false));
it("schemeHash is stable over key order and differs per field", () => { /* two orders same hash; change target → different */ });
it("githubRepoOf parses the three URL shapes and refuses others", () => { /* https, scp-like, ssh://; gitlab.com → null */ });
```
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run tests/control/integrationScheme.test.ts > $S/t1a.txt 2>&1; echo rc=$?` → rc=1 (module missing).
- [ ] **Step 3: Implement.** `workspaceSettings.ts`: body schema becomes `z.object({ workspaceMode, revision, integration: integrationSchemeSchema.optional() }).strict()`; `readWorkspaceSetting` returns only `{workspaceMode, revision}`; `applySetWorkspaceMode` writes `{...currentBody, workspaceMode, revision}`. `integrationScheme.ts` as the interface; `canonicalBytes` from `./canonicalJson.js`, `createHash("sha256")`. `checkScheme`: name checks, `git remote get-url -- <remote>` (via `integrationGit` runner from Task 3 is not yet there — use `execFile("git", ...)` with the Global Constraints env and a 10 s timeout here; Task 3 moves it onto the shared runner), `githubRepoOf` for `github-pr`. `integrationCommands.ts`: `applySetIntegrationScheme(deps, command)` mirrors `applySetWorkspaceMode` (no-op ⇒ `no-op-command`; unknown repo ⇒ `control-target-not-allowed`; result `{ kind: "integration-scheme-set", repoId, integration }`), where `keep` deletes the field. `webService.setIntegrationScheme(command)`: parse, then `await checkScheme(repoPath, scheme)` **before** the transaction, then apply; a failing check ⇒ `integration-invalid` with the check name in the message. Protocol: add the verb to `commandVerbSchema`, raw/effective unions with `repositoryCommandTargetSchema` and payload `z.object({ integration: integrationSchemeSchema }).strict()`, result kind, `projectionless`. `humanOnly.ts` VERB_ACCESS `"set-integration-scheme": "human-only"`. Routes: `POST /api/control/repositories/:id/integration` (as the workspace POST) and `GET /api/control/repositories/:id/integration` → `{ schema: "orca-repository-integration-v1", repoId, integration, revision }`. Workspace GET picks `workspaceMode`/`revision` explicitly. Errors: add the six codes. SKILL.md: add both routes and the sentence "Confirming a group whose integration is not `keep` is owner-only (the `integrationHash` field is human-only)." Update `tests/entry/skill.test.ts` route count and `schemaByVerb`.
- [ ] **Step 4: Tests + typecheck:** `vitest run tests/control/integrationScheme.test.ts tests/control/workspaceSettings.test.ts tests/entry/skill.test.ts tests/panel/workspaceModeApi.test.ts` → rc=0; `npm run typecheck` → rc=0. Add a test in `tests/panel/integrationApi.test.ts`: an `agent` principal on the socket and a `member` session POSTing `set-integration-scheme` get `control-verb-human-only` (follow `tests/panel/permissionsMatrix*.test.ts` or the existing human-only tests: `rg -l "control-verb-human-only" tests/panel`).
- [ ] **Step 5: Mutations (clone):** M1-1 drop `integration` from the RMW in `applySetWorkspaceMode` → RMW test red; M1-2 make the reader strict again → tolerance test red; M1-3 remove one regex clause (`..`) → its `it.each` row red; M1-4 VERB_ACCESS `any` → api refusal test red. Record each in the ledger table.
- [ ] **Step 6: Commit** `feat(control): store a repository's integration scheme beside its workspace mode`.

### Task 2: Group copy, `set-group-integration`, confirm approval and preflight

**Files:**
- Modify: `src/control/planImport.ts` (where the group body is built, ~:304 `agentOverrides`), the requirement path that gives a requirement group its plan (find with `rg -n "archivePlan|writeArchivedPlan|planHash" src/control/requirement*.ts src/control/webDispatch.ts`), `src/control/integrationCommands.ts`, `src/control/webService.ts` (`confirm` ~:567), `src/control/webProtocol.ts` (`confirmPayloadSchema` ~:705, `groupViewSchema` ~:1237), `src/panel/controlViews.ts` (`readControlGroup` ~:794), `src/panel/humanOnly.ts`, `src/panel/controlApi.ts`
- Test: `tests/control/integrationScheme.test.ts` (extend), `tests/panel/integrationApi.test.ts` (extend)

**Interfaces — Produces:**
```ts
export interface GroupIntegration { scheme: IntegrationScheme; schemeHash: string; frozen: boolean; lastIntegrated: string | null;
  integratedCommit: string | null; state: "idle" | "blocked" | "conflict" | "resolving"; reason: string | null;
  pending: { schemeHash: string; tip: string; base: string; new: string } | null;
  conflict: { attempt: number; key: string; base: string; tip: string; paths: string[] } | null;
  resolution: ReconcileRecord | null; pr: { url: string; number: number; ready: boolean } | null; retryAfter: number | null;
  transient: number /* consecutive transient failures, drives the backoff; 0 after any success */ }
export function readGroupIntegration(group: unknown): GroupIntegration | null;   // null = keep; zod-validated, invalid ⇒ ControlError recovery-blocked "group-integration-invalid"
export function newGroupIntegration(scheme: IntegrationScheme): GroupIntegration | null; // null for keep
export async function preflightScheme(repo: string, scheme: IntegrationScheme, ghBin: string): Promise<string | null>;
// view: integration?: { scheme, schemeHash, frozen, state, reason, lastIntegrated, integratedCommit, pr }
```

- [ ] **Step 1: Failing tests:**
  - import with repo default `PB` ⇒ group body `integration` equals `newGroupIntegration(PB)` with `frozen: false`; with no default ⇒ body has no `integration` key (`Object.hasOwn(body, "integration") === false`) and the view has no `integration` key.
  - `set-group-integration` before confirm edits it; `{delivery:"keep"}` removes the key; a member/agent ⇒ `control-verb-human-only`.
  - confirm on a `PB` group: no `integrationHash` ⇒ `integration-unapproved`; stale hash ⇒ `integration-unapproved`; right hash from the view ⇒ confirmed and `frozen: true`; a `keep` group with a hash ⇒ `integration-unapproved`; a `keep` group without ⇒ confirmed exactly as before (assert the authority command hash equals the one computed before this change: build the same payload, compare `authorityCommandHash` to a constant captured from `main`'s behaviour in the same test via a payload without the field).
  - confirm with `integrationHash` from an agent principal ⇒ `control-field-human-only`.
  - preflight: remote missing ⇒ `integration-preflight-failed` naming `remote`; target missing ⇒ naming `target`; `github-pr` with a fake `gh` (Task 4's fixture not yet there — use a two-line script `#!/bin/sh\nexit 1` written by the test) ⇒ naming `gh-auth`.
  - after start: `set-group-integration` with a new scheme ⇒ accepted, state `idle`, `pending` cleared; while `state: "resolving"` (set directly in the body by the test) ⇒ `integration-busy`; while `conflict` ⇒ state becomes `idle` and `conflict` becomes null (Task 6 adds removal of the conflict copy at this point).
- [ ] **Step 2: Run** → red.
- [ ] **Step 3: Implement.** Copy at import (and at the requirement path's plan point) only when `readIntegrationDefault(...).scheme.delivery !== "keep"`. Confirm: in `webService.confirm`, after the replay check and before the transaction (where `resolveGroupSelections` runs), `const integ = readGroupIntegration(group)`; non-keep ⇒ `await preflightScheme(repoPath, integ.scheme, process.env.ORCA_GH_BIN || "gh")`; inside the transaction refuse per §3.2 and set `frozen: true`. `HUMAN_ONLY_FIELDS.confirm = ["integrationHash"]`. `confirmPayloadSchema` gains `integrationHash: hashSchema.optional()`. View: `integration` only when present. Route `POST /api/control/groups/:id/integration` (same body shape as the repository one).
- [ ] **Step 4: Run** the two test files + `tests/control/webService*.test.ts` + `tests/panel/controlRoutes*.test.ts` (whatever `rg -l '"confirm"' tests/control tests/panel` lists) → rc=0; typecheck rc=0.
- [ ] **Step 5: Mutations:** drop the hash comparison → stale-hash test red; drop the human-only field → agent test red; copy `keep` into the body → absence test red; skip preflight → preflight test red.
- [ ] **Step 6: Commit** `feat(control): copy the integration scheme into the group and approve it at confirm`.

### Task 3: The integration pass for `local`, `push-target`, `push-branch` (+ `retry-integration`)

**Files:**
- Create: `src/control/integrationGit.ts`, `src/control/integrationPass.ts`, `tests/control/integrationGit.test.ts`, `tests/control/integrationKeep.test.ts`
- Modify: `src/control/executionDriver.ts` (after the `exportPendingRequirements` try-block ~:915), `src/control/integrationCommands.ts` (retry), protocol/routes/humanOnly for `retry-integration` (`POST /api/control/groups/:id/integration/retry`)

**Interfaces — Produces:**
```ts
// integrationGit.ts
export type ChildFailure = { kind: "transient" | "permanent"; code: string; message: string };
export interface ChildResult { code: number; stdout: string; stderr: string }
export async function runChild(bin: string, args: string[], opts: { cwd: string; input?: string; quiet?: boolean }): Promise<ChildResult>; // never throws on non-zero; throws ChildTimeout on timeout
export function classifyNetwork(stderr: string): "transient" | null; // "Could not resolve host", "Connection refused", "timed out", "unable to access"
export async function pushPorcelain(repo: string, remote: string, refspec: string): Promise<"ok" | "up-to-date" | "moved" | { refused: string }>;
export async function remoteHas(repo: string, remote: string, branch: string, commit: string): Promise<boolean>; // ls-remote tip equals or contains (fetch + merge-base --is-ancestor)
// integrationPass.ts
export interface IntegrationDeps { store: ControlStore; roots: WorkspaceRoots; repoPathOf(repoId: string): string; now(): number;
  ghBin: string; crash?: (point: IntegrationCrashPoint) => void; admissionGate?: AdmissionGate; stopped(): boolean }
export type IntegrationCrashPoint = "after-pending" | "after-publish" | "after-pr-create" | "after-pr-ready";
export async function integratePendingGroups(deps: IntegrationDeps): Promise<boolean>;
export function dueGroups(store: ControlStore, tips: (groupId: string) => Promise<...>): ...; // internal, tested via the pass
```
`ExecutionDriverDeps` already carries `store`, `roots`, `admissionGate`; the driver builds `IntegrationDeps` from it (find how `exportPendingRequirements(deps)` gets the repo path: `ExportDeps` in `requirementExport.ts:22`) and passes `crash` through the existing `driverCrash` hook style (`DriverCrash`).

- [ ] **Step 1: Failing tests** (`integrationGit.test.ts`; a helper builds: a bare remote `remote.git`, a target repo cloned from it with `main`, a control store, a group body with a frozen integration, and lands commits onto `refs/heads/orca/g` with plain git `commit-tree`/`update-ref` — no ccloop needed; a work item table row per task marked `done` for "group complete"):
  1. `push-branch`, trigger task: one landing ⇒ remote `orca/g` = tip; `lastIntegrated` = tip; second landing ⇒ pushed again; no landing ⇒ pass returns false and spawns nothing.
  2. `local` merge, target not checked out (target repo HEAD on another branch): `main` gains a merge commit with parents (old main, tip); second landing ⇒ another merge whose second parent is the new tip.
  3. `local` squash: one commit on `main` whose parent is old main and whose tree equals `git merge-tree` of the landings; second integration after the person edited a line the first landing touched (commit on `main`) ⇒ no conflict, the edit survives (proves `--merge-base=lastIntegrated`).
  4. trigger `group`: landings while incomplete ⇒ nothing; mark all done ⇒ one integration.
  5. `push-target` merge: remote `main` advanced (no conflict) by another clone ⇒ integrated on top of it; remote moved between fetch and push (simulate with a `pre-receive` hook on the bare repo that pushes nothing but rejects once via a flag file) ⇒ recompute once ⇒ ok; twice ⇒ `blocked` `integration-target-moved`.
  6. protected branch (bare repo `pre-receive` that always rejects) ⇒ `blocked` `integration-push-refused`.
  7. H5: target repo has `main` checked out and clean ⇒ fast-forwarded in place (worktree file updated, `git status` empty); dirty (an untracked file) ⇒ `blocked` `integration-worktree-dirty` and sha256 of every file in the worktree + `git status --porcelain` identical before/after.
  8. remote URL pointing at a hanging endpoint: a `remote.<name>.url` of `ext::sh -c "sleep 5"` with `protocol.ext.allow=always` set only in the test repo's config, `ORCA_INTEGRATION_TIMEOUT_MS=500` ⇒ state stays `idle`, `retryAfter` ≈ now+30 s, and the call returned within 3 s.
  9. remote branch `orca/g` diverged (another clone pushed to it) ⇒ `blocked` `integration-work-branch-diverged`.
  10. target branch deleted on the remote ⇒ `blocked` `integration-target-missing`; remote removed ⇒ `integration-remote-missing`.
  11. `retry-integration` on `blocked` ⇒ `idle`; on `idle` ⇒ `integration-not-blocked`; member ⇒ human-only refusal.
  12. person-paused group ⇒ not due; budget-blocked (the group's `blockedReason`/budget flag as `groupHeld` reads it — set it the same way `tests/control/executionDriver.test.ts` does) ⇒ still integrates.
  `integrationKeep.test.ts`: a world with a `keep` group that lands a commit; spy `runChild` (export a `__setRunChildForTests` hook or inject through deps) ⇒ zero calls; group body JSON has no `integration`; the driver round result is unchanged.
- [ ] **Step 2: Run** → red.
- [ ] **Step 3: Implement** per spec §5, §6.1–6.3, §6.5: the due rule; `integrate-<g>` detached worktree via `git worktree add --detach` in the target repo (reuse `ensureWorkspace`/landing helpers from `workspace.ts`/`driverLanding.ts` where they fit; remove by name before and after); write-ahead `pending` written with `write(deps, ...)` re-reading the group; record step re-reads and drops on `schemeHash` change; transient ⇒ `retryAfter = now + min(30_000 * 2^k, 600_000)` with `k` = the record's `transient` (incremented on each transient failure, reset to 0 on success). Driver: after the export block, `try { if (await integratePendingGroups(integrationDepsOf(deps, context))) progressed = true; } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }`.
- [ ] **Step 4: Run** `vitest run tests/control/integrationGit.test.ts tests/control/integrationKeep.test.ts tests/control/executionDriver.test.ts tests/control/requirementExport*.test.ts` → rc=0; typecheck.
- [ ] **Step 5: Mutations:** squash with merge-base = fork point (drop `--merge-base`) → case 3 red; skip the H5 clean check → case 7 red; no timeout → case 8 red (times out the test); treat `moved` as refused → case 5 red; integrate a `keep` group → keep test red; remove the paused check → case 12 red.
- [ ] **Step 6: Commit** `feat(control): integrate a group's work into its target after each task or group`.

### Task 4: GitHub PR delivery

**Files:**
- Create: `src/control/integrationPr.ts`, `tests/control/fixtures/fakeGh.mjs`, `tests/control/integrationGh.test.ts`
- Modify: `src/control/integrationPass.ts` (step 5), `src/control/integrationScheme.ts` (`preflightScheme` uses `gh auth status --hostname`)

**Fake gh** (`fakeGh.mjs`, executable, node): env `FAKE_GH_DIR`; appends `JSON.stringify(argv)` + stdin (if any) to `$FAKE_GH_DIR/calls.jsonl`; reads `$FAKE_GH_DIR/state.json` `{ prs: [{number,url,state,isDraft,head,base}], authOk: true, refuseDraft: false }`; implements `auth status --hostname H`, `pr list --repo R --head H --base B --state all --json ...` (prints matching PRs as JSON), `pr create ...` (appends a PR `{number: n+1, url: "https://github.com/o/r/pull/<n>", state: "OPEN", isDraft}`; prints the URL; with `refuseDraft` and `--draft` exits 1 with "Draft pull requests are not supported"), `pr ready --repo R N`, `pr view --repo R N --json state`. Unknown ⇒ exit 2.

**Interfaces — Produces:** `export async function syncGroupPr(input: { ghBin: string; repo: string /* host/owner/name */; head: string; base: string; title: string; body: string; draft: boolean; complete: boolean; pr: GroupIntegration["pr"] }): Promise<{ pr: NonNullable<GroupIntegration["pr"]> } | { blocked: string; message: string } | { transient: string }>`

- [ ] **Step 1: Failing tests:** trigger task ⇒ first integration: argv log has `pr list` then `pr create` with `--repo github.com/o/r`, `--draft`, `--title=<goal first line>`, `--body-file -`; second integration ⇒ no second `pr create`; group complete ⇒ `pr ready`; trigger group ⇒ `pr create` without `--draft`; an existing open PR from `pr list` ⇒ recorded, no create; closed ⇒ `blocked` `integration-pr-closed`; `refuseDraft` ⇒ `integration-pr-refused`; `authOk:false` at confirm ⇒ preflight names `gh-auth`; every argv contains `--repo`; a goal of `"--evil\nsecond line"` ⇒ argv contains exactly `--title=--evil` and stdin has the body. Remote in the world: `remote.origin.url = https://github.com/o/r.git` plus `url.<bare path>.insteadOf = https://github.com/o/r.git`, so every git transport goes to the local bare repo. Orca reads the GitHub identity with `git config --get remote.<remote>.url` (the raw value, before `insteadOf`), never with `git remote get-url` — `githubRepoOf` in Task 1 is fed that raw value; Task 1's `checkScheme` uses the same read.
- [ ] **Step 2: Run** → red. **Step 3: Implement** §6.4 with `runChild(ghBin, ...)`. **Step 4: Run** → rc=0.
- [ ] **Step 5: Mutations:** drop `--repo` → red; `--state open` instead of `all` → closed-PR test red; always `--draft` → trigger-group test red.
- [ ] **Step 6: Commit** `feat(control): keep one GitHub pull request per group up to date`.

### Task 5: Crash safety of every outward action

**Files:** Create `tests/control/integrationCrash.test.ts`; modify `integrationPass.ts` only if a test is red.

- [ ] **Step 1: Tests:** for each delivery × each `IntegrationCrashPoint` reachable for it (`push-branch`: after-pending, after-publish; `github-pr`: + after-pr-create, after-pr-ready; `local` merge and squash: after-pending, after-publish; `push-target`: after-pending, after-publish): run the pass with `crash` throwing at that point, then run it again without crash ⇒ remote/local ref equals the no-crash run's; `calls.jsonl` has exactly one `pr create` and at most one `pr ready`; the bare repo's reflog / a `post-receive` hook counter shows at most one ref update per push target; final record (`lastIntegrated`, `integratedCommit`, `pr`) equals a no-crash control run's.
- [ ] **Step 2: Run** → expect green if Task 3/4 are right; any red is fixed in `integrationPass.ts` and named in the ledger. **Mutation:** remove the re-entry check (step 2 of §6.1) → squash after-publish red (a second squash commit or a blocked group).
- [ ] **Step 3: Commit** `test(control): pin that a crash never repeats an integration's push or PR`.

### Task 6: Conflicts and agent resolution

**Files:**
- Create: `src/control/integrationResolve.ts`, `tests/control/integrationResolve.test.ts`
- Modify: `src/scheduler/reconcile.ts` (`pinConflictCommit` gains an optional `ref` parameter: `pinConflictCommit(copy, runId, conflictCommit, ref = conflictRefOf(runId))` — existing callers unchanged), `src/control/usageLedger.ts` (`bookIntegrationUsage` with `runId: null`), `integrationPass.ts` (conflict path, `resolving` advance first), `integrationCommands.ts` (`resolve-integration-conflict`), protocol/routes/humanOnly (`POST /api/control/groups/:id/integration/resolve`)

**Interfaces — Produces:**
```ts
export async function materialiseIntegrationConflict(deps, groupId, base: string, tip: string, method: Method, attempt: number): Promise<GroupIntegration["conflict"]>;
export async function synthesizeIntegrationContract(input: { taskContracts: unknown[]; conflict: NonNullable<GroupIntegration["conflict"]>; target: string; groupId: string; budget: number; copy: string }): Promise<{ contractPath: string } | { refused: "integration-no-checks" }>;
export async function advanceIntegrationResolution(deps: IntegrationDeps & { runTask: ... }, groupId: string): Promise<boolean>;
export function recordIntegrationUsage(deps, groupId: string, key: string, tokens: number): void; // outbox id `integration-usage:<key>`
```
Read first: `src/control/driverLanding.ts` `stepR` (:262-370), `reconcileNextAction` (:210), `recordReconcileUsage` (:242), `src/scheduler/reconcile.ts` (:115-190, :435-540). The resolution uses the group's reconcile agent slot exactly as `stepR` finds it (`RECONCILE_SLOT_KEY` in `agentFreeze.ts`) and `runTask` exactly as `stepR` calls it.

- [ ] **Step 1: Failing tests** (real git; the agent run is ccloop with the fake agent — reuse `tests/control/fixtures/ccloopWorld.ts` `world` with a `reconcile-…` script key the way `executionDriverE2E` E1 scripts `"reconcile-a-b"`; skip with `ctx.skip()` when `ORCA_CCLOOP_BIN` is unset): target `main` and the landing both edit line 1 of `shared.txt` ⇒ state `conflict`, `refs/orca/integration-conflict/g/1` exists in the target repo and holds markers, **no** ccloop call logged; `resolve-integration-conflict` by a member ⇒ refused; by an owner ⇒ `resolving`; next rounds ⇒ integrated, `main`'s new commit (merge) has parents (old main, tip) and no markers; usage ledger has one row `run_id IS NULL`, `quality='unattributed'`, outbox `integration-usage:integrate-g-1` delivered; a script that leaves markers ⇒ `conflict` with reason, attempt 2 on the next approval; group with no `requiredChecks` ⇒ `integration-no-checks`; budget too low ⇒ `reconcile-budget`; `squash` conflict resolution ⇒ one commit with parent old main; base moved during resolution ⇒ discarded, state `idle`, next round conflicts again or integrates.
- [ ] **Step 2: Run** → red. **Step 3: Implement** spec §7. **Step 4: Run** + `tests/control/driverReconcile.test.ts tests/control/executionDriverE2E.test.ts` (landing reconciliation unchanged) → rc=0.
- [ ] **Step 5: Mutations:** dispatch on conflict without approval → "no ccloop call" red; squash rebuilt with two parents → squash test red; usage with a run id → row test red; skip `markersRemaining` → markers test red.
- [ ] **Step 6: Commit** `feat(control): resolve an integration conflict with an agent once an owner approves`.

### Task 7: Integration UI

**Files:**
- Create: `web/src/IntegrationScheme.tsx`, `web/tests/integrationScheme.test.tsx`
- Modify: `web/src/ControlPanel.tsx` (beside `WorkspaceModeSelector`), the confirm step component (find with `rg -n "selectionsHash" web/src`), `web/src/GitScheme.tsx`, `web/src/controlApi.ts`, `web/src/controlTypes.ts`, locales; append a correction section to `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md` (or whichever board spec holds D5: `rg -l "D5" docs/superpowers/specs/2026-10-03*`) — "Corrections (2026-10-08, session eaee0f2c): for groups whose integration is not keep, merging and pushing are Orca's per the integration spec; Rule 15 governs agents developing Orca." Text above it untouched.

- [ ] **Step 1: Failing tests:** repository section renders the current default and sends `set-integration-scheme` with exactly the chosen fields (method hidden for push-branch/github-pr; remote hidden for local); a member sees it read-only (no Save); the confirm step shows the plain-words sentence for `PB` and sends `integrationHash` = the view's `schemeHash`; a `keep` group's confirm sends no `integrationHash` (payload has no key); Git area shows state/reason/PR link; Retry and Resolve send their verbs; for `keep` the "merging into main is the person's" line is still there and no Retry/Resolve buttons.
- [ ] **Step 2–4:** red → implement → `cd web && ../node_modules/.bin/vitest run tests/integrationScheme.test.tsx` rc=0; `npm run --ws check` rc=0.
- [ ] **Step 5: Mutation:** confirm always sends `integrationHash` → keep-payload test red.
- [ ] **Step 6: Commit** `feat(web): choose, approve and follow a group's integration`.

### Task 8: Decisions status filter

**Files:** `src/panel/api.ts` (`/api/decisions` rows gain `reviewed`, `highTier`), `src/panel/coverage.ts` (export the tier predicate and key it already uses), `web/src/DecisionsView.tsx`, `web/src/App.tsx` (~:706 fetch), `web/src/api.ts`, `web/src/types.ts`, locales; tests `tests/panel/decisionsApi.test.ts` (the `toStrictEqual` at ~:109 widens: rewrite inventory — record in the ledger with the reason "spec §9.2(1) adds two fields"), `web/tests/decisionsStatusFilter.test.tsx`.

- [ ] **Step 1: Failing tests:** API rows carry `reviewed` (true for a decision with a `reviewed` review row) and `highTier`; `/api/todo` body unchanged (byte-compare against the pre-change shape built in the test). Web: default filter *Unreviewed* lists exactly today's rows; *Reviewed* lists a reviewed decision; opening it shows the correction form; submitting a second correction shows the `CORRECTION_ALREADY_RECORDED` refusal; *All* lists every row.
- [ ] **Step 2–4:** red → implement → `vitest run tests/panel/decisionsApi.test.ts` + web test rc=0.
- [ ] **Step 5: Mutation:** *Reviewed* filter on `highTier && reviewed` → low-tier reviewed row missing, red.
- [ ] **Step 6: Commit** `feat(panel): browse reviewed decisions and correct them`.

### Task 9: Memory split layout

**Files:** `web/src/MemoryView.tsx`, `web/src/styles.css` (only if a class is missing), `web/tests/memoryLayout.test.tsx`.
- [ ] **Step 1: Failing test:** the list is inside `.split-list` and the detail inside `.split-detail` (same structure as `DecisionsView.tsx:123-132`); selecting a memory calls `scrollIntoView` on the detail (stub `Element.prototype.scrollIntoView` and assert one call) — jsdom cannot measure layout, so this is the measurable part.
- [ ] **Step 2–4:** red → implement → rc=0. **Mutation:** detail outside `.split-detail` → red.
- [ ] **Step 5: Commit** `feat(web): show a memory's detail beside the list`.

### Task 10: Grouped token inputs

**Files:** Create `web/src/TokenInput.tsx`, `web/tests/tokenInput.test.tsx`; modify `RequirementsPanel.tsx` (:108, :236), `BudgetEditor.tsx` (:371, :416, :428), `UsagePanel.tsx` (:218); locales (`tokens.hint`: en `≈ {{short}}`, zh `约 {{short}}`).

**Interfaces — Produces:** `export function parseTokens(text: string): number | null` (digits with `,`, ` `, U+00A0, U+202F separators; leading/trailing spaces trimmed; > `Number.MAX_SAFE_INTEGER` ⇒ null); `export function formatTokens(n: number, lang: string): string` (`new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(n)`); `export function shortTokens(n: number, lang: string): string` (en: `10M`, `1.5K`, `2.3B`; zh: `1000 万`, `1.5 亿`); `<TokenInput value={number} onChange={(n: number) => void} min?: number aria-label?>` — text input, `inputMode="numeric"`, shows `formatTokens`, on blur re-formats, on invalid text keeps the text and shows the existing field-error style and does not call `onChange`.
- [ ] **Step 1: Failing tests:** `parseTokens("10,000,000") === 10000000`; `"10 000 000"`, `"10 000 000"`, `"10 000 000"`, `"10000000"` likewise; `"10.000.000"`, `"1e7"`, `"-5"`, `"abc"` ⇒ null; `formatTokens(10000000,"en")==="10,000,000"` and same for zh; `shortTokens(10000000,"zh")==="1000 万"`; rendering RequirementsPanel's limit with 10000000 shows `10,000,000`; typing `12,345` sends `12345`.
- [ ] **Step 2–4:** red → implement → rc=0 (+ existing RequirementsPanel/BudgetEditor/UsagePanel web tests; any that typed into `type=number` inputs and asserted the raw value are rewritten — list them in the ledger rewrite inventory).
- [ ] **Step 5: Mutation:** drop U+202F from the separator set → its row red.
- [ ] **Step 6: Commit** `feat(web): show token amounts with digit grouping`.

### Task 11: Agents collapsed by default

**Files:** `web/src/ControlPanel.tsx` (~:240) or `AgentSettings.tsx`, `web/tests/agentsCollapsed.test.tsx`.
- [ ] **Step 1: Failing test:** the Agents section is a `<details>` without `open` on first render; toggling it open writes `localStorage["orca.panel.agentsOpen"]="1"`; a re-render reads it and is open; a `localStorage` whose getter throws still renders (collapsed).
- [ ] **Step 2–4:** red → implement → rc=0. **Mutation:** default `open` → red.
- [ ] **Step 5: Commit** `feat(web): fold the Agents section by default`.

### Task 12: Gate, mutation table and ledger close

- [ ] **Step 1: Isolated clone gate** (method of `docs/superpowers/plans/2026-10-07-accounts-and-spend-caps.md` Task 13 Step 1): clone the branch tip; HOME + four XDG relocated; short TMPDIR; `ORCA_CCLOOP_BIN` = absolute path of the built ccloop clone at `c82b212…`; `ORCA_AGENTS_TABLE` = fake codex `integration`; `npm ci`; each into its own file with `echo rc=$?`: web build, typecheck, `--ws check`, `verify:control`, `verify:panel`, `npm test`, `check-tmp-leak`. `uptime` before the full run.
- [ ] **Step 2: Known load flakes** re-run alone 3× with `uptime` (list: gateCheck K13, driverRequirementSplit, driverRecovery, controlShutdown 143, agentSelectionE2E C3, driverLanding, driverProgress R2, executionDriverE2E, ccloopPort, web controlCommandRecovery, web agentPreviewRefresh, requirementExport DR21, schedulerBridge "success", requirementCommands DR10, web projectSwitcher C; relocateUserData's real-home guard when the changed path is `control.sqlite`/`reviews.jsonl`). Anything else is fixed.
- [ ] **Step 3: Real home untouched:** `ls -la ~/.orca/control` before Task 1 and after; `cmp` (the human may be using the panel: a difference only in `control.sqlite`/`reviews.jsonl` mtimes is "human in operation", recorded as such).
- [ ] **Step 4: Ledger close:** gate table, mutation table (all tasks), every `Ruling:`, rewrite inventory, `awaitingHuman`.
- [ ] **Step 5: Commit** `docs(sdd): close the integration and panel fixes round in its ledger` (`git add -f`).
