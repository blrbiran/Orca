# Flow Engine Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Goal:** one flow kernel next to the untouched dev flow — `orca-flow-v1` templates, `dir` workspaces through a vault,
  kinds `clarify` `draft` `work` `check` `review` `ask`, a journal with `fp1` fingerprints and a code-bounded re-run
  planner, a message stream, effect classes and levels with project > global settings, per-step tool rules passed to
  ccloop, the built-in `wechat-article`, a run page and `orca flow …` commands; plus #76 (W-76) and coarse corrections
  (W-COR); ending in one paid real run that stops at the WeChat draft box.
- **Architecture:** a flow run is a parent group with a run budget pool; each `work` execution is a hidden child group
  driven by today's execution driver with the per-directory bare vault as its target repository; code composes each
  step's base from the active outputs (`step_heads`), advances a CAS flow head and copies changes back into the person's
  folder. Everything that decides (candidates, composition, resolution, validation) is pure code; the model only drafts,
  reviews, proposes skips and triages feedback (Rule 5, P7).
- **Tech:** TypeScript ESM, zod `.strict()`, `node:sqlite` (STRICT tables), git plumbing (`merge-tree --write-tree`,
  `commit-tree`, `update-ref` CAS, `merge-file`), Express, vitest, React 19 (web), YAML (the parser `package.json`
  already depends on — re-measure; add none if one exists).
- **Spec:** `docs/superpowers/specs/2026-10-22-flow-engine-design.md` (cited "§n"). Executors read the spec **and** this
  plan. Neighbours: CLI v2 plan `docs/superpowers/plans/2026-10-22-cli-v2.md` (lands first), checks & triggers spec
  `docs/superpowers/specs/2026-10-22-checks-and-triggers-design.md` ("S1", lands first), ccloop
  `docs/superpowers/specs/2026-10-22-per-contract-tool-rules-design.md` §9 (ccloop repo).
- **Rulings:** `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md:34-71` (note the CORRECTION at `:49`: no
  read/write declarations, outputs recorded after the fact) and `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md`
  (§24 scope (A) accepted; "这次批准改写所有必要的判据"; "这一轮允许付费真跑"; claude `bypassPermissions` stays — do
  not propose changing it).
- **Author:** plan writer for session `b37f7ce9`, 2026-10-22. Anchors measured at Orca `7b585a49`, ccloop `638c3d8`,
  md2publish-skills `a2b9dc8`, runskills `e62c5f8` with `grep -n` / `sed -n`. **CLI v2 and S1 land before this plan
  runs and move code under it: re-measure every anchor at the start of each task** (Rule 14) and fix the task text in
  the ledger, not in this file.
- **Ledger:** `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md` (append). Every criterion rewrite is a line
  `file:line old → new, reason` and its commit body carries `Ruling: 这次批准改写所有必要的判据 (b37f7ce9)`.

## Global Constraints

- **Verification is `npm test`** (Rule 18; it runs typecheck and selects tests by change). Never `npm run verify`.
  Every run `> $LOGS/<task>-<n>.log 2>&1`, then read the whole log (Rule 14). `$LOGS = /private/tmp/orca-b37f7ce9/logs/flow`.
  Copy "N selected", "0 selected" and every skipped file verbatim into the ledger (Rule 12). Load flakes: re-run singly
  per `docs/handoff/known-load-flakes.md` before calling a red a regression.
- **Rule 9:** every new branch names the mutation that deletes it and sees it red. Mutations only in a
  `git clone --local` copy (`/private/tmp/orca-b37f7ce9/mut-<task>`); the worktree's `git diff | wc -c` and
  `git diff --cached | wc -c` are both `0` afterwards. Spec §21's mutation column is the minimum per criterion.
- **Rule 17:** new out-of-repo paths only `$ORCA_VAULT_DIR` (default `~/.orca/vault/`) and copy-back into the person's
  `dir` folder (§20). Dirs `0700`, files `0600`, set explicitly, never from umask; an existing file's mode is never
  changed. Every test sets `ORCA_VAULT_DIR` (and every other `ORCA_*` redirect) to a temp dir. No default may be read
  from `os.homedir()` at a call site; one resolver per path (C21 proves it).
- **Dev flow untouched (H19):** no behaviour change to requirement groups except #76 and corrections. C7 guards prompt
  bytes; every existing requirement e2e test stays green **unchanged** (a needed change there is a stop-and-report).
- **Frozen names (§18):** `format: orca-flow-v1`, field names of §3.2 (plus this plan's two additions below), kind
  names, `fp1`, candidate reasons, message kinds/targets, `by`/`via` values, effect classes/levels, vault ref names,
  `flow` result key, command names. Do not rename after the task that introduces them.
- **Refusal codes, verbatim:** `flow-group-delivery-fixed`, `flow-setting-locked`, `flow-setting-needs-person-token`,
  `requirement-already-accepted`, `revision-unchanged`, `role-unresolved:<role>`, `flow-template-invalid`,
  `flow-run-not-found`, `flow-step-not-found`, `flow-message-target-missing`, `flow-ask-closed`,
  `flow-effect-not-staged`, `flow-effect-closed`, `flow-plan-stale`, `flow-pool-exhausted` (needs-you reason). Red-flag
  reasons: `compose-conflict`, `copy-back-conflict`, `writeTo-missing`, `edit-no-longer-applies`, `effect-failed`,
  `tool-rule:<status>`.
- **Defaults (writer's call, settings-overridable):** vault per-file cap 50 MB, per-snapshot cap 500 MB (§5.2); built-in
  `flows.budgets.tokensPerRun` default **2,000,000**; repo-only correction window 10 landed groups / 14 days (§13.2);
  rerun-proposal diff bound 16 KiB per output, 64 KiB total, cut recorded.
- **Two field additions to `orca-flow-v1`** (§6.3 names them, §3.2 omits them; frozen from Task 3): top-level
  `budget: {tokensPerRun: int>0}` and step `budget: {tokens: int>0}`.
- **Access (CLI v2 has landed):** every new verb gets a `VERB_ACCESS` row (§14.2 table, unchanged) **and** a
  `SOCKET_TIER` row: all six human-only flow verbs (`flow-effect`, `flow-answer`, `flow-rerun`, `flow-pool`,
  `set-flow-settings`, `set-flow-locks`) are **`token`**; dispatched-run marker refuses them; Web members unchanged.
  `irreversible: apply-flag` stays refused from every channel (`flow-setting-needs-person-token`, C18 as written).
- **Attribution:** every journal/message/effect/decision row takes `{by, via}` from CLI v2's `attributionOf`
  (`src/panel/permissions.ts`, re-measure); unattended acts write `by: "orca-auto", via: "orca"`; drift `via: "fs"`.
- Comments English, match surrounding density. Commits small, one per task unless noted. No push (Tier 0); merges into
  `main` only `--ff-only`.

## Review Focus

1. **Shell metacharacters in params reaching commands.** `{{param.*}}` inside a check `run` or a `tools` command may
   only name params of type `slug`, `int`, `enum` or `path` (validated values); a `text`/`longtext` param there is a
   checklist error; a `path` value containing `'`, NUL or newline is refused at start. → Task 3 test
   `param types allowed in commands`.
2. **Path traversal.** `prompt`/asset paths with `..` or absolute paths, a `path` param with `..`, and `writeTo.file`
   resolving outside the workspace are refused (checklist error / red flag `writeTo-missing`, nothing written). → Task 3
   and Task 9 tests.
3. **Panel restart while a child group runs.** On restart the kernel re-derives from `step_executions` + the child
   group's state; the deterministic child id means no second child and no second dispatch. → Task 10 test
   `restart mid-execution`.
4. **Two flow runs on one folder at once.** Import numbering `refs/orca/import/<n>` is allocated by CAS (no two runs get
   the same `n`); each run's flow head is its own; the second run's copy-back sees the first's writes as drift, never
   overwrites them. → Task 6 test `two runs one vault`.
5. **Symlinks and special files in the person's folder.** Import records a symlink as a link (never follows it out of
   the folder); copy-back never writes through a symlink and never creates one pointing outside the folder; fifos and
   sockets are excluded and listed. → Task 6 test `symlink never followed`.

---

## Order and dependencies

```
T1 repin ──────────────────────────────┐
T2 dir projects + vault spike ─┐        │
T3 template core ─────────────┼──┐     │
T4 storage + golden ── T5 W-76 │  │     │
T6 vault ─────────────────────┘  │     │
T7 journal/planner (pure) ───────┤     │
T8 kernel + record kinds ────────┤     │
T9 ask + writeTo ────────────────┤     │
T10 work kind ───────────────────┴─────┘ (needs T1, T6, T8)
T11 messages/rerun/rewind (T7, T10)    T12 effects + settings (T10)
T13 md2publish-skills (other repo; any time after T1) ─┐
T14 built-in wechat-article + C6 + C21 (T11, T12, T13) ┤
T15 commands (T11, T12)   T16 web (T15)   T17 W-COR (independent)
T18 install, backup, paid acceptance (all)
```

---

### Task 1: Repin ccloop to per-contract tool rules; Orca-side parse (ccloop spec §9)

**Precondition (stop if false):** the ccloop branch `feat/per-contract-tool-rules` is merged `--ff-only` into ccloop
`main` and pushed (this session's ruling allows the controller a plain `git push origin main` in ccloop only; if the
Tier 0 gate blocks it, stop and list it in `awaitingHuman` — do not rephrase). `scripts/pin-ccloop.mjs` installs from
GitHub and refuses an unpushed commit.

**Files:**
- Modify: `package.json`, `package-lock.json` (by the script only)
- Modify: `src/scheduler/planFile.ts:207-212` (contract `executionPolicy` gains optional `toolRules`)
- Create: `src/control/toolRules.ts` (Orca's mirror of ccloop's wire shape and report)
- Modify: `src/control/ccloopPort.ts:41` (`collectionSchema` gains optional top-level `toolRules`), `:277` (`collect`
  passes it through), `src/control/executionPort.ts:21` (`ExecutionReport.toolRules?`),
  `src/control/driveRecord.ts:144` region (drive record keeps `toolRules?`), `src/control/executionDriver.ts:633`
  (stores it with `failureCause`)
- Modify: `src/panel/controlViews.ts:428-435` region (cause `tool-rule-violated` worded; unknown causes already pass)
- Test: `tests/control/toolRulesCollect.test.ts` (new)

**Interfaces:**
- Produces (`src/control/toolRules.ts`):
  - `toolRulesSchema` = ccloop §2 exactly: `{commands: [{kind: "exact"|"prefix", value}] (0..64, unique), network:
    boolean, secretEnv: string[] (0..32, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/, unique)}`, `.strict()`, all keys required,
    no `.default()`. `type ToolRules`.
  - `toolRulesReportSchema` = ccloop §5 `ToolRulesReportV1`, strict. `type ToolRulesReport`.
  - `ExecutionReport.toolRules?: ToolRulesReport`; drive record field `toolRules?`.

- [ ] **Step 1:** `node scripts/pin-ccloop.mjs <40-hex ccloop main sha> > $LOGS/t1-pin.log 2>&1`; read whole; exit 0
  required (every `ok` line). Run `npm run verify:ccloop-pin > $LOGS/t1-verify-pin.log 2>&1` (the pin's own check,
  not the release gate); exit 0.
- [ ] **Step 2: Failing tests** (`toolRulesCollect.test.ts`):
  - a plan-file contract with `executionPolicy.toolRules` parses; with an extra key inside `toolRules` refused; with
    `network` missing refused (no default).
  - `sha256Canonical(contract)` differs between a contract with and without `toolRules` (contractHash covers it).
  - `withinGrant(policy-with-toolRules, grant).toolRules` deep-equals the input (`executionDriver.ts:439`).
  - collect answer with top-level `toolRules` report ⇒ `ExecutionReport.toolRules` equals it; without ⇒ key absent.
  - collect answer with a malformed `toolRules` (status `"enforcedish"`) ⇒ parse refuses.
  - `failureCause.cause = "tool-rule-violated"` reaches the drive record and the run view's cause text.
- [ ] **Step 3:** run → red (`$LOGS/t1-red.log`).
- [ ] **Step 4:** implement the files above.
- [ ] **Step 5:** `npm test > $LOGS/t1.log 2>&1` → green. Every existing assertion on collect bytes or contract shape
  that is now false is a ledgered criterion rewrite.
- [ ] **Mutations:** drop `toolRules` from `collectionSchema` ⇒ red; `.default(false)` on `network` ⇒ red; `withinGrant`
  rebuilds the policy without spreading ⇒ red.
- [ ] **Commit** `chore(deps): pin ccloop with per-contract tool rules; parse toolRules and tool-rule-violated`.

### Task 2: `dir` projects and the vault-as-target spike (§5.1, package 0)

**Files:**
- Modify: `src/panel/projectsFile.ts:17` (`ProjectEntryV1.kind?: "repo" | "dir"`; absent = `repo`), the panel
  repository listing (re-measure: `grep -rn "projects" src/panel/projectRegistry*.ts`) shows `dir` entries with a
  `dir` badge and hides repository-only actions (integration scheme, delivery, PR) for them.
- Create: `src/flow/vault/paths.ts` — `vaultDir(env): string` (`$ORCA_VAULT_DIR ?? join(homedir(), ".orca", "vault")`,
  the **only** place `homedir()` is read for the vault), `vaultPathFor(env, dir): Promise<string>` =
  `<vaultDir>/<sha256(NFC(realpath(dir)))>.git`.
- Test: `tests/panel/projectsFileKind.test.ts`, `tests/flow/vaultDriverProbe.test.ts` (spike case only; Task 10
  completes C14).

- [ ] **Step 1: Failing tests:** an existing `projects.json` without `kind` parses byte-equal on re-save; `kind:"dir"`
  for a folder with no `.git` validates; `kind:"bogus"` refused. Spike: create a bare repo with
  `git init --bare --shared=0600`, commit a tree into it by plumbing, then run **today's** driver path that a debug
  group uses (`buildDebugPlanSource`-style one-task plan; re-measure `src/control/debugPlan.ts:174`) with
  `repoPath` = the bare vault and the fake agent of `tests/control/fixtures/ccloopWorld.ts`; assert the attempt
  worktree was created (`git worktree list` in the vault), the attempt commit and `refs/heads/orca/<groupId>` exist in
  the vault.
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** implement `kind`, listing, `vault/paths.ts`. **If the spike cannot pass without changing ccloop or the
  driver beyond repository resolution, stop and report (§16.2 "if it fails, the builder stops").**
- [ ] **Step 4:** `npm test` green.
- [ ] **Mutations:** default absent `kind` to `dir` ⇒ red; `vaultPathFor` without NFC ⇒ an NFD/NFC pair of folder
  names yields two vaults ⇒ red (add that case).
- [ ] **Commit** `feat(panel): dir projects; vault path resolver and vault-as-target probe`.

### Task 3: Template core (pure) — schema, checklist, `when`, variables, built-in loader (package 1, C1)

**Files:** Create `src/flow/template/{schema,checklist,when,vars,load}.ts`. Test `tests/flow/templateSchema.test.ts`,
`tests/flow/templateWhenVars.test.ts`.

**Interfaces (Produces):**
- `flowTemplateSchema` (zod, `.strict()` at every level, §3.1–§3.2 + the two `budget` fields); `type FlowTemplate`,
  `type FlowStep` (discriminated by `kind` over the phase-1 kinds; phase-2+ kinds are schema errors in phase 1).
- `parseTemplateDraft(yamlText): {ok: true, raw: unknown} | {ok: false, error}` — save path: YAML parse only.
- `checkTemplate(tpl: unknown, assets: AssetReader, ctx: {builtinEffectSkills: ReadonlySet<string>}):
  {errors: Finding[], warnings: Finding[]}` — the one static checklist (§3.3) shared by Web, CLI and start;
  `Finding = {code: string, path: string, message: string}`. `AssetReader = {exists(rel): boolean, read(rel): string}`.
- `evaluateWhen(pred, {params, classification}): boolean`.
- `expandVars(text, scope: VarScope, where: "prompt" | "command"): string` — `{{param.<id>}}`, `{{run.id}}`,
  `{{workspace}}`, `{{skill.<name>.dir}}`, `{{effect.recordId}}`, and in commands `{{base:<path>}}` (resolved by the
  caller to a temp path); unknown ⇒ throws. Commands quote nothing themselves: templates quote.
- `deriveParam(kind: "slug-of-idea" | "today", params, now): string` (code only).
- `loadBuiltin(id): {template: FlowTemplate, bytes: Buffer, sha256: string, assets: AssetReader}` reading
  `flows/builtin/<id>/` (repo root resolved from the module URL, not cwd).

- [ ] **Step 1: Failing tests:** every C1 refusal (unknown key at each level, duplicate step id, duplicate check id,
  skill not in `requires`, effect kind not in `effects:`, class `human-only`, unknown var, `loop.until.check` missing
  or naming a diagnostic, bare `python3`/`bash`/`node`/`bun` prefix in `tools`, `executor: person` on `check`,
  `parallelWith` unknown, `distinctFrom` unknown, `when` on an unknown param, asset missing); save accepts a broken
  draft, `checkTemplate` refuses it; warning (not error) for an unclassed step using a skill in
  `builtinEffectSkills`. Review Focus 1: `{{param.idea}}` (longtext) in a check `run` ⇒ error
  `param-type-not-allowed-in-command`; `{{param.slug}}` ok. Review Focus 2: `prompt: ../x.md` and `/etc/x` ⇒ error
  `asset-path-outside-template`; `path` param default `../a` ⇒ error. `when` table: `equals`, `in`, `truthy`,
  `classification.scope`, nested `and/or/not`. `deriveParam("slug-of-idea")` is deterministic ASCII `[a-z0-9-]`, ≤ 64,
  non-empty for CJK-only ideas (falls back to `article-<sha8>`).
- [ ] **Step 2:** red.
- [ ] **Step 3:** implement. YAML: the existing dependency (re-measure); no new one if present, else `yaml@2` pinned.
- [ ] **Step 4:** `npm test` green.
- [ ] **Mutations (C1):** drop `.strict()` on the step schema ⇒ red; call `checkTemplate` from the save path ⇒ red;
  allow a bare interpreter prefix ⇒ red; allow `text` params in commands ⇒ red.
- [ ] **Commit** `feat(flow): orca-flow-v1 schema, static checklist, when and variables`.

### Task 4: Storage — schema step, `requirement_rounds` re-key, C7 golden first (package 2, §6.1, §10.1)

**Files:**
- Create: `tests/control/fixtures/clarifyPromptGolden.txt` and `tests/control/clarifyPromptGolden.test.ts`
  (**Step 1, before any `src/` edit in this task**)
- Modify: `src/control/migrations.ts` (`schemaVersion` = S1's value + 1 — re-measure; expected `"16"` → `"17"`), the
  migration function; `src/control/requirementRecords.ts:135-202` (`readRounds`, `readRound`, `latestRound`,
  `writeRound`, `clarifyLimits` take `(groupId, stepKey, execSeq)`), every caller (requirement host passes
  `("clarify", 1)`; re-measure with `grep -rn "latestRound\|writeRound\|readRounds\|readRound(" src`)
- Create: `src/flow/store.ts` (typed access to the new tables)
- Test: `tests/control/roundsRekeyMigration.test.ts`, `tests/flow/flowStore.test.ts`

**Interfaces (Produces):**
- Tables of §6.1 exactly (STRICT, JSON `body`): `flow_runs`, `step_executions`, `step_heads` (**stays a table**, §22),
  `flow_messages`, `rerun_plans`, `effect_records`, `flow_decisions`, `flow_templates`.
- `requirement_rounds` PK `(group_id, step_key, exec_seq, round_no)`, `step_key TEXT NOT NULL`,
  `exec_seq INTEGER NOT NULL CHECK(exec_seq > 0)`; rebuild = create new, copy, drop, rename in one transaction.
- `src/flow/store.ts`: `insertFlowRun`, `getFlowRun`, `appendExecution(row)`, `setExecutionState(key, from, to)` (refuses backwards), `getHead`/`setHead`
  (CAS on `active_seq`), `appendMessage` (UNIQUE `request_id` ⇒ returns the existing row = dedupe), `putPlan`,
  `putEffect`, `setEffectState` (forward only), `appendFlowDecision`, `upsertTemplateIndex`.

- [ ] **Step 1 (golden):** write `clarifyPromptGolden.test.ts` that builds today's dev clarify prompt for a fixed
  requirement fixture (re-use `tests/control/fixtures/requirementHarness.ts`) and compares to the fixture file; generate
  the fixture from **unchanged** code; commit it alone: `test(control): golden bytes of the dev clarify prompt (C7)`.
- [ ] **Step 2: Failing tests:** migration on a v(N) DB with 3 rounds in 2 groups ⇒ row count equal, every body
  byte-equal, all `('clarify', 1)`; schema version `N+1`; inserting `exec_seq = 0` fails; executions refuse a
  backwards state move; `appendMessage` twice with one `request_id` ⇒ one row; head CAS with a stale `active_seq` ⇒
  refused.
- [ ] **Step 3:** red → implement → rewrite the schema-version pins (`grep -rln 'schemaVersion' tests`, ledger each).
- [ ] **Step 4:** `npm test` green; C7 still green.
- [ ] **Mutations (C10 part):** map old rows to `exec_seq` 0 ⇒ red; copy without the transaction (abort mid-way leaves
  two tables) ⇒ a fault-injection case red; `setHead` without CAS ⇒ red.
- [ ] **Commit** `feat(control): flow journal tables and requirement_rounds keyed by step execution (schema N+1)`.

The **control DB backup** is not taken here (tests use temp DBs). It is taken once in Task 18 before the installed
panel first runs schema `N+1`; if S1's schema step has not yet run on the real DB either, that one backup covers both
(§6.1) — record which in the ledger.

### Task 5: W-76 — revise an earlier clarify round (§10.3, C10)

**Files:** Create `src/control/clarifyChain.ts`. Modify `src/control/requirementCommands.ts` (new verb handler,
re-measure `:123-133`), `src/control/requirementRecords.ts` (`clarifyLimits` counts chain positions), the clarify prompt
builder (superseded answers as recommended answers), `src/panel/humanOnly.ts` (`requirement-revise: "any"`), the CLI v2
registry (`orca requirement revise <group> --round k --file f`), web Requirements panel (edit a past round ⇒ dialog
stating "one clarify call" ⇒ revise; superseded rounds collapsed). Test `tests/control/requirementRevise.test.ts`,
`tests/control/clarifyChain.test.ts`, web test for the panel.

**Interfaces (Produces):**
- `activeChain(rows: readonly {roundNo: number; revises?: number}[]): {chain: number[]; superseded: number[]}` (pure).
- Verb `requirement-revise` payload `{groupId, stepKey?, execSeq?, roundNo, answers, glossaryDecisions,
  adrDecisions, reason?, exclude?: number[]}`; refusals `requirement-already-accepted`, `revision-unchanged`, plus
  `requirement-answer`'s id checks.
- Requirement block gains `consensusWithdrawn {at, by, revisedRound}`.

- [ ] **Step 1: Failing tests (C10):** 3 answered rounds, revise round 2 ⇒ row 4 appended `{revises: 2, …}`, rows 1–3
  byte-equal, chain `[1, 4]`, superseded `[2, 3]`; next round's prompt carries round 3's answers as recommended unless
  `exclude: [3]`; consensus withdrawn and an `awaiting-review` draft closed `rejected` `requirement-revised`; after
  accept ⇒ `requirement-already-accepted`; identical answers ⇒ `revision-unchanged`; caps compare chain length (a
  chain of 2 under cap 3 queues a call even when `round_no` is 4); C7 golden unchanged.
- [ ] **Step 2:** red → **Step 3** implement → **Step 4** `npm test` green (ledger rewrites of
  `requirementClarifyCaps.test.ts` assertions that compared `round_no`).
- [ ] **Mutations (C10):** overwrite round k in place ⇒ red; compare `round_no` to the cap ⇒ red; drop superseded
  answers from the prompt ⇒ red.
- [ ] **Commit** `feat(requirement): revise an earlier clarify round as a new round (#76)`.

### Task 6: Vault — import, composition, flow head, copy-back, drift (package 3, §5.2–§5.4, C3 C4 C5)

**Files:** Create `src/flow/vault/{vault,snapshot,compose,copyBack,drift}.ts`. Test `tests/flow/vault.test.ts`,
`tests/flow/composition.test.ts`, `tests/flow/drift.test.ts`.

**Interfaces (Produces):**
- `openVault(env, dir): Promise<Vault>` — creates with `git init --bare --shared=0600`, `core.precomposeUnicode=true`,
  `info/exclude` = `.git/`, `node_modules/`, `.DS_Store` + `workspace.excludes`; dirs `0700`. Every git call uses
  `QUIET_GIT` and `unsetInheritedGitEnv()` (`src/control/workspace.ts:14-22`).
- `importSnapshot(vault, dir, {flowRunId, caps}): Promise<{commit, n, overCap: string[], excluded: string[]}>` —
  `refs/orca/import/<n>` allocated by CAS (`update-ref <ref> <new> ""`), parent = previous import; also writes
  `refs/orca/<flowRunId>/base`. Never reads `HEAD`.
- `compose(vault, base: string, outputs: {stepKey, commit, parent}[]): Promise<{tree, commit} | {conflict: stepKey}>`
  — `merge-tree --write-tree` per output in template order, `commit-tree`.
- `advanceHead(vault, flowRunId, expected: string, next: string): Promise<boolean>` — `update-ref` CAS.
- `copyBack(vault, dir, from: string, to: string): Promise<{written: string[], conflicts: string[]}>` — §5.4 rules;
  new files `0600`, new dirs `0700`, existing modes untouched; three-way `git merge-file` on a person-edited path;
  conflict ⇒ person's file byte-identical; deletes only when the file equals `from`'s blob; never follows or writes
  through symlinks.
- Not built here: `orca flow vault gc` (§20 names it for unreferenced composition objects; it is in no §14.2 row) —
  objects simply accumulate in phase 1; recorded in Task 19.
- `snapshotDrift(vault, dir, head: string): Promise<{commit, paths: string[]} | null>`;
  `placeDrift(paths, activeOutputs: {stepKey, paths}[] in template order): stepKey | "start"`.

- [ ] **Step 1: Failing tests:** all of C3, C4 (pure composition over a real temp vault: `cover`/`article` parallel,
  `voice` rewound to `#1`, CAS race recomposes, conflict names the earlier step), C5; Review Focus 4 (two concurrent
  `importSnapshot` ⇒ distinct `n`; run B's copy-back keeps run A's write); Review Focus 5 (a symlink to `/tmp/x` in
  the folder is stored as a link, `/tmp/x` never read or written; a fifo is excluded and listed).
- [ ] **Step 2:** red → **Step 3** implement → **Step 4** `npm test` green.
- [ ] **Mutations:** full-tree overwrite on copy-back ⇒ red; apply a delete on a changed file ⇒ red; rely on vault
  `HEAD` ⇒ red; base from a branch tip instead of composing ⇒ red; skip the CAS ⇒ red; compose from all executions
  instead of `step_heads` ⇒ red; place drift at the end ⇒ red; leave drift out of the composition ⇒ red.
- [ ] **Commit** `feat(flow): per-directory vault with composition, CAS flow head, copy-back and drift`.

### Task 7: Journal fingerprints and re-run planner (pure) (package 4, §6.4, §7, C2)

**Files:** Create `src/flow/journal/{fingerprint,candidates,proposal,cutoff}.ts`. Test `tests/flow/rerunPlanner.test.ts`
(table-driven).

**Interfaces (Produces):**
- `definitionHash(step, promptBytes, skillLocks: {sourceId, resolvedCommit, contentMd5}[], checks, tools, kindVersion)`,
  `ranOn(baseTreeId, earlier: {stepKey, outputHash}[] ordered by (templatePos, stepId), paramsSha256)`,
  `fingerprint(def, ranOn)` — all `fp1`, sha256 over canonical JSON; agent/model never inputs.
- `outputHashOfCommit(changes: {path, blob}[])`, `outputHashOfRecord(artifactSha256)`.
- `candidates(journal, template, messages, ws): {stepKey, reasons: Reason[]}[]` — reasons exactly §7.2.
- `validateProposal(raw, candidates, feedbackTargets): {ok: true, skips} | {ok: false, why}` — schema
  `{skips: [{stepKey, reason}], startAt?}`; `startAt` ⇒ skips of earlier candidates.
- `afterExecution(plan, candidatesNow): plan` — steps only leave (cutoff by `equals` projection or `outputHash`, or
  person "unchanged").

- [ ] **Step 1: Failing table:** every C2 row; `when`-false steps `skipped` never candidates; an `edit` target is not a
  candidate, later steps are; `compose-conflict` reason; failed/rate-limited executions never reused.
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations (C2):** "no read set" ⇒ "read nothing"; accept a key outside the candidates; let the model skip a
  feedback-targeted step; execute in proposal order; cutoff drops a step with another live reason; reuse a failed
  execution; model id in `fingerprint` — each red.
- [ ] **Commit** `feat(flow): fp1 fingerprints and the code-bounded re-run planner`.

### Task 8: Kernel and record kinds — registry, `draft`, `check`, `review`, `clarify` flow host, `flow` result key (package 5 part, C8 C9 C22)

**Files:**
- Create: `src/flow/kinds/registry.ts`, `src/flow/kinds/{draft,check,review,clarify}.ts`, `src/flow/kernel.ts`,
  `src/flow/prompt.ts` (envelope §12.1 + the code-owned unattended fragment §4.3), `src/control/clarifyHost.ts`
- Modify: `src/control/singleCall.ts:11` (+ `flow-draft`, `flow-review`, `flow-ask`, `rerun-proposal`),
  `src/control/singleCallPurposes.ts` (handlers), `src/control/reportedDecisions.ts` (`reportedFlowOf(result)`),
  `src/control/requirementClarify.ts` (behind `ClarifyHost`, requirement host byte-for-byte), the panel pump (call
  `advanceFlowRuns` after `orchestrateOnce`; re-measure `grep -rn "orchestrateOnce" src/panel`)
- Test: `tests/flow/kindRegistry.test.ts`, `tests/flow/clarifyHost.test.ts`, `tests/flow/clarifyZeroRound.test.ts`,
  `tests/flow/unattendedSkills.test.ts`, `tests/flow/recordKinds.test.ts`

**Interfaces (Produces):**
- `registerKind({kind, kindVersion, schema, start, collect, projection?, interactive})`; duplicate ⇒ throws at start-up.
- `startFlowRun(deps, {templateRef, projectId | dir, params, clarify?: "skip", pool?, by, via}): {flowRunId, groupId}` —
  runs `checkTemplate` (errors ⇒ `flow-template-invalid`), derives params, runs each `requires.commands[].check`
  (failure ⇒ refused naming the command), resolves roles (§12.3: project → global → template `suggest` → today's
  default selection, filtered by `tier`/`distinctFrom`; none ⇒ `role-unresolved:<role>`; resolution + source stored),
  stores the expanded template bytes once in `artifacts` and its sha256 on `flow_runs`, imports the folder (Task 6
  interface, wired in Task 10), opens the parent group confirmed once by `orca-auto` with the pool (§6.3).
- `advanceFlowRuns(deps, now): Promise<void>` — for each non-terminal run: evaluate `when`, start ready steps in
  template order (`parallelWith` concurrency), consume messages at step boundaries, never kill a running step.
- `buildStepPrompt(ctx): string` — role prefix → template prompt (fragments expanded once) → code-generated pointers to
  earlier active outputs → acceptance → unattended fragment (constant `UNATTENDED_FRAGMENT`, templates cannot remove).
- `reportedFlowOf(result): {kind:"absent"} | {kind:"object", value: {needs?, candidates?, effect?}} | {kind:"malformed"}`
  with `needs = {kind:"confirmation", what, payloadSummary} | {kind:"input", question, candidates[]}`,
  `candidates.<name> = {items: string[≤3], recommended: int}`, `effect = {remoteId, url?}`.
- `ClarifyHost = {groupId, stepKey, execSeq, background(), context(), sections(), onConsensus()}`;
  `requirementHost(group)`, `flowClarifyHost(run, step, execSeq)`.
- `check` kind runs the command in the composition's temp worktree with `{{base:<path>}}` materialised read-only;
  record `{exitCode, output (bounded 64 KiB, cut recorded)}`.
- `review` kind: isolated single call, verdict schema `{verdict: "pass"|"revise"|"fail", findings[]}`; `revise` queues an
  `orca-auto` feedback on `reviews: <stepId>` up to `maxRounds`, then proceeds flagged.

- [ ] **Step 1: Failing tests:** C8 (flow clarify rounds under `(group, stepKey, execSeq)`, consensus completes the step
  with the document record, requirement host's `onConsensus` not called); C9 (`zeroRound` only small+clear under
  `mode: auto`, records one minor decision; else invalid ⇒ retry path); C22 (`flow.needs` parks only its step and later
  ones, opens an `ask`, the answer queues a revision with it in the prompt; an unclassed step's confirmation request
  surfaces as an ask); registry duplicate throws; `startFlowRun` with an unresolvable `distinctFrom` pair ⇒
  `role-unresolved:reviewer`; a failing `requires.commands` check refuses start; `draft` invalid output ⇒ existing retry path; `check` gate fail ⇒
  execution `failed`, diagnostic output in the next prompt; `review` runs only after gates pass; C7 golden unchanged.
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations:** C8 store flow rounds under `('clarify', 1)`; C8 call the requirement host's `onConsensus`; C9 accept
  `zeroRound` for medium / without `mode: auto` / skip the minor decision; C22 treat `needs` as success; drop the
  unattended fragment from `review` prompts — each red.
- [ ] **Commit** `feat(flow): kernel, kind registry, draft/check/review kinds and the clarify flow host`.

### Task 9: `ask` kind and `writeTo` (§4.4, C16 part)

**Files:** Create `src/flow/kinds/ask.ts`, `src/flow/writeTo.ts`. Test `tests/flow/askWriteTo.test.ts`.

**Interfaces (Produces):** `writeAnswer(vault, workspaceCommit, target: {file, frontmatter} | {file, json},
value, by): Promise<{commit} | {unchanged: true} | {flag: "writeTo-missing"}>` — writes only that field; result is a
person `edit` execution of the ask step. Ask policies `confirm-before` | `review-after`; unattended ⇒ default + minor
decision; candidates from `candidatesFrom: {step, name}` (an earlier step's reported `flow.candidates`) or the
`flow-ask` single call; free text always offered.

- [ ] **Step 1: Failing tests:** chosen title lands in the `title` frontmatter as an `edit` row (`by` = answerer) and
  later steps become candidates; same value ⇒ no commit; missing file/field ⇒ red flag, nothing else touched; Review
  Focus 2: `writeTo.file: ../x.md` ⇒ `writeTo-missing`, no write outside the workspace; `review-after` lets later steps
  run on the default; `confirm-before` parks only itself and later steps.
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations (C16):** write the answer without an `edit` record ⇒ red; parse candidates from the file instead of the
  report ⇒ red.
- [ ] **Commit** `feat(flow): ask steps with deterministic workspace write-back`.

### Task 10: `work` kind — hidden child groups, plan builder, pool, landing to `flow_decisions`, tool rules (§6.2, §6.3, §9.6, C14 C15 C16 C17)

**Files:**
- Create: `src/control/flowStepPlan.ts` (`buildFlowStepPlanSource`), `src/flow/kinds/work.ts`, `src/flow/pool.ts`,
  `src/flow/toolRulesMap.ts`
- Modify: `src/control/executionDriver.ts:211` (`groupRepoId` reads the `flow` block; `dir` ⇒ vault path),
  `src/control/driverLanding.ts:98-111,262-263` (`dir` groups write `flow_decisions` in the landing transaction, no
  `.decisions/` file; recovery probe reads `flow_decisions`), the integration pass entry (dir groups never integrate;
  `set-group-integration` refused `flow-group-delivery-fixed`), `ensureWorkBranch` caller (start point = `baseCommit`,
  `src/control/workspace.ts:64`), group summary/kanban query (children hidden), `maxRunningGroups` count (parent only)
- Test: `tests/flow/vaultDriverProbe.test.ts` (complete C14), `tests/flow/runBudget.test.ts`,
  `tests/flow/effectStepExecution.test.ts`, `tests/flow/stepToolRules.test.ts`, `tests/flow/restartMidExecution.test.ts`

**Interfaces:**
- Consumes: Task 1 `ToolRules`, Task 6 `compose`/`advanceHead`/`copyBack`, Task 8 kernel.
- Produces:
  - `buildFlowStepPlanSource({run, step, seq, baseCommit, promptEnvelope, gates, toolRules?, effectRecordId?})` — one
    task `step`, labels `[]`, no `dependsOn`, `repoPath` = vault, `targetPaths: ["**"]`, checks = gates else the
    default gate (attempt changed ≥ 1 path; re-measure how ccloop expresses it), effect steps `maxAttempts: 1`, no
    default gate, the no-op gate `true` if the template has none (§22, confirm against ccloop
    `src/contract/schema.ts:39,65` at the new pin), `executionPolicy.toolRules` only when the step has `tools`.
  - `stepToolsToToolRules(tools): ToolRules` — `{exact}`→`{kind:"exact"}`, `{prefix}`→`{kind:"prefix"}`, `secrets`→
    `secretEnv`, fills `network:false`, `commands:[]`, `secretEnv:[]` (ccloop §9).
  - child id `flow-<flowRunId>-<stepKey>-<seq>` (idempotent open), parent/child `flow` body blocks of §6.2.
  - per-step skills (§12.2 phase 1): one inject per execution of exactly the step's `skills` through today's inject
    path; the lock's `resolved_commit` vs the template `ref` mismatch ⇒ a run-page warning (not a refusal);
    `definitionHash` uses the actual `content_md5`.
  - `drawAllocation(run, stepBudget?) / returnUnspent(run, child)`; exhausted ⇒ only that run parks
    (`flow-pool-exhausted` needs-you item); single calls draw from the same pool.

- [ ] **Step 1: Failing tests:** C14 as written (incl. person's folder being a git repo with `.git` byte-equal; no
  `.decisions/` commit; child never integrates); C15; C16 effect part (derived contract `maxAttempts: 1`, no default
  changed-path gate, no retry/continuation/loop, prompt carries `--confirmed-by-orca '<recordId>'`, failed effect not
  retried until a person retries); C17 (step `tools` reach `toolRules` exactly; a step without `tools` gives a contract
  **byte-equal** to the same plan built without the field; the collected report's statuses are stored per execution);
  Review Focus 3 (restart the kernel while a child is `running` ⇒ same child id, one dispatch total).
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations:** C14 resolve the person's folder as target / add the task to the parent / commit `.decisions/` for a
  dir group / skip copy-back / let a dir group integrate; C15 park every group / call the estimator / confirm a child
  without drawing; C16 allow an automatic retry / omit the id; C17 drop a rule / widen a refused rule — each red.
- [ ] **Commit** `feat(flow): work steps as hidden child groups on the vault, run budget pool, tool rules`.

### Task 11: Messages, rerun execution, rewind, unattended skips (package 6, §7.4–§8, C11 C12)

**Files:** Create `src/flow/messages.ts`, `src/flow/rerun.ts`, `src/flow/rewind.ts`, `src/flow/triage.ts`. Test
`tests/flow/rewind.test.ts`, `tests/flow/unattendedSkips.test.ts`, `tests/flow/messages.test.ts`.

**Interfaces (Produces):** `acceptMessage(store, run, msg: {kind: "feedback"|"edit"|"command", target, body, by, via,
requestId}): {state: "accepted"|"rejected", reason?}` (rejections recorded); commands `pause`, `resume`, `stop`,
`retry`, `rewind {toStep, toSeq?, exclude?}`, `repin {version}`, `budget`; `proposePlan(run)` (one `rerun-proposal`
call, validated by Task 7), `runPlan(run, planNo, {skip, add})`; `triageFeedback(run, text)` (single call over
`hints.owns`, result shown and changeable); `flows.rerunReview: "auto" | "review"` honoured.

- [ ] **Step 1: Failing tests:** C11 as written; C12 as written; a message never interrupts a running step (consumed at
  the boundary); duplicate `requestId` ⇒ one row; a rejected command is stored `rejected` with its reason; `repin`
  makes `definition-changed` steps candidates.
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations:** C11 drop later messages on rewind / re-apply an excluded one; C12 write no decision / take a
  non-candidate skip; consume a message mid-step — each red.
- [ ] **Commit** `feat(flow): message stream, rerun plans, rewind keeping later messages`.

### Task 12: Effects and settings (package 7, §9, §11.2, C13 C18)

**Files:** Create `src/flow/effects.ts`, `src/flow/settings.ts`. Modify `src/control/workspaceSettings.ts:28-38`
(optional `flows` on the repository body), `src/control/orchestration.ts:74-88` (optional `flows` on the global body,
`locks` only here), the command handlers for `set-flow-settings` / `set-flow-locks` (S1 §4.4 shape; re-measure S1's
`set-check-settings` handler and copy its pattern). Test `tests/flow/policyResolution.test.ts`,
`tests/flow/policyRead.test.ts`, `tests/flow/effectLevels.test.ts`.

**Interfaces (Produces):** `resolveLevel(cls, step, project, global): {value, source: "project"|"global"|"template"|"builtin",
lockedBy: "global"|null}` (pure; `follow-template` ⇒ `recommendedLevel` ⇒ class default; `irreversible` never
`apply-flag` via template; locks clamp `apply-flag` < `confirm` < `stage-only`); `readFlowSettings(scope)` per field
`{value, source, lockedBy}`; effect records `staged` → `confirmed|applied|discarded|failed`; enacting a staged record
whose `ranOn` changed shows the diff and makes a new record.

- [ ] **Step 1: Failing tests:** C18 and C13 as written (C13's CLI enact goes through the control verb now; its CLI path
  is re-run in Task 15 once the registry row exists).
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations:** swap the precedence; drop the clamp; accept a project lock; omit `source`; `confirm` parks the whole
  run; `stage-only` runs the step — each red.
- [ ] **Commit** `feat(flow): effect classes and levels with project > global settings and locks`.

### Task 13: md2publish-skills — `--confirmed-by-orca` and script files (other repo, §16.4, ruling (A))

**Repo:** `/Users/biran/code/skills/writing/md2publish-skills` (the human's; **its** `CLAUDE.md` governs: Chinese docs
content, English commit messages and identifiers, Rule 12 fail loud; no CI, `scripts/check.sh` is the check). Commit
locally on its `main` (linear history there), **never push**; push goes to `awaitingHuman`. Orca's rules do not apply
inside it (Rule 16). Re-measure every line below at its HEAD (`a2b9dc8` at writing).

**Files:**
- `skills/md2publish-draft/SKILL.md` (`:11` and step 3 `:64` confirm; `:48` inline python), `skills/md2publish-visuals/SKILL.md`
  (spend confirm `:187,196`; inline python `:123,192,214,244,269,290,318`), `skills/md2publish-article/SKILL.md`
  (overwrite question `:86`), `skills/md2publish-cover/SKILL.md` (retry-spend `:175`, re-run guard `artifacts.py guard`
  `~:140`, inline python `:130,149,164-166,191`), `skills/md2publish-diagram/SKILL.md` (inline python `:67,68,116`)
- Create `skills/_shared/scripts/query.py` (subcommands below) and its test `skills/_shared/scripts/test-query.sh`;
  add `scripts/query.py` to every entry of `scripts/shared-manifest.sh`; add the test to `scripts/check.sh`; run
  `scripts/sync-shared.sh` to regenerate `skills/*/shared/`.
- md2publish-draft is not a shared skill: its one helper goes to `skills/md2publish-draft/scripts/cover_path.py` (that
  skill has a `scripts/` dir — re-measure; else create it).

**Content:**
- **Switch:** each of draft / visuals / article / cover documents: "If invoked with `--confirmed-by-orca <id>`, the
  confirmation in step N is already given by Orca; do not ask; print `confirmed-by-orca: <id>` in the summary." Draft:
  skips the step-3 confirm before `upload_image`/`create_draft`. Visuals: skips the spend confirmation. Article: an
  existing `<name>.html` is overwritten without asking. Cover: the retry-spend question and an existing-cover guard hit
  are treated as confirmed (pass `--force` to `artifacts.py guard` only under the switch — **plan writer's call**, the
  re-run case of the same retry-spend question; flagged to the human). Without the switch, byte-for-byte today's text.
- **`query.py`** (exact/prefix-expressible, no parentheses or `*` in the invocation): `slot --platform P --archetype A
  --field aspect|max_bytes [--first]`; `cost --provider P --model M` (prints `None` as `None`); `limits` (prints
  `max_images_per_run`); `json --key K` (stdin) / `json --file F --key K` / `json --arg JSON --results-id NN --keys
  provider,model`. Each inline `python3 -c "…"` above is replaced by one `python3 shared/scripts/query.py …` line with
  the same output bytes. `python3 -c 'import yaml'` dependency checks stay (no parentheses; not run by flows).

- [ ] **Step 1: Failing test** `test-query.sh`: for each replaced line, the old inline command and the new
  `query.py` command give byte-equal stdout on the repo's fixtures (wechat/xiaohongshu/bilibili platforms; a batch JSON
  fixture); a check that no `SKILL.md` contains `python3 -c "` except the `import yaml` lines
  (`grep -c` written to a file and read back); a check that each of the four SKILL.md files mentions
  `--confirmed-by-orca` exactly where listed.
- [ ] **Step 2:** `bash skills/_shared/scripts/test-query.sh > $LOGS/t13-red.log 2>&1` → non-zero.
- [ ] **Step 3:** implement; `bash scripts/sync-shared.sh`.
- [ ] **Step 4:** `bash scripts/check.sh > $LOGS/t13-check.log 2>&1` → exit 0; copy its "跳过" list verbatim (skipped ≠
  passed); `bash scripts/check-shared-drift.sh` exit 0.
- [ ] **Mutation:** change one `query.py` output (e.g. drop `--first` handling) ⇒ `test-query.sh` red (in a
  `git clone --local` copy of that repo).
- [ ] **Commit** (English) `feat(skills): --confirmed-by-orca switch and script files instead of inline python -c`;
  record the full SHA in the Orca ledger and `awaitingHuman: push blrbiran/md2publish-skills main`.

**Pin consequence:** phase 1 does not fetch by pin (§12.2: inject by name through today's path, compare the lock's
`resolved_commit` with `ref`, warn on mismatch). The syncskill source `md2publish-skills` is local
(`/Users/biran/code/skills/writing/md2publish-skills`), so the built-in can pin this **local, unpushed** SHA now; until
the human pushes, any other machine shows the mismatch warning. No fallback mechanism is needed in phase 1.

### Task 14: Built-in `wechat-article`, C6 e2e, C21 whole-run Rule 17 (package 8, §15)

**Files:**
- Create `flows/builtin/wechat-article/flow.yaml`, `prompts/{brief,outline,draft,deslop,voice,finetune,visuals,article,cover,to-draft-box}.md`,
  `fragments/` as needed. Pins: runskills full SHA of `e62c5f8` (re-measure `git -C /Users/biran/code/skills/skills/runskills rev-parse HEAD`),
  md2publish-skills = Task 13's SHA.
- Modify `scripts/test-affected.mjs` `TEXT_READERS` (+ `["flows/", "tests/flow/"]`) so a template-only change selects
  the flow tests; rewrite `tests/scripts/testAffected.test.ts` if it pins the table (ledger).
- Built-in seeding into `flow_templates` by upsert-by-id at panel start.
- Test `tests/flow/wechatBuiltin.test.ts` (template passes `checkTemplate` with zero errors; every step of §15 present with
  its kind, skills, effect, `when`, gates and `tools`; no bare interpreter prefix; md2publish steps use `query.py`
  prefixes only), `tests/flow/wechatFlowE2E.test.ts` (C6), `tests/flow/outOfRepoWrites.test.ts` (C21).

- [ ] **Step 1: Failing tests:** C6 as written on fake agents (incl. the ask pause → resume, model-proposed skip of
  `cover`, person unticks `pick-title`, stub draft stores `remoteId`); C21 (whole run, `HOME` = temp A, every `ORCA_*`
  redirect = temp B; nothing exists under A afterwards); built-in shape test.
- [ ] **Step 2:** red → write template and prompts (prompts follow each skill's own SKILL.md; the human reviews them as
  a diff in Task 18's report) → `npm test` green.
- [ ] **Mutations:** C6 skipped step re-executes / ask blocks the parallel `cover` / `remoteId` not stored; C21 default a
  path from `os.homedir()` at a call site — each red.
- [ ] **Commit** `feat(flow): built-in wechat-article template`.

### Task 15: Commands — control verbs, access rows, registry rows (package 10, §14.2, C19)

**Files:** Modify `src/control/webProtocol.ts` (verbs `flow-start`, `flow-message`, `flow-plan`, `flow-rerun`,
`flow-answer`, `flow-effect`, `flow-pool`, `set-flow-settings`, `set-flow-locks`; read routes `flows`, `flows/:id`,
`flows/:id/journal`, `flows/settings`), `src/panel/controlApi.ts` routes, `src/panel/humanOnly.ts` (`VERB_ACCESS` per
§14.2; `HUMAN_ONLY_FIELDS["flow-start"] = ["pool"]`; `SOCKET_TIER` rows = `token` for the six), the CLI v2 registry
(`src/commands/registry.ts`, re-measure) rows for every §14.2 phase-1 command, then `npm run gen:cli-docs`. Test
`tests/control/flowVerbAccess.test.ts`; the CLI v2 drift and verb-coverage tests must pass unchanged in code.

- [ ] **Step 1: Failing tests (C19):** every §14.2 verb's `VERB_ACCESS` equals the table; the six human-only verbs
  refused for a socket agent without token, accepted with token, refused with the dispatched-run marker; a scripted
  agent walk using only `any` verbs via `main([...]) --json` (`flow start --dir`, `flow show`, `flow feedback`,
  `flow plan`) drives C6's path up to the first human-only act; `flow effect enact` via CLI with token completes C13's
  CLI half.
- [ ] **Step 2:** red → implement → `npm run gen:cli-docs` → `npm test` green.
- [ ] **Mutations:** move `flow-effect` to `any` ⇒ red; drop a `VERB_ACCESS` entry ⇒ red; drop a registry row ⇒
  verb-coverage red.
- [ ] **Commit** `feat(cli): orca flow commands, flow verbs and their access rows`.

### Task 16: Web — run page, flow settings, kanban badge (package 9, §14.1)

**Files:** `web/src/` new `FlowRunPage.tsx`, `FlowSettings.tsx`, kanban card badge in `BoardView.tsx`, i18n en+zh
keys; read `web/DESIGN.md` first. Tests under `web/tests/`.

- [ ] **Step 1: Failing tests:** run page renders steps in order with state, active execution, reasons, output link,
  red flags (incl. `tool-rule:detected`, `tool-rule:recorded-only` for network, `tool-rule:refused`, `secretEnv`
  `present:false`), child progress, message box per run/step/execution, rerun checklist (proposed skips unticked with
  reasons, "accept as unchanged"), open asks and confirm cards, effect records with enact/discard, provenance per
  policy value, the standing "publishing is your click in the WeChat backend" line; settings show source and lock,
  struck-through "overridden by lock"; parent on kanban with a template badge, children absent.
- [ ] **Step 2:** red → implement → `npm test` green.
- [ ] **Mutations:** render `detected` as `enforced` ⇒ red (C17 display half); show children on the kanban ⇒ red.
- [ ] **Commit** `feat(web): flow run page, flow settings and kanban badge`.

### Task 17: W-COR — repository-only and bare-run corrections (§13, C20)

**Files:** `src/corrections/schema.ts:30-91` (four target shapes; `pendingId` without `runId` invalid; absent fields
omitted from canonical JSON), the debug-input builder (sentence + bounded window), closing (one `decision` row, no
`overturned`), metrics line, ccmem exporter (skip `dir:` by name), `correction record --because` (CLI v2 registry row;
`--run`), Web "Correct…" on the project's corrections page and beside a finished task / step execution. Test
`tests/corrections/coarseTargets.test.ts`, `tests/control/correctionCoarseDebug.test.ts`.

- [ ] **Step 1: Failing tests:** C20 as written with a **stored fixture** of existing correction ids and fix-run ids
  (generated from unchanged code first, committed alone).
- [ ] **Step 2:** red → implement → rewrite the old "exactly one target" assertions (`tests/corrections/target.test.ts`,
  `pendingTarget.test.ts`, re-measure; ledger) → `npm test` green.
- [ ] **Mutations (C20):** keep the old rule; write `overturned`; drop the window bound; serialise absent fields; export
  a `dir:` row — each red.
- [ ] **Commit** `feat(corrections): repository-only and bare-run targets`.

### Task 18: Install, control DB backup, paid acceptance of `wechat-article`

Runs on `main` after Tasks 1–17 are merged `--ff-only`. Zero-cost probes first; each paid act reports only the
tool-given cost (Rule 14); "not available" if the tool gives none.

- [ ] **Step 1: Backup** (before the installed panel first opens schema `N+1`): stop the panel service; create
  `~/.orca/backups/schema<N+1>-cutover-<epoch ms>/` with mode `0700`; copy `~/.orca/control/panel/control.sqlite` and
  `~/.orca/control/accounts.sqlite` (re-measure paths from `~/.orca/projects.json` `controlStateDir`) by opening each
  source as `file:<path>?mode=ro` and `VACUUM INTO` the backup file, then `chmod 0600`; run `PRAGMA integrity_check`
  on both backups (`ok`) and compare row counts per table with the sources; write the measurements and the
  `schemaVersion` seen at backup into the ledger. If S1's step has not yet run on this DB, note "one backup covers
  S1's and the flow step".
- [ ] **Step 2:** `npm run build`; install into the panel service as the handoff's install procedure says (re-measure);
  start; `orca status --json` ok; the DB reports schema `N+1`.
- [ ] **Step 3: Zero-cost preconditions** (each output to a file, read whole):
  - `md2wechat doctor --json`: `wechat.config` must be `pass` (measured `pass` at writing; `api.config` fail is expected
    on the free path). IP whitelist is only known at the first upload.
  - `python3 <md2publish-cover>/shared/scripts/preflight.py --json`: at least one image provider configured, else see
    the stop rule below.
  - syncskill can inject every skill the template names (`tech-writer`, `tech-writer-deslop`, `tech-writer-voice`,
    `wechat-finetune`, `md2publish-article`, `md2publish-cover`, `md2publish-draft`) through today's inject path into a
    temp dir. **Known risk:** the syncskill source `runskills` points at `/Users/biran/code/skills/runskills`, which no
    longer exists (moved to `/Users/biran/code/skills/skills/runskills`). Do **not** edit `~/.syncskill/config.json`
    (the person's data); if inject fails, stop and record `awaitingHuman: fix syncskill source runskills`.
  - the claude installation runs `bypassPermissions` ⇒ `commands-closed` will be `recorded-only` and red on the run
    page by design (ruling: keep it).
- [ ] **Step 4: Stop rule.** A failing inject ⇒ do not start; `awaitingHuman`. No image provider ⇒ set the acceptance
  project's `flows.effects.external = stage-only` first (so `to-draft-box` only stages, never uploads), then run: the
  `cover` step stops at the skill's credential gate (`flow.needs`), recorded; the missing secret is listed by **name
  only** in `awaitingHuman`. The run never reaches an upload without a cover (md2publish-draft requires one).
- [ ] **Step 5: The run.** Folder `/private/tmp/orca-b37f7ce9/wechat-acceptance/` registered as a `dir` project; idea
  "Orca 的流程引擎第一阶段：为什么写文章也需要一个能回放、能改一步重跑一步的流程" (controller may substitute; record it);
  `orca flow start wechat-article --project <id> --param idea=… > $LOGS/t18-start.log 2>&1`. Default settings (all
  classes `apply-flag`; `to-draft-box` therefore uploads and creates the draft — the run ends at the draft box; the
  person publishes in the WeChat backend, H2). Answer `approve-outline` and `pick-title` by their defaults (unattended)
  unless the controller is present.
- [ ] **Step 6: Evidence** (read back whole, into the ledger): run state per step with reasons; each child group's
  outcome and the collected `toolRules` statuses; vault refs (`git -C <vault> for-each-ref refs/orca`); the folder's
  files with modes; the effect record of `to-draft-box` with `remoteId` = WeChat `media_id` (record the id; never the
  AppID/secret); cost per call as tools report it. A `40164 invalid ip` failure ⇒ effect `failed`, red, recorded;
  `awaitingHuman: add the machine's public IP to the WeChat whitelist`; no automatic retry (§9.6).
- [ ] **Step 7: Planner check, no second upload.** `orca flow feedback <run> --step voice --text "<one sentence>"`
  then `orca flow plan <run>` (one paid single call); record candidates, reasons and the proposed skips; **do not run
  the plan** (it would create a second draft).
- [ ] **Step 8:** report to the human (in the round's final report): draft created or where it stopped, the
  `media_id`, the red flags, costs as reported, the built-in's prompts as a diff for review.

### Task 19: As-built record

- [ ] Append a new section **"§25 As built (phase 1)"** to the spec (no edit of earlier text, Rule 13): module paths,
  verb names, refusal spellings, defaults, the two `budget` fields, `step_heads` kept as a table, `SOCKET_TIER` = token
  for the six, `irreversible: apply-flag` still refused, the cover `--force` call, measured anchors with the commit.
- [ ] Commit `docs(spec): flow engine phase 1 as built`.

---

## Criteria files expected to change (ledger each line; all under the round's ruling)

- Schema-version pins: `grep -rln 'schemaVersion' tests` (17 files at `7b585a49`, e.g. `tests/control/store.test.ts`,
  `tests/control/requirementRecords.test.ts`, `tests/control/fixtures/web.ts`).
- `requirement_rounds` signatures / chain caps: `tests/control/requirementRecords.test.ts`,
  `tests/control/requirementClarifyCaps.test.ts`.
- Single-call purposes: `tests/control/singleCallPurpose.test.ts`, `tests/control/usageLedger.test.ts`.
- Correction targets: `tests/corrections/target.test.ts`, `tests/corrections/pendingTarget.test.ts` (re-measure
  `fields.test.ts`, `derive.test.ts`).
- Projects file: `tests/panel/projectsFile.test.ts`, `tests/panel/projectRegistry.test.ts` (only if they pin the entry
  shape).
- Access / CLI: CLI v2's `accessMatrix`, `verbCoverage`, `drift` tests gain rows (generated files regenerate).
- `tests/scripts/testAffected.test.ts` if it pins `TEXT_READERS`.
- Collect/contract strictness assertions touched by Task 1 (re-measure after the repin).

## Out-of-repo writes

- `$ORCA_VAULT_DIR` (default `~/.orca/vault/`) and copy-back into registered `dir` folders (§20) — product writes.
- `~/.orca/backups/schema<N+1>-cutover-<ms>/` (Task 18, one backup, `0700`/`0600`).
- md2publish-skills repo: local commit only (Task 13); push is the human's.
- ccloop: plain `git push origin main` before the repin (this session's ruling, ccloop only).
- The acceptance folder `/private/tmp/orca-b37f7ce9/wechat-acceptance/`; WeChat: one draft and its uploaded images in
  the account's media library (Task 18).
