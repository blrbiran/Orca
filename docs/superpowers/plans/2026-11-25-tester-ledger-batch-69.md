# Tester ledger, batch 69 (2026-11-25) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four batches the person picked from the tester ledger (`orca_archived_files/issue-20261023.md`): syncskill data loss (#484, #486, #480), syncskill integrity (#489, #490, #481, #488, #487, #491), five Orca small fixes (#483, #505, #499, #500, #503, #504), and ccmem (#496, #492). Then run the #478 paid acceptance.

**Architecture:** Nothing new is designed here. Every task is a defect fix in existing code, each with one test that must be seen red first. Where a rule (how a flag maps to a dry run, which outbox kinds carry `delivered`) already exists in the tree, the task points the code at that rule instead of adding a second copy. The one deletion-shaped change (#505) widens a reclaim pass, so its test work starts with a HOLDERS row that currently pins the bug as correct behaviour.

**Tech Stack:** TypeScript (Orca, syncskill), Node ESM (ccmem), vitest (Orca), `node --test` (ccmem), the repo's own `vitest` (syncskill).

**Spec:** No new spec. The tester ledger entries are the requirements: `orca_archived_files/issue-20261023.md` §"Issue 480" … §"Issue 505". Each task below cites its issue number; the acceptance criterion in that issue is the test.

## Global Constraints

- **Never edit an existing test to make it pass** unless the task says so explicitly (`Ruling:` needed otherwise). Each such task names the exact test line and why the old assertion encoded the defect.
- **ccloop's rules do not carry into these repos and vice versa** (Orca CLAUDE.md Rule 16). Each repo's own suite is the gate for its own changes.
- Every new branch gets a named mutation that deletes *that branch only*, observed red, then restored byte-for-byte (`git diff` + `git diff --cached` byte counts, never by eye — Rule 15).
- Tests that write outside the repo must go through the environment-variable redirect (Orca Rule 17): dirs `0700`, files `0600`, existing files keep their mode.
- `npm test` (changed-part) is the gate for every patch set and every merge into main (Orca Rule 18). `npm run test:full` only if the person asks.
- Never write a live SHA, `HEAD`, or "N ahead" into a handoff (rule in all three handoffs).
- Commit messages end with the attribution line the harness supplies; never invent a model name.

## Review Focus

1. **`--plan` on a write command must never write.** A person types `--plan push` to find out what would happen. Any path where `--plan` reaches the executor is data loss, not a missing feature.
2. **A config key the tool does not understand must survive a write round-trip.** `ssh_defaults` vanishing silently is worse than an error, because the next `push` fails on a port it never saw.
3. **A source the tool cannot read must not authorise deleting the links that pointed into it.** `doctor --fix` is advertised as "repair".
4. **"Absent" is not "empty".** No `skills.include` says nothing about the remote; `[]` says it should end up empty. Conflating them deletes every remote skill on a fresh machine.
5. **A "done" group's human views must not contradict each other or invite an action that changes a finished group.**

---

## Part A — syncskill: data loss (#484, #486, #480)

### Task A1: `--plan` on push/pull/sync is a dry run, or the command refuses it

**Files:**
- Modify: `src/index.ts` (root option definition ~1412; global-flag preflight ~1490-1505)
- Test: `tests/integration/cli-compat-flags.test.ts`

**Interfaces:**
- Consumes: `failWithOutputError(code, message, hint)`, `getCommandPath(actionCommand)`, `actionCommand.setOptionValue(key, true)` — all already used in the same preflight block for `--dry-run`.
- Produces: nothing new. `--plan` on `push`/`pull`/`sync` sets `options.dryRun = true`; on any other command that does not declare `--dry-run`, it is refused with `E_USAGE_GLOBAL_FLAG`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/cli-compat-flags.test.ts`, next to the existing `--dry-run` cases:

```ts
it('--plan on push runs as a dry run: no write verb is ever called', async () => {
  const run = await runCli(['--sync-dir', home, '--plan', 'push', 'lab'], fakeRuntime);
  expect(run.code).toBe(0);
  expect(fakeRuntime.calls.filter((c) => WRITE_VERBS.some((v) => c.includes(v)))).toEqual([]);
  // and the plan itself is printed
  expect(run.stdout).toContain('[dry-run] push to lab');
});

it('--plan on a command with no dry run is refused, not silently ignored', async () => {
  const run = await runCli(['--sync-dir', home, '--plan', 'link', 'build'], fakeRuntime);
  expect(run.code).toBe(4);
  expect(run.stderr).toContain('E_USAGE_GLOBAL_FLAG');
});
```

`WRITE_VERBS` is `['rm -rf', 'mkdir -p', 'cat >', 'rsync', 'apply', 'write-manifest']` — define it once at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/cli-compat-flags.test.ts -t '--plan'`
Expected: the first case FAILS with write verbs present in `fakeRuntime.calls`; the second FAILS with exit 0.

- [ ] **Step 3: Implement in `src/index.ts`**

Extend the existing `for (const [value, key, long] of …)` tuple list so `--plan` is handled by the same rule as `--dry-run`:

```ts
const planFlag = thisCommand.opts<{ plan?: boolean }>().plan;
...
for (const [value, key, long] of [
  [globalFlags.dryRun, 'dryRun', '--dry-run'],
  [(globalFlags as { plan?: boolean }).plan, 'dryRun', '--plan'],   // #484: --plan is the same read-only path
  [globalFlags.yes, 'yes', '--yes'],
  [globalFlags.force, 'force', '--force']
] as const) { ... }
```

and add `'--plan'` to the `--quiet` refusal's company: a command that declares neither `--dry-run` nor `--plan` gets `E_USAGE_GLOBAL_FLAG` for `--plan` by the same `actionCommand.options.some(...)` test. Do **not** add a second code path for plan mode; #481's lesson is that a parallel human/machine path drifts.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/integration/cli-compat-flags.test.ts`
Expected: all pass.

- [ ] **Step 5: Mutation** — delete only the `[plan, 'dryRun', '--plan']` tuple. The first case must go red. Restore; confirm `git diff` byte count is 0.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/integration/cli-compat-flags.test.ts
git commit -m "fix(cli): --plan is a dry run on push/pull/sync, refused where there is none (tester #484)"
```

### Task A2: a local source written as an absolute `path` with no `url` is readable

**Files:**
- Modify: `src/source.ts` (`normalizeSourceEntry` ~1463-1483; `getLocalMaterializedRoot` ~1844-1858)
- Test: `tests/unit/source.test.ts`

**Interfaces:**
- Consumes: `resolveHomePath(p)` (already in `source.ts`), `isAbsolute`.
- Produces: `normalizeSourceEntry` accepts `{type:'local', path:'/abs/root'}` and yields `{name, type:'local', url:'/abs/root', path:'.'}`; `getLocalMaterializedRoot` accepts an absolute `path` by flooring the path to `.` and using it as the root. Every other type's shape is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
it('a local source with an absolute path and no url is discovered (#486)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'src-abs-'));
  await mkdir(join(root, 'alpha'), { recursive: true });
  await writeFile(join(root, 'alpha', 'SKILL.md'), '# alpha\n');
  const names = await discoverActiveSourceSkillNames(root /* home */, {
    mine: { type: 'local', path: join(root, 'alpha-root') }
  });
  // the shape syncskills writes: absolute path, no url
  expect([...names]).toContain('alpha');
});

it('a local source with an absolute path is not rejected as relative-only', () => {
  expect(() => getLocalMaterializedRoot({ name: 'x', type: 'local', url: '/tmp/x', path: '/tmp/x' } as never)).not.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/source.test.ts -t 'absolute path'`
Expected: both FAIL — discovery returns an empty set; `getLocalMaterializedRoot` throws `Local source path must be a relative path`.

- [ ] **Step 3: Implement**

In `normalizeSourceEntry`, before the existing `url`-required check, add the legacy shape:

```ts
// Tester #486: syncskills writes a local source as {type:'local', path:'/abs'}; url is not part of that shape.
const legacyAbs = value.type === 'local' && typeof value.url !== 'string' && typeof pathValue === 'string' && isAbsolute(pathValue);
const url = legacyAbs ? pathValue : value.url;
if (typeof url !== 'string' || typeof pathValue !== 'string') return [];
...
return [{ name, type: value.type, url, path: legacyAbs ? '.' : pathValue }];
```

In `getLocalMaterializedRoot`, change the absolute-path throw into a floor:

```ts
// Tester #486: an absolute path is the root itself; treat it as '.' under that root.
const rootPath = isAbsolute(source.path) ? source.path : resolveHomePath(source.url);
const relativePath = isAbsolute(source.path) ? '.' : resolve(resolveHomePath(source.url), source.path);
```

— then derive the root from `rootPath`, keeping the existing `..`-escape refusal for relative paths.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/unit/source.test.ts`
Expected: pass.

- [ ] **Step 5: Mutation** — revert only `legacyAbs` to always-false. Both cases go red. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/source.ts tests/unit/source.test.ts
git commit -m "fix(sources): read a local source written as an absolute path (tester #486)"
```

### Task A3: `doctor` never deletes a link whose skill lives in a source it could not read

**Files:**
- Modify: `src/config/config-doctor.ts` (`discoverExistingSkills` ~40-56; `diagnoseConfig` ~354-395; `repairConfig` ~388-420)
- Modify: `src/source.ts` (add a `discoverUnreadableSources` companion that reports names instead of swallowing)
- Test: `tests/unit/config-doctor.test.ts`

**Interfaces:**
- Consumes: `normalizeSourceEntry`, `getMaterializedRootPath`, `pathExists` (all in `source.ts`).
- Produces: `discoverActiveSourceSkillNamesWithFailures(homeDir, sources): Promise<{ names: Set<string>; unreadable: string[] }>`; `DiagnosticReport` gains an optional `unreadableSources: string[]`.

- [ ] **Step 1: Write the failing test**

```ts
it('--fix keeps a link whose source could not be read (#486)', async () => {
  // config: one local source with no url and a relative-only path (unreadable), one link pointing at its skill
  const cfg = { version: 1, conflict_resolution: 'manual', agents: { claude: '~/.claude/skills' },
    links: { 'src-skill': ['claude'] }, profiles: {}, servers: {}, sources: { bad: { type: 'local', path: 'nope' } } } as never;
  const report = await diagnoseConfig(cfg, join(home, 'skills'), home);
  expect(report.unreadableSources).toContain('bad');
  const repaired = repairConfig(cfg, report, { removeInvalidSkillLinks: true, removeInvalidAgentLinks: true, removeInvalidAgents: true });
  expect(repaired.links['src-skill']).toEqual(['claude']); // NOT deleted
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/config-doctor.test.ts -t 'could not be read'`
Expected: FAIL — `links['src-skill']` is undefined (deleted).

- [ ] **Step 3: Implement**

- Add the `…WithFailures` discovery function; have `discoverActiveSourceSkillNames` call it and return `.names` (no behaviour change for callers).
- In `diagnoseConfig`, put `unreadable` on the report.
- In `repairConfig`, before the loop, compute `const blocked = new Set(report.unreadableSources ?? [])` and skip the `SKILL_NOT_FOUND` deletion when the skill is not found *locally* **and** `blocked.size > 0` — the honest rule is: while any source is unreadable, a "skill not found" is not a fact. Also push a warning `SOURCE_UNREADABLE` for each blocked source.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/unit/config-doctor.test.ts`
Expected: pass, and the existing exact-object assertions still pass (the new report key is optional).

- [ ] **Step 5: Mutation** — remove the `blocked.size > 0` guard. The new case goes red. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/config/config-doctor.ts src/source.ts tests/unit/config-doctor.test.ts
git commit -m "fix(doctor): an unreadable source blocks the link deletion its skills would have authorised (tester #486)"
```

### Task A4: no `skills.include` and no links means "carry nothing", not "delete everything"

**Files:**
- Modify: `src/core/sync_engine.ts` (`orphansForCleanup` ~1229; `includeStateOf` ~1255; the warning list at the `unset` branch of `pushToServer` ~508)
- Test: `tests/integration/sync-engine.test.ts`

**Interfaces:**
- Produces: `includeState.unset` yields no orphans and one `PushWarning { code: 'no-skills-configured', detail: 'skills.include is not set and no links are configured; nothing is carried and nothing is removed' }`. Existing `list` behaviour unchanged.

- [ ] **Step 1: Write the failing test**

```ts
it('with no skills.include and no links, push removes nothing (#480)', async () => {
  const runtime = fakeRuntime({ ls: 'alpha\nbeta\n', manifest: manifestWith(['alpha', 'beta']) });
  const config = { ...baseConfig, links: {}, servers: { lab: { host: 'lab.example' } } };
  const result = await pushToServer(home, 'lab', { dryRun: true, runtime }, config);
  expect(result.deleted).toEqual([]);
  expect(result.warnings.map((w) => w.code)).toContain('no-skills-configured');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/sync-engine.test.ts -t '#480'`
Expected: FAIL — `deleted` is `['alpha','beta']`.

- [ ] **Step 3: Implement**

In `orphansForCleanup`, change the first line to cover `unset` as well:

```ts
if (includeState.kind === 'empty' || includeState.kind === 'unset') return [];
```

and in `pushToServer`, give `unset` the same one-line warning `empty` has, with the wording above. Keep `pushSet = null` (it still means "no subset limit"); the deletion guard is the thing that changes, because `[]` and absent are different statements (Review Focus 4).

- [ ] **Step 4: Run**

Run: `npx vitest run tests/integration/sync-engine.test.ts`
Expected: pass. Some existing fixtures use `links: {}` with no include and assert orphan deletion — those assertions encode the defect; change them to set an explicit `include` list and add a `Ruling:` comment naming #480.

- [ ] **Step 5: Mutation** — delete the `|| includeState.kind === 'unset'`. New case red. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/core/sync_engine.ts tests/integration/sync-engine.test.ts
git commit -m "fix(push): an unset include list authorises no remote deletion (tester #480)"
```

---

## Part B — syncskill: integrity (#489, #490, #481, #488, #487, #491)

### Task B1: local config and manifests are written atomically, and a corrupt config says so

**Files:**
- Modify: `src/config/config.ts` (`saveConfig` ~154; `loadConfig` ~128)
- Modify: `src/core/manifest.ts` (`saveServerManifest` ~109)
- Test: `tests/unit/config.test.ts`, `tests/unit/manifest.test.ts`

**Interfaces:**
- Produces: `writeJsonAtomic(path, text)` in `src/utils/utils.ts` (tmp + `fsync` + `rename`, keeping a `.bak` of the previous file); `loadConfig` throws `Error('E_CONFIG_CORRUPT: <path> is not valid JSON; the previous copy is at <path>.bak. Do not run `init`: it would overwrite it.')`.

- [ ] **Step 1: Write the failing tests**

```ts
it('saveConfig leaves the previous file intact when the write fails', async () => {
  await saveConfig(cfg1, home);
  await expect(saveConfigFailingMidWrite(cfg2, home)).rejects.toThrow();
  expect(JSON.parse(await readFile(cfgPath, 'utf8'))).toEqual(cfg1);   // still the old one
  expect(existsSync(`${cfgPath}.bak`)).toBe(true);
});
it('a truncated config.json is reported as corrupt, not as missing', async () => {
  await writeFile(cfgPath, '{"version":1,"agents":', 'utf8');
  await expect(loadConfig(home)).rejects.toThrow(/E_CONFIG_CORRUPT/);
  await expect(loadConfig(home)).rejects.not.toThrow(/Config not found/);   // the misleading line
});
```

- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run tests/unit/config.test.ts tests/unit/manifest.test.ts -t 'atomic|corrupt'`. Expected: both red (file truncated in place; message says "Config not found").

- [ ] **Step 3: Implement** — `writeJsonAtomic` takes `path, text`; writes `path.tmp-<uuid>`, `fsync`s, copies the existing file to `.bak` if present, then `rename`s. `saveConfig` and `saveServerManifest` call it. In `loadConfig`, distinguish `SyntaxError` from `ENOENT` in the first `catch`: on `SyntaxError` throw the `E_CONFIG_CORRUPT` error immediately rather than falling through to yaml.

- [ ] **Step 4: Run** — expect pass.

- [ ] **Step 5: Mutation** — replace `writeJsonAtomic`'s body with a plain `writeFile`. The atomicity case goes red; the corrupt case stays green (independent). Restore.

- [ ] **Step 6: Commit** — `fix(config): write the local config and manifests atomically, and name a corrupt one (tester #489)`

### Task B2: a config round-trip keeps every key the tool does not know

**Files:**
- Modify: `src/config/config.ts` (`validateConfig` ~111-125)
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `validateConfig` returns `{...unknownTopLevelKeys, ...normalized}`; the nine known keys are normalised exactly as before, every other top-level key is passed through untouched.

- [ ] **Step 1: Write the failing test**

```ts
it('a write round-trip keeps ssh_defaults and an unknown future key (#490)', async () => {
  await writeFile(cfgPath, JSON.stringify({ ...baseCfg, ssh_defaults: { port: 2200 }, future_key: { a: 1 } }));
  const cfg = await loadConfig(home);
  await saveConfig(cfg, home);
  const after = JSON.parse(await readFile(cfgPath, 'utf8'));
  expect(after.ssh_defaults).toEqual({ port: 2200 });
  expect(after.future_key).toEqual({ a: 1 });
});
```

- [ ] **Step 2: Run it to verify it fails** — Expected: FAIL, `after.ssh_defaults` undefined.

- [ ] **Step 3: Implement** — start `validateConfig`'s return with `const passthrough = { ...(value as Record<string, unknown>) }` and `delete` the nine known keys, then `return { ...passthrough, version, conflict_resolution, agents, links, profiles, servers, sources, private_agents, ...(pull_backup) }`.

- [ ] **Step 4: Run** — pass; the existing exact-object assertions in `config.test.ts` need the extra keys added where the input carried them.

- [ ] **Step 5: Mutation** — drop the `passthrough` spread. New case red. Restore.

- [ ] **Step 6: Commit** — `fix(config): a write keeps the keys the tool does not model (tester #490)`

### Task B3: `--json` stdout on push/pull/sync is exactly one JSON line

**Files:**
- Modify: `src/core/sync_engine.ts` (all `console.log`/`console.warn` in the push/pull paths: ~539, 567, 603, 629-631, 652, 654, 687, 722-772, 1032)
- Modify: `src/index.ts` (`pull`/`sync` actions: pass `json` through ~3365-3420)
- Test: `tests/integration/push-result-surfaces.test.ts`, `tests/integration/read-only-commands.test.ts`

**Interfaces:**
- Produces: `SyncEngineOptions.json?: boolean`. Every human line in the engine is emitted only when `json !== true`; structured information already goes into `PushResult.warnings` and `summary.data`.

- [ ] **Step 1: Write the failing test**

```ts
it('--json push writes exactly one parseable JSON line, even with warnings (#481)', async () => {
  const run = await runCli(['--sync-dir', home, 'push', 'lab', '--dry-run', '--json'], fakeRuntime);
  const lines = run.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(() => JSON.parse(lines[0]!)).not.toThrow();
});
it('--json pull writes exactly one line', async () => { /* same shape, pull */ });
```

- [ ] **Step 2: Run** — Expected: FAIL, 11 lines.

- [ ] **Step 3: Implement** — thread `json` into `SyncEngineOptions` from all three actions; guard every human `console.*` in the engine with `if (options.json !== true)`. **Do not** add a console-silencing wrapper: #481's contrast case (`syncskills`) uses one, but here the lines are few enough to gate and a wrapper hides future additions. Any information a line carries that a machine needs belongs in `warnings`, not in the log.

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — remove the gate on the "Remote skills to remove" block only. The case goes red (2 lines). Restore.

- [ ] **Step 6: Commit** — `fix(json): push, pull and sync print one JSON line under --json (tester #481)`

### Task B4: `--sync-dir` also moves the home boundary

**Files:**
- Modify: `src/index.ts` (`resolvedHomeDir` ~1403)
- Modify: `src/linker.ts` (`discoverSkills` / `migrateSkillsFromAgentDirs` ~115-185)
- Test: `tests/integration/sync-dir-cli.test.ts`

**Interfaces:**
- Produces: when `--sync-dir` is set and no explicit `--home`, `resolvedHomeDir` is the sync dir's grandparent (`dirname(dirname(syncDir))`), so `join(homeDir, '.claude/skills')` resolves *inside* the scratch tree. Auto-migration also requires `--migrate-unmanaged` when a sync-dir override is active.

- [ ] **Step 1: Write the failing test**

```ts
it('scan in a scratch sync-dir imports nothing from the real home (#488)', async () => {
  const syncDir = join(scratch, 'home', '.syncskill');
  await initScratch(syncDir);
  const run = await runCli(['--sync-dir', syncDir, 'scan'], { HOME: realHomeWithSkills });
  const cfg = JSON.parse(await readFile(join(syncDir, 'config.json'), 'utf8'));
  expect(Object.keys(cfg.links)).toEqual([]);
  expect(run.stdout).not.toContain('Found new skills in sources');
});
```

- [ ] **Step 2: Run** — Expected: FAIL, `links` has two entries.

- [ ] **Step 3: Implement** — derive the home boundary as above and require the explicit flag for migration. Reword the message to name where the skills actually came from.

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — put `process.env.HOME` back. Red. Restore.

- [ ] **Step 6: Commit** — `fix(cli): --sync-dir moves the agent-directory boundary too, and migration needs an explicit flag (tester #488)`

### Task B5: `doctor` expands `~` before it stats a path

**Files:**
- Modify: `src/config/config-doctor.ts` (`checkAgentPaths` ~180-200, `checkSourcePaths` ~307-331)
- Test: `tests/unit/config-doctor.test.ts`

**Interfaces:**
- Produces: both checks take `homeDir` and resolve through `resolveHomePath` — the same helper `resolveAgentPath` uses, so there is one `~` rule (Review Focus: one rule, not two).

- [ ] **Step 1: Write the failing test**

```ts
it('six ~ agent paths that all exist are healthy (#487)', async () => {
  const report = await diagnoseConfig(cfgWithTildeAgents, skillsDir, home);
  expect(report.errors).toEqual([]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL, `NO_VALID_AGENTS`.

- [ ] **Step 3: Implement** — thread `homeDir` through both functions and call `resolveHomePath(p, homeDir)` before `access`. Add a case where one directory is renamed so only that one reports `AGENT_PATH_INVALID` (the test must distinguish "expanded and missing" from "not expanded").

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — drop the expansion on `checkAgentPaths` only. Red on the agent case, green on the source case (they are independent, which the second case proves). Restore.

- [ ] **Step 6: Commit** — `fix(doctor): expand ~ before checking an agent or source path (tester #487)`

### Task B6: the four read-only commands honour `--json`

**Files:**
- Modify: `src/index.ts` (`doctor` ~3600; `source list` ~2514; `remote list` ~2750; `link list` ~1921)
- Test: extend `tests/integration/doctor-cli.test.ts`, `source-cli.test.ts`, `server-cli.test.ts`, `link-cli.test.ts`

**Interfaces:**
- Produces: each action, when `program.opts().json === true`, emits exactly one `{"type":"result","command":…,"ok":…,"summary":…,"data":…}` line via `getGlobalOutput().result(...)` — the shape `status` already emits at `src/index.ts:3030`.

- [ ] **Step 1: Write the failing tests** — one per command:

```ts
for (const argv of [['doctor'], ['source','list'], ['remote','list'], ['link','list']]) {
  it(`--json ${argv.join(' ')} is one parseable line (#491)`, async () => {
    const run = await runCli(['--sync-dir', home, '--json', ...argv]);
    expect(run.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(run.stdout).type).toBe('result');
  });
}
```

- [ ] **Step 2: Run** — Expected: four reds.

- [ ] **Step 3: Implement** — one `json` branch per action. `doctor`'s payload is `{summary:{errors,warnings,fixed}, data:{errors,warnings,fixed,skipped}}` straight from `DiagnosticReport` (the items are already structured; only `formatDiagnosticReport` flattens them). Copy the shape `status` uses instead of inventing a new one.

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — restore `console.log` in `remote list` only. That one goes red; the other three stay green. Restore.

- [ ] **Step 6: Commit** — `fix(json): doctor, source list, remote list and link list honour --json (tester #491)`

---

## Part C — Orca: five small fixes

### Task C1: the CLI can find a run's checkpoint again (`task continue`)

**Files:**
- Modify: `src/panel/controlViews.ts` (`runViews` return object ~1691)
- Modify: `src/control/webProtocol.ts` (`runViewSchema` ~2196-2360)
- Modify: `src/commands/domains/verbs.ts` (`GroupView["runs"]` type ~92; `checkpointOf` ~685)
- Test: `tests/panel/controlViews.test.ts` (or the existing group-view test file), `tests/commands/write.test.ts`

**Interfaces:**
- Produces: `runViews()` emits `checkpointId: run.checkpointId ?? null`; `runViewSchema` gains `checkpointId: idSchema.nullable()`. `GroupView["runs"][number]["checkpointId"]` becomes required-but-nullable, matching the wire (the local type stops lying). `checkpointOf` keeps its logic but its error text changes when the run does hold a checkpoint that the view did not carry.

- [ ] **Step 1: Write the failing test — against the real projection, not a hand-written fixture**

```ts
it('a real group view carries each run's checkpointId (#483)', () => {
  const view = readGroupView(fixtureStoreWithPartialCheckpoint, 'g1');   // built through runViews, not world.ts
  const run = view.runs.find((r) => r.runId === 'run-1')!;
  expect(run.checkpointId).toBe('cp-1');
  expect(() => runViewSchema.parse(run)).not.toThrow();   // the wire schema accepts it
});
```

- [ ] **Step 2: Run** — Expected: FAIL, `run.checkpointId` undefined (and `checkpointId` is not in the schema's key set).

- [ ] **Step 3: Implement** — add the field to the return object and to the schema. Then delete the hand-written `checkpointId` from `tests/commands/fixtures/world.ts:23` **only if** a test still passes without it; that fixture is what hid the defect (it hand-wrote a field the server never sends — same family as #464). Better: make `world.ts` derive its runs from `runViews` so it cannot drift again; if that is too invasive, add the new test above and leave `world.ts` alone, but say so in the commit body.

- [ ] **Step 4: Run** — both the new test and `tests/commands/write.test.ts` pass.

- [ ] **Step 5: Mutation** — remove `checkpointId` from `runViewSchema` only. The `runViewSchema.parse` assertion goes red. Restore.

- [ ] **Step 6: Commit** — `fix(cli): a group view carries each run's checkpointId, so task continue can find it (tester #483)`

### Task C2: artifact GC reads `delivered` only for the kinds that have a consumer

**Files:**
- Modify: `src/control/artifactReclaim.ts` (`outboxHold` ~519)
- Modify: `tests/control/artifactReclaim.test.ts` (rewrite the HOLDERS row at ~78)
- Test: same file

**Interfaces:**
- Consumes: `OUTBOX_QUEUE_KINDS`, `OUTBOX_RECORD_KINDS` from `outboxKinds.ts`.
- Produces: `outboxHold` returns `outbox-undelivered` only when `kind ∈ OUTBOX_QUEUE_KINDS && delivered !== 1`; a RECORD kind goes straight to owner lookup. An unknown kind throws (never silently "undelivered").

- [ ] **Step 1: Rewrite the HOLDERS row so it pins a QUEUE kind, and add a freeing row**

```ts
// the old row wrote kind:"archive" + delivered=0 and asserted a hold -- that IS the defect (#505)
{ kind: "an undelivered cleanup row", reason: "outbox-undelivered", name: (s, x) => insertOutbox(s, `cleanup:run-old`, "cleanup", { runId: "run-old" }, 0) },
```

and a new case in the "planned" direction:

```ts
it('an undelivered RECORD row owned by a retired run does not hold its artifacts (#505)', () => { ... expect(plan.planned).toContainEqual(expect.objectContaining({ artifactId: x.artifactId })) });
```

- [ ] **Step 2: Run** — Expected: the new case FAILS (held), and the rewritten QUEUE case passes only after Step 3.

- [ ] **Step 3: Implement** — split on kind as in Interfaces; throw on a kind in neither list (a new kind must be classified, not inherit "forever held").

- [ ] **Step 4: Run** — the whole file passes, and the other HOLDERS rows are unchanged.

- [ ] **Step 5: Mutation** — revert to "any `delivered !== 1` holds". The new case goes red; the QUEUE case stays green. Restore.

- [ ] **Step 6: Commit** — `fix(gc): only a queue kind's delivered bit holds artifacts (tester #505)`

- [ ] **Step 7: Measure on the real store, read-only** — `orca gc --include-artifacts --older-than 0 --json` and record the before/after counts of `outbox-undelivered` in the commit body. (On this machine the count was 92 before the fix; the test-data store is small, so also note that the tester's 5 GB store is the real target and has not been measured.)

### Task C3: `group set-limit` says which dimension is short and by how much

**Files:**
- Modify: `src/control/tokenPolicy.ts` (`budgetFits` stays; add `budgetShortfall`)
- Modify: `src/control/commands.ts` (`setGroupLimit` ~89) and `src/panel/webService.ts` (`setLimit` ~2680-2705)
- Modify: `src/panel/controlViews.ts` (`card.budget` ~731) + `src/control/webProtocol.ts` (the card schema)
- Test: `tests/control/tokenPolicy.test.ts`, `tests/control/budgetCommands.test.ts`

**Interfaces:**
- Produces: `budgetShortfall(used: Amount, reserved: Amount, ceiling: BudgetAmount): Partial<Record<'tokens'|'activeMs'|'attempts'|'sessions', {have: number|null; need: number}>>`; `ControlError('group-budget-unavailable', undefined, { shortfall })` carries it; `card.budget` gains `usedActiveMs/limitActiveMs/usedAttempts/limitAttempts/usedSessions/limitSessions`.

- [ ] **Step 1: Write the failing tests**

```ts
it('budgetShortfall names only the dimensions that do not fit (#499)', () => {
  const s = budgetShortfall({ tokens: 10, activeMs: 5e7, attempts: 40, sessions: 40 }, { tokens:0, activeMs:0, attempts:0, sessions:0 }, { tokens: 100, activeMs: 144e6, attempts: 60, sessions: 60 });
  expect(Object.keys(s)).toEqual(['attempts']);   // only this one is over
});
it('set-limit 422 names the short dimension', async () => { ... expect(body.error.shortfall.attempts).toBeDefined(); });
```

- [ ] **Step 2: Run** — Expected: red (function absent, bare code).

- [ ] **Step 3: Implement** — the shortfall function; use it at both throw sites; expose it on the card. Keep `budgetFits` as `Object.keys(budgetShortfall(...)).length === 0` so there is still one rule.

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — drop `activeMs` from the shortfall loop. The new case stays green (it tests attempts) but add a second case on `activeMs` first, so it goes red. Restore.

- [ ] **Step 6: Commit** — `fix(control): a limit that does not fit names the dimension and the gap (tester #499)`

### Task C4: `group brief` prints `firstFailure.cause` and its `next` in full

**Files:**
- Modify: `src/commands/domains/reads.ts` (`brief` assembly ~663-690)
- Test: `tests/commands/read.test.ts`

**Interfaces:**
- Produces: the brief gets a dedicated `failure:` block before the raw body: `failure: <cause> — task <id>`, `  next: <command>`, printed from `card.firstFailure` when it is not null. `card` itself stays in the output (someone greps it), but a complete `next` is also on its own line.

- [ ] **Step 1: Write the failing test**

```ts
it('brief prints an actionable next line longer than 160 characters (#500)', async () => {
  const out = await runBrief(groupWithLongNext);
  expect(out).toContain('orca group set-limit sprint-3layer-20261125-1 --limit <a higher limit>');
});
```

- [ ] **Step 2: Run** — Expected: FAIL, the text is truncated at 160.

- [ ] **Step 3: Implement** — an explicit block, not a change to `compact`'s global limit (that limit protects every other caller). Take `cause` and `next` from the same object; if `next` is missing, print the cause alone (never an empty `next:`).

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — delete the `next:` line. Red. Restore.

- [ ] **Step 6: Commit** — `fix(cli): group brief shows a failure's cause and its full next command (tester #500)`

### Task C5: a finished group's brief stops contradicting itself and stops asking

**Files:**
- Modify: `src/panel/controlViews.ts` (`deliveryQuestionView` ~1833) and `src/commands/domains/verbs.ts` (`deliveryQuestionLines` ~447, `keptLines` ~397)
- Modify: `src/control/preexistingFailure.ts` (`answerableGroup` ~67, `preexistingFailureWaiting` ~245)
- Test: `tests/commands/read.test.ts`, `tests/control/preexistingFailure.test.ts`

**Interfaces:**
- Produces: (a) the first-use delivery question is not printed for a group that already delivered (`keptLines` non-empty) — `deliveryQuestionView` returns null then, or the line's prefix becomes `delivery choice:`; (b) a pre-existing-failure row on a `done`/`archived`/`closed` group reports `answerable:false` and a new `onlyRerunUsesIt:true`, and the brief prints "recorded; a review-rerun would use this answer" instead of "waits for your answer".

- [ ] **Step 1: Write the failing tests**

```ts
it('a done keep group prints one delivery conclusion (#503)', async () => {
  const out = await runBrief(doneKeepGroupNoProjectDefault);
  const deliveryLines = out.split('\n').filter((l) => l.startsWith('delivery'));
  expect(deliveryLines).toHaveLength(1);            // exactly one conclusion
  expect(out).not.toContain('not chosen for this project yet');
});
it('a done group does not say a pre-existing failure waits for an answer (#504)', async () => {
  const out = await runBrief(doneGroupWithUnansweredPreexisting);
  expect(out).not.toContain('waits for your answer');
  expect(out).toContain('a review-rerun would use this answer');
});
```

- [ ] **Step 2: Run** — Expected: both red (three delivery lines; "waits" present).

- [ ] **Step 3: Implement** — one conclusion per brief. Prefer (a) `deliveryQuestionView` returns null when the group is `done` and its delivery is chosen by the default — a person who never chose a default is not being asked about a finished group. For (b), a row on a terminal group sets `answerable:false` and `onlyRerunUsesIt:true`; the command stays reachable and is printed with the honest wording.

- [ ] **Step 4: Run** — pass.

- [ ] **Step 5: Mutation** — revert `answerableGroup` to `reviewRequired && !multiDir && !dir`. The second case goes red. Restore. Do the same for the delivery change.

- [ ] **Step 6: Commit** — `fix(cli): a done group's brief gives one delivery conclusion and does not ask for an answer nothing reads (tester #503, #504)`

---

## Part D — ccmem (#496, #492)

### Task D1: a summarize task with no transcript is not a success

**Files:**
- Modify: `scripts/daemon/tasks/summarize-pending.mjs` (~217-222)
- Modify: `scripts/daemon/loop.mjs` (~448-476, add a `skipped` terminal status) or return a sentinel the daemon already understands
- Modify: `scripts/handlers/stop.mjs` (~80-96, do not enqueue without a transcript)
- Modify: `scripts/lib/admin/daemon.mjs` (`describeExtractionHealth` ~1208, add `bad_payload_24h`, `skipped_24h`)
- Test: `tests/integration/summarize-pending.test.mjs`, `tests/unit/daemon-health.test.mjs`

**Interfaces:**
- Produces: `runSummarizePending` returns `{ skipped: 'no-transcript' }`; the daemon writes `status='skipped'` for it (a new, valid terminal value — the migration that adds it to any CHECK constraint is in the same task); `describeExtractionHealth` counts `audit_log.summarize_pending_bad_payload` over 24h and exposes `bad_payload_24h`; `daemon status` shows a warn line whenever `bad_payload_24h > 0`.

- [ ] **Step 1: Write the failing test**

```ts
it('a Stop with no transcript_path does not enqueue a summarize task (#496)', async () => {
  const before = countTasks(db);
  await stopHook({ session_id: 'probe', transcript_path: null });
  expect(countTasks(db)).toBe(before);
});
it('a bad-payload summarize task is not recorded as success (#496)', async () => {
  const id = enqueueSummarize(db, { session_id: 'x', transcript_path: null, last_message_seq: 0 });
  await runDaemonTick(db);
  expect(statusOf(db, id)).not.toBe('success');
  expect(describeExtractionHealth(db).bad_payload_24h).toBe(1);
});
```

- [ ] **Step 2: Run** — Expected: both red.

- [ ] **Step 3: Implement** — refuse at the hook (the earliest place that can know), and make the daemon path honest for rows already in the queue. Check whether `tasks.status` has a CHECK constraint before adding `'skipped'`; if it does, add a migration following the existing `ADD COLUMN` / `IF NOT EXISTS` conventions in `scripts/migrations/`, with a backup note (ccmem handoff Rule 13).

- [ ] **Step 4: Run** — pass, and the existing "bad payload writes an audit row" test still passes (the audit is not what changes).

- [ ] **Step 5: Mutation** — restore the silent `return`. Both new cases go red. Restore.

- [ ] **Step 6: Commit** — `fix(daemon): a summarize task with no transcript is skipped, not counted a success (tester #496)`

### Task D2: `retrieval-check` cannot report 0% for a healthy store

**Files:**
- Modify: `scripts/lib/benchmark/corpus.json` (replace hardcoded ids with a content match)
- Modify: `scripts/lib/admin/retrieval-check.mjs`
- Test: `tests/integration/retrieval-check.test.mjs`

**Interfaces:**
- Produces: the corpus writes one `{"prompt":…, "expected_substring":…}` per positive case; `cmdRetrievalCheck` resolves each substring against the live store and **fails loudly** (`E_CORPUS_STALE: expected "auth retry failures" matched no memory`) when none does — never a silent 0%. The output also prints `retrievalPath`, `gated` and `total`.

- [ ] **Step 1: Write the failing test**

```ts
it('a corpus whose expected memory is absent fails loudly instead of scoring 0% (#492)', async () => {
  const r = await runRetrievalCheck(emptyDb, corpusWithMissingId);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/E_CORPUS_STALE/);
});
```

- [ ] **Step 2: Run** — Expected: FAIL, exits 0 with `recall@1: 0.0%`.

- [ ] **Step 3: Implement** — the substring resolution, the loud failure, and the extra output fields. (The floor half claimed in #492 is **not** reproducible at `97d89d4`: forcing `embedding.enabled:false` also nulls `sig`, and `relevanceFloorFor` is only reached on the embedding path. Say so in the commit body so the tester's report is corrected, not silently dropped.)

- [ ] **Step 4: Run** — pass, and on this machine's real store the check now reports a non-zero recall (record the number in the commit body — it is a measurement, so include the command).

- [ ] **Step 5: Mutation** — remove the loud-failure branch. First case red. Restore.

- [ ] **Step 6: Commit** — `fix(retrieval-check): a stale corpus fails loudly instead of scoring 0% (tester #492)`

---

## Part E — #478 paid acceptance

### Task E1: run it, record it

**Files:** none modified. Evidence goes in the handoff.

- [ ] **Step 1** — Write a minimal `orca-plan-v1` plan in `/Users/biran/code/skills/orca/a3-scratch-20261120`: one small task, `requiredChecks: ["npm test"]`, a scope small enough that the plan finishes and execute crosses the ceiling.
- [ ] **Step 2** — `orca project register-plan` → `group import` → `proposal set-agent` (codex) → `group set-limit` set to a ceiling execute will cross (plan fits, execute does not) → `confirm --accept-shortfall` if #479 refuses → `start`.
- [ ] **Step 3** — Watch for the stop. `run show` must print the continuation line (`continues at <phase> with the paid …`) and the work must stay on the tree.
- [ ] **Step 4** — `group set-limit` with a higher ceiling. The continuation run's usage must have **no plan phase**, and the task must complete.
- [ ] **Step 5** — Record: every command, the ceiling that stopped it, the resumed run's per-phase usage, the task's final state, and whether any attempt was double-counted. Write them into the Orca handoff's #478 section. Record the cost the tool reports, verbatim (Orca Rule 14) — never estimate.

**If any step fails**, stop the run (do not spend a second time), record the failure verbatim in the handoff, and leave #478's paid acceptance open with what was learned. Do not "fix and retry" the same session without saying so in the report.

---

## Self-review

- **Spec coverage:** A1↔#484, A2↔#486(1), A3↔#486(2), A4↔#480, B1↔#489, B2↔#490, B3↔#481, B4↔#488, B5↔#487, B6↔#491, C1↔#483, C2↔#505, C3↔#499, C4↔#500, C5↔#503+#504, D1↔#496, D2↔#492, E1↔#478. Every approved issue has a task. #490's two unimplemented config sections (`ssh_defaults`, `directions`) are **not** in scope — only keeping the keys is; say that in the handoff so the tester can retitle #490 to "keys are kept; the two sections are still unimplemented".
- **Review Focus:** 1→A1, 2→B2, 3→A3, 4→A4, 5→C5. All five have an owning task.
- **Type consistency:** `budgetShortfall` (C3) is named the same where it is produced and consumed; `checkpointId` (C1) matches the wire and the local type; `writeJsonAtomic` (B1) is one helper used by both savers; `discoverActiveSourceSkillNamesWithFailures` (A3) is the one new discovery entry point and the old export delegates to it.