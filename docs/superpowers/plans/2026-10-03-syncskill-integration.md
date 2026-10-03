# syncskill integration (per-run skill snapshots) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loop task can declare skills; every run of it gets a pinned syncskill snapshot, loaded by claude through `--plugin-dir`, recorded on the run, and never committed.

**Architecture:** Orca declares `skills` on the loop recipe, freezes the names into the execution snapshot at confirm (and at set-task-loop on a confirmed task), and at step A2 spawns `syncskill inject` into `<workspacesRoot>/skills-<runId>`, a claude plugin directory outside every git tree. The start envelope's loop work carries `skillPluginDir`; ccloop's claude adapter adds `--plugin-dir` and drops `--disable-slash-commands` for that run only.

**Tech Stack:** TypeScript, zod, vitest, node child_process; Orca (`/Users/biran/code/skills/loop/Orca`), ccloop (`/Users/biran/code/skills/loop/ccloop`).

**Spec:** `docs/superpowers/specs/2026-10-03-syncskill-integration-design.md` — **§10 overrides §1–§9**. Read §10 first, then §4 for the parts §10 does not replace.

## Global Constraints

- Code, comments, commit messages, ledgers: English. Ledger: `.superpowers/sdd/2026-10-03-syncskill-integration/progress.md` (`.superpowers/sdd/.gitignore` is `*` ⇒ `git add -f`).
- One implementer per repository working tree at a time (Orca handoff §4.0 item 7). Task 1 is ccloop; Tasks 2–7 are Orca, strictly sequential.
- An absent `skills` is **omitted** (conditional spread), never `null`/`undefined`: archive bytes, `planHash`, recipe/contract/snapshot/envelope hashes of anything without skills stay byte-identical.
- Skill name rule: not empty; not starting with `.`; no `/`, `\`, NUL, `,`; no leading/trailing whitespace. Profile name rule: `^[a-zA-Z0-9_-]+$`.
- `ORCA_SYNCSKILL_BIN` must be absolute; unset ⇒ skills unavailable. syncskill is always spawned with `--json`; `profile ls` also with `--no-refresh`.
- Every test that spawns real syncskill sets `SYNCSKILL_DIR` and `HOME` to temp dirs and snapshots the real `~/.syncskill` before/after (Rule 17). Never write a criterion that touches the real one.
- Mutations only in `git clone --local` copies under the session scratchpad; restore proof by `git diff` / `git diff --cached` byte counts.
- Each new branch gets a named mutation that deletes it and is **seen red** (Rule 9). Record each in the ledger.
- Never modify an existing criterion (test) without it being listed in this plan; list any you had to touch in the ledger with the reason.
- Commit per task; message ends with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_011R9aYJnHfJXDpdJ3YM1YW9`.
- Verification runs redirect output to a file and read it back whole (Rule 14); use `/usr/bin/git`; `export ECC_GATEGUARD=off DISABLE_OMC=1` for ccloop runs.

## Review Focus

1. A task without `skills` must behave byte-identically everywhere (import, confirm, set-task-loop, A2, envelope, claude argv) — the most likely silent regression. Owned by Tasks 1, 3, 4, 6 (golden-hash tests).
2. A set-task-loop that changes only `skills`, or a panel budget edit on a task with skills, must neither be refused as a no-op nor drop the skills. Owned by Task 5.
3. A skill deleted from syncskill between confirm and run: the run blocks at A2 with `skills-inject-failed:E_SKILL_NOT_FOUND`, it never runs without skills. Owned by Task 6.
4. A run blocked or restarted before its A2 write must still have `skills-<runId>` removed by cleanup. Owned by Task 6.
5. A profile name containing members that break the name rule (e.g. `a,b`), or an empty profile, is refused at confirm with a named code. Owned by Tasks 2 and 4.

---

### Task 1: ccloop — `skillPluginDir` on the loop work, claude `--plugin-dir`, codex refused (repo: ccloop)

**Files:**
- Modify: `src/control/protocol.ts` (`loopWorkSchema` ~L182; `validateEnvelopePaths` ~L268)
- Modify: `src/control/accept.ts` (`acceptStart`, next to `single-call-unsupported` ~L86)
- Modify: `src/control/worker.ts` (~L193, the `createAdapter` call)
- Modify: `src/agents/registry.ts` (`createAdapter` signature), `src/agents/claude.ts` (`createAdapter` ~L77), `src/agents/codex.ts` (signature only)
- Modify: `src/runtime/claude/claudeAgentAdapter.ts` (constructor ~L114; `run` env/outcome ~L130–153)
- Test: `tests/control/accept.test.ts`, `tests/control/protocol.test.ts`, a new `tests/runtime/claude/claudeSkillPluginDir.test.ts` (copy the fake-claude setup of an existing test in `tests/runtime/claude/`)

**Interfaces:**
- Produces: envelope `work.skillPluginDir?: string` (absolute). `AgentDescriptor.createAdapter(config, options?: { skillPluginDir?: string })`. Refusal codes `skills-unsupported-agent` (accept, non-claude kind) and `control-request-invalid` (path not absolute/canonical/existing).

- [ ] **Step 1: failing tests.**
  - protocol: an envelope with `work.skillPluginDir` = an existing canonical dir parses; relative path ⇒ `control-request-invalid`; a non-existent path ⇒ `control-request-invalid` **only for `accept`**. For `inspect`/`handoff`/`collect`/`read-evidence` only `isAbsolute` is checked (the dir is removed with the workspace after landing, and those calls may come later).
  - accept: `skillPluginDir` with a codex selection ⇒ throws `skills-unsupported-agent` and leaves no `accepted` record in `sourceDir` (assert the file is absent). With claude ⇒ accepted.
  - adapter (C7): with `skillPluginDir` the fake claude's recorded argv contains `--plugin-dir <dir>` and does not contain `--disable-slash-commands`, for plan, execute and verify; without it, argv is byte-identical to a recorded golden (capture today's argv first and pin it).
  - envelope hash: `canonicalHash` of an envelope without the field is unchanged by the schema change (pin a golden hash computed before the change).
- [ ] **Step 2: run them, confirm red** (`rtk proxy ./node_modules/.bin/vitest run <files> > $OUT 2>&1`).
- [ ] **Step 3: implement.**
  ```ts
  // protocol.ts loopWorkSchema: add
  skillPluginDir: z.string().min(1).optional(),
  // validateEnvelopePaths(envelope, method): when isLoopEnvelope(envelope) && envelope.work.skillPluginDir !== undefined:
  //   if (!isAbsolute(dir)) throw new ControlProtocolError("control-request-invalid");
  //   if (method === "accept") validateCanonicalDirectory(dir);
  ```
  ```ts
  // accept.ts, after the single-call refusal:
  if (input.work.kind === "loop" && input.work.skillPluginDir !== undefined && config.kind !== "claude") {
    throw new ControlProtocolError("skills-unsupported-agent");
  }
  ```
  (Add `skills-unsupported-agent` wherever ccloop enumerates control error codes; grep `single-call-unsupported`.)
  ```ts
  // worker.ts
  const adapterOptions = envelope.work.kind === "loop" && envelope.work.skillPluginDir !== undefined
    ? { skillPluginDir: envelope.work.skillPluginDir } : undefined;
  await runLoop(contract, runDir, () => getDescriptor(config.kind).createAdapter(config, adapterOptions), { ... });
  ```
  ```ts
  // claudeAgentAdapter.ts
  constructor(private readonly config: MaterializedAgentConfigV1, options: { skillPluginDir?: string } = {}) {
    assertContextOption(claudeDescriptor.contextOptions, config.selection);
    this.extraArgs = ["--model", claudeModelArgument(config.selection),
      ...(options.skillPluginDir === undefined ? [] : ["--plugin-dir", options.skillPluginDir])];
    this.command = options.skillPluginDir === undefined ? config.installation.command
      : config.installation.command.filter((arg) => arg !== "--disable-slash-commands");
  }
  // use this.command wherever installation.command is used (outcome.json claudeCommand, CCLOOP_CLAUDE_COMMAND).
  ```
  Codex `createAdapter(config, _options)` ignores the option (accept already refused).
- [ ] **Step 4: tests green; mutations**, each seen red: (M1) drop the `--plugin-dir` push; (M2) filter `--disable-slash-commands` unconditionally; (M3) remove the accept refusal; (M4) validate existence for every method (expect a `collect` test with a removed dir to go red — add that test in Step 1 if missing).
- [ ] **Step 5: gate in a clone**: `npm run build`, full `vitest run --reporter=json` → `node scripts/check-known-reds.mjs` RC 0, `node scripts/check-tmp-leak.mjs` RC 0, `npm run typecheck` RC 0. Record in the ledger.
- [ ] **Step 6: commit** `feat(control): carry a skill plugin dir on the loop work and load it into claude (Orca syncskill integration)`.

---

### Task 2: Orca — the syncskill caller (`src/skills/syncskill.ts`)

**Files:**
- Create: `src/skills/syncskill.ts`, `tests/skills/syncskill.test.ts`, `tests/skills/fixtures/fake-syncskill.mjs`, `tests/skills/syncskillReal.test.ts` (skipped unless `ORCA_SYNCSKILL_REAL_BIN` is set, like `tests/memory/ccmemReal.test.ts`)
- Reference: `src/memory/ccmem.ts` (copy its execFile/error mapping shape), `src/control/errors.ts` (register new codes)

**Interfaces:**
- Produces:
  ```ts
  export const SYNCSKILL_TIMEOUT_MS = 30_000; export const SYNCSKILL_MAX_BUFFER = 16 * 1024 * 1024;
  export interface SyncskillOptions { bin: string | null; env: NodeJS.ProcessEnv; timeoutMs?: number; maxBufferBytes?: number }
  export interface LockSkill { name: string; source: { name: string; type: string; url: string; branch?: string } | null; resolved_commit: string | null; content_md5: string }
  export function isSafeSkillName(name: string): boolean;          // §10.4 rule
  export const PROFILE_NAME_PATTERN: RegExp;                       // /^[a-zA-Z0-9_-]+$/
  export async function profileMembers(o: SyncskillOptions, profile: string): Promise<string[]>; // sorted, unique, validated
  export async function injectSkills(o: SyncskillOptions, names: readonly string[], target: string): Promise<LockSkill[]>;
  export class SyncskillError extends Error { constructor(readonly code: string, message: string) }
  ```
  Codes: `syncskill-unconfigured` (bin null), `syncskill-missing` (relative bin, ENOENT, EACCES), `syncskill-timeout`, `syncskill-output-too-large`, `syncskill-failed:<E_CODE>` (from the JSON `error` event's `code`) else `syncskill-failed:<exit status|errno>`, `syncskill-output-invalid` (no/invalid `result` event), `skills-profile-empty`, `skills-shape` (a member breaks the name rule).
- [ ] **Step 1: failing tests** against `fake-syncskill.mjs` (a node script whose behaviour is chosen by env `FAKE_SYNCSKILL_MODE`: `profile-ok`, `profile-empty`, `profile-comma`, `profile-missing` (prints `{"type":"error","code":"E_PROFILE_NOT_FOUND"}` and exits 2), `inject-ok` (creates `<target>/<name>/SKILL.md` for each `--skills` name, prints a `result` event with `skills` lock entries), `crash` (exit 1, no JSON), `garbage`, `sleep`). It appends its argv as one JSON line to `FAKE_SYNCSKILL_LOG`.
  Assert: argv of `profileMembers` is exactly `["--json","--no-refresh","profile","ls",<p>]` (C18 half); of `injectSkills` `["--json","inject","--skills","a,b","--target",<t>]`; members come back sorted/unique; each error code above; a relative bin ⇒ `syncskill-missing` without spawning.
- [ ] **Step 2: red.** **Step 3: implement** (mirror `ccmem.ts`: `execFile(bin, args, { env, encoding: "utf8", timeout, maxBuffer })`, `child.stdin?.end()`, spawn-throw handling, errno naming). Parse stdout+stderr lines starting with `{`; the `result` event's `summary` is `{ profiles: {<p>: string[]} }` or `{ target, lock, skills: LockSkill[] }` — validate with zod `.strict()` for `LockSkill`.
- [ ] **Step 4: real test** (`syncskillReal.test.ts`, gated): builds a temp `SYNCSKILL_DIR` with `skills/alpha/SKILL.md` and a `config.json` (copy the shape from syncskill's `tests/integration/sync-dir-cli.test.ts` `seedSyncDir`), runs `profileMembers` after `syncskill --json profile set p alpha`, and `injectSkills`; asserts the lock entries equal the file `<target>/syncskill-lock.json`'s `skills`; asserts the temp `SYNCSKILL_DIR` is byte-identical before/after `profileMembers` (C18 other half); snapshots real `~/.syncskill` before/after (C12). Mutation for C12's red proof: point the "real" path at a decoy HOME dir and drop `SYNCSKILL_DIR` from the env (decoy only).
- [ ] **Step 5: mutations** seen red: no `--no-refresh`; no sort/unique; comma not refused; `error`-event code ignored. **Step 6: commit** `feat(skills): spawn syncskill for profile lookups and per-run injection`.

---

### Task 3: Orca — declaring `skills` on a loop recipe

**Files:**
- Modify: `src/control/loopPlans.ts` (`loopPlanFileSchema`, `loopRecipeSchema`, `expandLoopPlan`, `expandLoopTask`, `LoopRefusal`)
- Modify: `src/control/webProtocol.ts` (only if the plan file `loop` object is parsed there separately — it reuses `loopPlanFileSchema` via `src/scheduler/planFile.ts`)
- Test: `tests/control/loopPlanSkills.test.ts` (new); golden fixture under `tests/control/fixtures/`

**Interfaces:**
- Consumes: `isSafeSkillName`, `PROFILE_NAME_PATTERN` from Task 2.
- Produces:
  ```ts
  export const loopSkillsSchema = z.union([
    z.object({ profile: z.string().regex(PROFILE_NAME_PATTERN) }).strict(),
    z.object({ names: z.array(z.string()).min(1) }).strict(),
  ]);
  export type LoopSkills = { profile: string } | { names: string[] };
  // loopPlanFileSchema gains `skills: loopSkillsSchema.optional()`
  // loopRecipeSchema gains `skills: loopSkillsSchema.optional()` (names stored sorted+unique)
  export function normalizeLoopSkills(s: LoopSkills): LoopSkills | "skills-shape"; // validates names, sorts, dedups
  // expandLoopPlan(taskId, repoPath, planId, inputs, chosenBy = "explicit", skills?: LoopSkills): recipe = {...,  ...(skills ? { skills } : {}) }
  ```
  `LoopRefusal` gains `"skills-shape"`.
- [ ] **Step 1: failing tests (C1, C2):** a plan file task with `loop.skills.names: ["b","a","a"]` imports and the archived recipe has `skills: { names: ["a","b"] }`; with `profile` likewise; the derived contract is byte-identical with and without skills (contract never contains `skills`); a golden plan file **without** skills keeps the exact archive bytes, `planHash` and contract hash recorded before the change (write the golden first, at the current HEAD); refusals `skills-shape` for: both keys, `names: []`, `".x"`, `"a/b"`, `"a,b"`, `" a"`, profile `"bad name"`.
- [ ] **Step 2: red. Step 3: implement** with conditional spreads only (`...(skills === undefined ? {} : { skills })`; an explicit `undefined` throws `control-non-canonical-json`). `expandLoopTask` reads `input.skills`. `requirementSplit.ts` needs no change (no skills there).
- [ ] **Step 4: mutations** seen red: write `skills: undefined`/`null` when absent; drop the comma check; drop the sort. **Step 5: commit** `feat(loop-plans): let a loop task declare a skill set (names or a syncskill profile)`.

---

### Task 4: Orca — freezing skills into the execution snapshot at confirm

**Files:**
- Modify: `src/control/webProtocol.ts` (`executionSnapshotSchema` ~L479: optional `skills`, superRefine)
- Modify: `src/control/executionSnapshot.ts` (`prepareExecutionSnapshot` input/output; `readConfirmedTaskExecution` check and return)
- Modify: `src/control/webService.ts` (`confirm`: lookup before the transaction, refusals inside it); its deps type gains `syncskill: SyncskillOptions`
- Modify: where `WebControlService` deps are assembled (grep `new WebControlService(` / `createWebControlService`; `src/panel/server.ts` ~L130 reads `ORCA_CCMEM_BIN` — read `ORCA_SYNCSKILL_BIN` the same way and pass `{ bin, env }`)
- Modify: `src/control/errors.ts` (codes: `syncskill-unconfigured`, `skills-unsupported-agent`, `skills-profile-empty`, `syncskill-failed`, `syncskill-missing`, `syncskill-timeout`, `syncskill-output-invalid`, `syncskill-output-too-large` with HTTP statuses consistent with neighbours)
- Test: `tests/control/confirmSkills.test.ts` (new; copy group setup from `tests/control/confirmation.test.ts`), `tests/control/executionSnapshot.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 2 `profileMembers`, `SyncskillError`; Task 3 recipe `skills`.
- Produces:
  ```ts
  // snapshot: skills?: Array<{ taskId: string; profile: string | null; names: string[] }>  (sorted unique by taskId, ⊆ derivedContracts)
  // readConfirmedTaskExecution(...) returns { ..., skills: { profile: string | null; names: string[] } | null }
  ```
- [ ] **Step 1: failing tests:** (C3) confirm of a group whose task has `profile: "p"` with the fake syncskill answering `["b","a"]` freezes `{ taskId, profile: "p", names: ["a","b"] }`; a golden group without skills keeps its exact snapshot hash (pin before the change); `names` tasks are frozen without spawning (fake log empty). (C4) refusals, group stays unconfirmed: bin unset ⇒ `syncskill-unconfigured`; task agent `codex` ⇒ `skills-unsupported-agent`; `E_PROFILE_NOT_FOUND` ⇒ `syncskill-failed:E_PROFILE_NOT_FOUND`; empty profile ⇒ `skills-profile-empty`. (C16) tamper: rewrite the snapshot record's `skills[0].names` (and, separately, delete the entry, and add one for a task without skills) ⇒ `readConfirmedTaskExecution` throws `recovery-blocked`.
- [ ] **Step 2: red. Step 3: implement.** In `confirm`, before `applyWebCommand`, compute `skillFreeze = await freezeSkills(...)` returning either `{ entries }` or `{ failure }` (lookups sequential, one per distinct profile); inside `apply`, after the agent-selection checks, `if ("failure" in skillFreeze) throw skillFreeze.failure;` then check each task with skills has `agent.agent === "claude"` (else `skills-unsupported-agent`) and pass `skills: entries` (omit when empty) into `prepareExecutionSnapshot`. Comparison in `readConfirmedTaskExecution`: entry exists ⇔ effective recipe has `skills`; `names` ⇒ arrays equal; `profile` ⇒ `entry.profile === recipe.skills.profile`.
- [ ] **Step 4: mutations** seen red: freeze the profile name without members; drop each refusal; drop the tamper check. **Step 5: commit** `feat(confirm): freeze each task's skill set into the execution snapshot`.

---

### Task 5: Orca — set-task-loop carries `skills`; the panel keeps them

**Files:**
- Modify: `src/control/webProtocol.ts` (`setTaskLoopPayloadSchema`: `skills: loopSkillsSchema.optional()`)
- Modify: `src/control/webService.ts` (`setTaskLoop` → `async`, lookup before `mutate`; `kept`; no-op test; confirmed branch updates snapshot skills)
- Modify: `src/control/executionSnapshot.ts` (`replaceTaskInSnapshot(..., skills: { profile: string | null; names: string[] } | null)`)
- Modify: callers of `setTaskLoop` (grep `setTaskLoop(`, e.g. `src/panel/controlApi.ts`) to `await`
- Modify: `web/src/LoopPlanCard.tsx` (~L58, L102–113: the payload carries the task's current `skills` unchanged)
- Test: `tests/control/setTaskLoopSkills.test.ts` (copy setup from `tests/control/setTaskLoop.test.ts` and `setTaskLoopConfirmed.test.ts`), a web test next to the existing LoopPlanCard tests (grep `LoopPlanCard` under `web/tests`)

**Interfaces:**
- Consumes: Tasks 2–4.
- [ ] **Step 1: failing tests:** (C13) on a v1 recipe task, a set-task-loop that only adds `skills` is accepted (not `no-op-command`), the new recipe keeps `planVersion: 1` and the same contract bytes; a repeat with identical skills and budget ⇒ `no-op-command`. (C15) on a confirmed task: adding, changing (profile re-resolved through the fake) and removing skills rewrites that task's snapshot entry (removing the last one drops the top-level key — snapshot hash equals the golden without skills); a codex task ⇒ `skills-unsupported-agent`. (C14) web: editing the budget on a card whose task has skills sends a payload whose `skills` equals the task's.
- [ ] **Step 2: red. Step 3: implement.** `kept` keeps comparing `inputs` only and builds `{ ...current.loop!, inputs, ...(payload.skills ? { skills: normalized } : {}) }` (drop the key when the payload has none); the no-op test becomes `expanded.canonicalJson === current.originalContractCanonicalJson && same(next, before) && sameSkills(current.loop?.skills, recipeSkills)`. On the confirmed branch pass the resolved entry (or null) to `replaceTaskInSnapshot`, which adds/replaces/removes the task's entry and deletes `skills` when it becomes empty. The existing `readConfirmedTaskExecution(this.store, id, taskId)` at the end then validates it.
- [ ] **Step 4: mutations** seen red: `skills` included in `kept`; `skills` left out of the no-op test; `replaceTaskInSnapshot` ignoring skills; card payload without skills. **Step 5: commit** `feat(set-task-loop): change a task's skill set, before or after confirmation`.

---

### Task 6: Orca — inject at A2, carry `skillPluginDir`, clean up by runId

**Files:**
- Modify: `src/control/workspace.ts` (`skillsPathOf`; `cleanupRunWorkspace` removes it unconditionally)
- Modify: `src/control/driveRecord.ts` (`skills: z.object({ dir, profile: string|null, lock: LockSkill[] }).nullable().default(null)`)
- Modify: `src/control/executionDriver.ts` (`newDrive` adds `skills: null`; `stepA2` injection; `ExecutionDriverDeps.syncskill`)
- Modify: `src/control/schema.ts` (Orca's `loopWorkSchema` gains `skillPluginDir: z.string().min(1).optional()`)
- Modify: `src/control/startEnvelope.ts` (`StartEnvelopeWork.skillPluginDir?: string`, copied with a conditional spread)
- Modify: driver deps assembly (grep `ExecutionDriverDeps` construction, e.g. `src/panel/server.ts` / `src/control/*Assembly*`) to pass `{ bin: ORCA_SYNCSKILL_BIN, env }`
- Test: `tests/control/driverSkills.test.ts` (new; copy A2 setup from `tests/control/executionDriver.test.ts`), `tests/control/startEnvelope.test.ts` (add), `tests/control/workspace.test.ts` (add), an E2E smoke next to `tests/control/executionDriverE2E.test.ts`

**Interfaces:**
- Consumes: Task 1 (envelope field accepted by ccloop — the gate's `ORCA_CCLOOP_BIN` must be a build of the Task 1 commit), Task 2 `injectSkills`, Task 4 `readConfirmedTaskExecution().skills`.
- Produces: `skillsPathOf(roots, runId): string`; drive record `skills`.
- [ ] **Step 1: failing tests:** (C5) A2 of a run whose task froze `["alpha"]` with the fake syncskill: `skills-<runId>/skills/alpha/SKILL.md`, `skills-<runId>/.claude-plugin/plugin.json` = `{"name":"orca-run-skills","version":"0.0.0"}`, dirs mode `0700`, `skills/alpha` not writable, drive record `skills.lock` equals the fake's result; the fake's argv `--target` is `<dir>/skills`. (C6) the envelope has `work.skillPluginDir === <dir>`; for a run without skills the envelope hash equals a golden recorded before the change, and no fake syncskill spawn happened. (C10) fake `inject` answering `E_SKILL_NOT_FOUND` ⇒ run blocked at A2, reason `skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND`; bin unset ⇒ `skills-inject-failed:syncskill-unconfigured`. (C11/C17) `cleanupRunWorkspace` removes `skills-<runId>` even when the run's drive record has `skills: null` (simulate a restartRun of a run blocked before its A2 write); a continuation's A2 removes the predecessor's `skills-<pred>` (via `cleanupPredecessor`) and injects its own. A leftover `skills-<runId>` from a crashed A2 is replaced, not reused.
- [ ] **Step 2: red. Step 3: implement** in `stepA2` after `ensureWorkspace` and before `toStartEnvelope`:
  ```ts
  const skills = confirmed.skills;              // from readConfirmedTaskExecution
  let skillRecord: DriveRecord["skills"] = null;
  if (skills !== null) {
    const dir = skillsPathOf(deps.roots, runId);
    try {
      await removeOwnPath(targetRepo, deps.roots, dir);
      for (const sub of [dir, join(dir, "skills"), join(dir, ".claude-plugin")]) await mkdir(sub, { mode: 0o700 });
      const lock = await injectSkills(deps.syncskill, skills.names, join(dir, "skills"));
      if (lock.map(e => e.name).join("\0") !== skills.names.join("\0")) throw new SyncskillError("syncskill-output-invalid", "names");
      await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "orca-run-skills", version: "0.0.0" }), { mode: 0o600 });
      await makeReadOnly(join(dir, "skills"));  // chmod -R a-w, files and dirs
      skillRecord = { dir, profile: skills.profile, lock };
    } catch (error) { blockRun(deps, runId, "A2", `skills-inject-failed:${error instanceof SyncskillError ? error.code : describeError(error)}`); return true; }
  }
  ```
  Move `readConfirmedTaskExecution` above this block if needed (it is already called before the envelope). Pass `...(skillRecord ? { skillPluginDir: skillRecord.dir } : {})` into the `toStartEnvelope` work, and set `skills: skillRecord` in the final `write`. `cleanupRunWorkspace`: after removing the workspace, `chmod -R u+w` then `removeOwnPath(targetRepo, roots, skillsPathOf(roots, runId))` (read-only dirs cannot be emptied otherwise — test this).
- [ ] **Step 4: C9 smoke (no mutation):** an E2E run with skills through the fake ccloop world lands; the landed tree (`git ls-tree -r <landedCommit>`) has no `.claude/` path and no `syncskill-lock.json`; if the world's fake claude records argv, assert `--plugin-dir` is there.
- [ ] **Step 5: mutations** seen red: skip `plugin.json`; record the lock from the frozen names; skip chmod; always set `skillPluginDir`; swallow the inject error; key cleanup on `drive.skills`. **Step 6: commit** `feat(driver): inject each run's skill snapshot at A2 and hand ccloop the plugin dir`.

---

### Task 7: Orca — panel shows the declared set and the run's lock

**Files:**
- Modify: `src/panel/controlViews.ts` (the loop plan view and the run view expose `skills` and `drive.skills.lock`; follow how `RunViewV1.git.landedCommit` is exposed)
- Modify: `web/src/LoopPlanCard.tsx` (~L230: replace the "not supported yet" line), the run detail component (grep `landedCommit` under `web/src`)
- Modify: `web/src/locales/en.ts` (~L376), `web/src/locales/zh.ts` (~L281)
- Test: web tests next to the existing card/run-detail tests; `scanPanelText` must stay green

- [ ] **Step 1: failing tests (C19):** a card for a task with `{profile:"p"}` shows the profile and, after confirm, the frozen names; with `{names}` shows the names; no skills ⇒ a "none" string (not "not supported yet"); the run view lists each lock entry's name, `resolved_commit` (or the "local" string when null) and `content_md5`; both locales.
- [ ] **Step 2: red. Step 3: implement. Step 4: mutations** seen red: each rendering removed. **Step 5:** `npm run build --workspace web`, web tests, `scanPanelText`. **Step 6: commit** `feat(panel): show a task's skill set and the skills a run was given`.

---

### Task 8 (controller): final gate, review, ledger, docs

- [ ] Final whole-change review (one reviewer, both repos' diffs since the plan commit).
- [ ] Gates in clones: ccloop as in Task 1 Step 5; Orca `npm run verify` with `ORCA_CCLOOP_BIN` = the Task 1 ccloop build, HOME + four XDG roots redirected, short real TMPDIR; plus `ORCA_SYNCSKILL_REAL_BIN=<syncskill clone>/dist/index.js` for `tests/skills/syncskillReal.test.ts` and R1.
- [ ] Spec: append §11 "implementation corrections" for anything that changed; goal.md §11 rows; the three handoffs; awaitingHuman: push ccloop, then the agent re-pins Orca (`node scripts/pin-ccloop.mjs <SHA>`) — until then the packaged ccloop rejects envelopes with `skillPluginDir`.
