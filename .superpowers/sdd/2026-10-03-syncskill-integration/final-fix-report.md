# Final fix report — syncskill integration (final review T1, N1, I1, I2)

Author: single fixer subagent of session 08b1007d, 2026-10-03. Nothing pushed; no branches or worktrees.
Scratch: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/08b1007d-4dc6-44c3-9772-c05f71d2ae7c/scratchpad/fix` (every log named below is there). Env for every run: `fix/env.sh` (HOME + four XDG roots under
`/private/tmp/oc-B3pX`, TMPDIR `/private/tmp/oc-tBK2`, `ECC_GATEGUARD=off DISABLE_OMC=1`). Orca runs via `fix/run.sh`
in the `git clone --local` copy `fix/orca` (node_modules + web/node_modules symlinked), `ORCA_CCLOOP_BIN=fix/ccloop/dist/cli.js`.

## 1. ccloop T1 — envelope-hash golden now goes through the schema
- Change: `tests/control/protocol.test.ts` "leaves the canonical hash of an envelope without the field unchanged" (only
  this test, this round's own unpushed test, named by the final review). It now hashes the payload returned by
  `parseControlRequest("accept"|"inspect", envelope)` (what `acceptStart` hashes and stores) and pins the temp paths to
  `/fixed/...` only after the parse (both methods require an existing canonical sourceDir). Golden unchanged
  (`032325fb…bf80`, computed at 85a9564).
- Commit: ccloop **`01d1684`** (parent af26a22).
- Tests (clone `fix/ccloop-t`): `npx tsc --noEmit -p .` rc 0 (`c-tsc.log`); `npx vitest run tests/control/protocol.test.ts
  tests/control/accept.test.ts` → 2 files, 26 passed, rc 0 (`c-green.log`).
- Mutation (`c-mut1.diff`): `skillPluginDir: z.string().min(1).optional()` → `.default("/")` (`/` is canonical, so accept's
  directory check passes and only the hash can tell). New test RED: received `5db12062a370…3012` (`c-mut1-new.log`, rc 1).
  The af26a22 form of the test under the same mutation: GREEN (`c-mut1-old.log`, rc 0) — the vacuity the review named.
  "Reorder a key" is not a meaningful mutation: `canonicalize` sorts keys, so order cannot change the hash.
- Restore: `git diff` 2067 bytes / `--cached` 0 before and after (`c-base.txt`, `c-restore.txt`; the 2067 is the test-file
  edit itself, uncommitted in the clone). Clone and main-tree test file `cmp` identical before commit.
- Decision: ccloop Rule 15 (changing an existing criterion needs a human naming it) — taken as satisfied by the controller
  brief naming this exact test; the rewrite is stricter, not looser.

## 2. Orca N1 — set-task-loop on a confirmed task refuses a changed declaration with syncskill unset
- Change: `src/control/webService.ts` setTaskLoop, right after `if ("failure" in skillLookup) throw …`:
  `if (proposal.state !== "editable" && !skillsUnchanged && expanded.recipe.skills !== undefined && (this.deps.syncskill?.bin ?? null) === null) throw new ControlError("syncskill-unconfigured")`.
  Removed skills (recipe without `skills`) and an unchanged declaration stay accepted unset; drafts unchanged.
- Test (`tests/control/setTaskLoopSkills.test.ts`): new "refuses a changed declaration (names or profile) unset as
  syncskill-unconfigured and leaves the task as it was" (names changed, names added to, profile; `deps.syncskill`
  absent and `{bin:null}`; snapshot hash, allocation, loopVersion and effective skills unchanged; then unchanged
  budget-only edit and removal accepted unset). Existing assertion changed (recorded): the C15 test's final
  "names need no lookup" step ran with syncskill unset and expected acceptance — the exact behaviour N1 forbids; it now
  runs with a configured fake and asserts no spawn.
- Commit: Orca **`848055b`**.
- Tests: `npm run typecheck` rc 0 (`o-tsc.log`); setTaskLoopSkills 13/13 (`o-n1-green.log`); focused set
  (setTaskLoop*.test.ts, skillsE2E, driverSkills*) 9 files, 61 passed, 1 skipped (driverSkillsReal, ungated), rc 0
  (`o-n1-focus.log`); driverSkillsReal gated with `ORCA_SYNCSKILL_REAL_BIN=t6/ss/dist/index.js` (syncskill 3157563) 1/1 rc 0
  (`o-n1-real.log`).
- Mutations (each alone, `o-n1-mut.txt`, logs `o-n1-N1{a,b,c,d}.log`):
  | # | Mutation | Red |
  |---|---|---|
  | N1a | delete the new check | new test: `expected undefined to match { code: 'syncskill-unconfigured' }` |
  | N1b | drop `proposal.state !== "editable"` | draft test "a draft task needs no syncskill…" |
  | N1c | drop `!skillsUnchanged` | new test (unchanged edit) + H3 "accepted with ORCA_SYNCSKILL_BIN unset" |
  | N1d | drop `expanded.recipe.skills !== undefined` | 3 tests (removal unset) |
- Restore: baseline diff 4306 / cached 0; after each: 4306 / 0, `cmp` with main tree identical.

## 3. Orca I1 (ruling (b)) — codex task with skills blocks on ccloop's refusal
- ccloop build: `git clone --local` at **`01d1684f5c99571640eb5335fa8cd08d983a465f`** into `fix/ccloop`, node_modules symlinked,
  `npm run build` rc 0 (`ccloop-build.log`, `ccloop-head.txt`). `ORCA_CCLOOP_BIN=fix/ccloop/dist/cli.js`.
- Change: new describe in `tests/control/skillsE2E.test.ts` (same file, own `relocateHome`): task a, agent `{agent:"codex"}`
  (world's fake codex), loop with `skills: {names:["alpha"]}`, fake syncskill `inject-ok`. Asserts:
  run `{state:"blocked", blockedAt:"B", blockedReason:"accept-refused:2:skills-unsupported-agent"}` (**exact string recorded**);
  `drive.skills.dir` = envelope `work.skillPluginDir` = `skills-<runId>`; one syncskill call; codex argv, claude argv and
  codex calls all empty; envelope sourceDir = `sourceDirOf(roots, runId)` and no `<sourceDir>/control/accepted.json`;
  `skills-<runId>/skills/alpha/SKILL.md` exists and `skills-<runId>` is listed in the workspaces root. `finally` removes the
  read-only snapshot with `removeSkillsSnapshot` after teardown.
- Commit: Orca **`d6e56cf`**.
- Tests: typecheck rc 0 (`o-i1-tsc.log`, `o-i1-tsc2.log`); skillsE2E 2/2 rc 0 (`o-i1-green.log`); focused set 9 files,
  62 passed, 1 skipped (driverSkillsReal), rc 0 (`o-i1-focus.log`).
- Mutations (`i1-mut.txt`):
  - A (ccloop, `fix/ccloop-t`, `i1-mutA.diff`): delete the `skills-unsupported-agent` refusal in `acceptStart`, rebuild, run with
    that build → RED: `{state:'settled', blockedAt:null, blockedReason:null}` — the codex run landed without its skills
    (`o-i1-mutA.log`). Restore: ccloop-t diff 2067 / cached 0 before and after.
  - B (Orca, `i1-mutB.diff`): drop `skillPluginDir` from the envelope in A2 → RED, same settled shape (`o-i1-mutB.log`).
    Restore: orca clone diff 9130 / cached 0 before and after.
  - Not seen red on its own: the "no accepted.json" and "snapshot kept" assertions (both mutations short-circuit at the
    state assertion; no existing code path removes the snapshot on a block to mutate). Recorded per Rule 9.

## 4. Orca I2 — offline probe `scripts/probe-claude-skills.mjs`
- Commit: Orca **`3e1366d`** (blob `daf5949`, the bytes that ran).
- What it does: temp HOME/CLAUDE_CONFIG_DIR/XDG, dummy `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` → in-process recorder (saves
  bodies, answers 500), plugin dir as A2 makes it (dirs 0700, `plugin.json` `{"name":"orca-run-skills","version":"0.0.0"}` 0600,
  `skills/<name>/SKILL.md`, `skills/syncskill-lock.json` with a random content_md5, then `skills/` made read-only with a copy of
  `makeReadOnly`), runs `claude -p "Say ok." --setting-sources project,local --strict-mcp-config --no-session-persistence
  --max-turns 1 --plugin-dir <dir> --debug-file <tmp>` (no `--disable-slash-commands`) detached, stops 3 s after the first
  `POST /v1/messages` by SIGTERM to the process group (SIGKILL after 5 s), closes the recorder, restores owner write, removes
  the temp dir. Exit 0 iff (a) reached and (b) absent.
- Run: `node scripts/probe-claude-skills.mjs --claude $(which claude)` from the main tree at HEAD d6e56cf (script uncommitted,
  same bytes as 3e1366d), output `probe-out.json`, meta `probe-meta.txt`. rc **0**.
  - `which -a claude`: `/Users/biran/.nvm/versions/node/v22.13.1/bin/claude` (→ `…/@anthropic-ai/claude-code/bin/claude.exe`),
    `/opt/homebrew/bin/claude` (2.0.19, not probed). `claude --version`: **2.1.288 (Claude Code)**, before and after.
  - Install dir `/Users/biran/.nvm/versions/node/v22.13.1/lib/node_modules/@anthropic-ai/claude-code` mtime before:
    `1791023596 Oct  3 18:33:16 2026`; after: `1791023596 Oct  3 18:33:16 2026` (binary the same). Note: that mtime is ~2 min before
    the probe ran — claude was (re)installed during this session, but not during the probe.
  - Processes: none left (`ps-after.txt`: only the checking shell); temp dir removed.
- Full output:
```json
{
  "claude": "/Users/biran/.nvm/versions/node/v22.13.1/bin/claude",
  "argv": [
    "-p",
    "Say ok.",
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--max-turns",
    "1",
    "--plugin-dir",
    "/private/tmp/oc-tBK2/orca-probe-claude-skills-LX3cGe/skills-run-838d8e2c",
    "--debug-file",
    "/private/tmp/oc-tBK2/orca-probe-claude-skills-LX3cGe/claude.debug"
  ],
  "skillName": "orcaprobe838d8e2c",
  "plugin": "orca-run-skills",
  "requests": {
    "total": 4,
    "messages": 3,
    "urls": [
      "HEAD /api/hello",
      "POST /v1/messages?beta=true",
      "POST /v1/messages?beta=true",
      "POST /v1/messages?beta=true"
    ]
  },
  "stoppedBy": "probe-after-first-request",
  "exit": {
    "code": 143,
    "signal": null
  },
  "processGroupGone": true,
  "a": {
    "skillReached": true,
    "skillNameAs": "orca-run-skills:<name>",
    "namespaced": true,
    "bare": false
  },
  "b": {
    "lockReached": false,
    "needles": [
      "syncskill-lock",
      "syncskill-lock-v1",
      "<content_md5>",
      "<created_at>",
      "resolved_commit",
      "content_md5"
    ],
    "hits": []
  },
  "c": {
    "readOnlyPluginLoaded": true,
    "skillsTreeModesBefore": [
      "skills 500",
      "skills/orcaprobe838d8e2c 500",
      "skills/orcaprobe838d8e2c/SKILL.md 400",
      "skills/syncskill-lock.json 400"
    ],
    "pluginDirChanged": false
  },
  "debugLines": [
    "2026-10-03T10:35:45.597Z [DEBUG] Loaded inline plugin from path: orca-run-skills",
    "2026-10-03T10:35:45.598Z [DEBUG] Checking plugin orca-run-skills: skillsPath=exists, skillsPaths=0 paths",
    "2026-10-03T10:35:45.598Z [DEBUG] Attempting to load skills from plugin orca-run-skills default skillsPath: <tmp>/skills-run-838d8e2c/skills",
    "2026-10-03T10:35:45.600Z [DEBUG] Loaded 1 skills from plugin orca-run-skills default directory"
  ],
  "stderrTail": "",
  "stdoutTail": "",
  "pass": true,
  "kept": null
}
```
- Verdict: (a) the skill reaches the model **namespaced, as `orca-run-skills:<name>`** (never bare); (b) nothing from
  `syncskill-lock.json` reached it, so the lock can stay at `<dir>/skills/syncskill-lock.json`; (c) a plugin dir with a read-only
  `skills/` tree (dirs 0500, files 0400) loads, and claude changed nothing in it. For prompts: a prompt naming a skill must
  use `orca-run-skills:<name>` (or rely on claude matching by description).
- Probe criteria seen red (clone copies, main script `cmp`-restored): P1 skill description carries the lock's content_md5 →
  `b.lockReached:true, hits:["<content_md5>"]`, rc 1 (`probe-mutP1.*`); P2 no `--plugin-dir` → `a.skillReached:false`, rc 1
  (`probe-mutP2.*`).

## Not done here (outside the four items)
N2 (zh string), N3, N4/N5 gate evidence, N6 (spec §11 incl. these probe answers), N7, N8. The ccloop pin in Orca is not moved
(Orca tests ran against the fix/ccloop build at 01d1684). Load average at the end: 3.42 / 3.92 / 6.65.
