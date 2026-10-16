# Task 2 report — the catalog cache file (ccloop, spec §4.1-§4.2)

Implementer: subagent of Orca session a852f96a (Claude Opus 5.5), 2026-10-16. Worktree
`/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain`, branch `codex/every-agent-chain`, base 6632dee.
Logs: `$LOGS` = `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs`.

Status: DONE_WITH_CONCERNS (concerns below; none blocks Task 4).

## What was done
- `src/agents/catalogCache.ts` created. Its source is the brief's Step 3, verbatim.
- `src/agents/types.ts`: `CatalogRowV1` gains `listed?: boolean` with the brief's comment. The interface is now
  laid out over several lines.
- `tests/agents/catalogCache.test.ts`: 21 tests. It is the brief's file plus the changes that the Task 2
  mutation ruling requires:
  - Key-field tests are rebuilt so that ONLY the named field changes. Each one measures the changed leaves
    (`changedLeaves(before, after)`) and asserts `{ renamed: true, fields: [<that leaf>] }`:
    - size: the mtime is held with `utimes` to T0 before and after the rewrite.
    - realpath: `command` stays a fixed symlink path that is repointed between two files with the same size and
      mtime.
    - profile: the agent dir is held by `PI_CODING_AGENT_DIR` set in both keys.
    - configDir and the inherited variable: each is set to the default agent dir `<HOME>/.omp/agent`, so the
      config-file paths do not move.
  - New criteria for key fields that had none, or only joint coverage:
    - "an argv word that names no file" (`command`).
    - "omp's models.yaml mtime" (second omp config file).
    - "the kind, with no HOME so neither kind has config files" (`kind`). I first ran M2.18 against the brief's
      tests: it stayed green. `kind` turned out to be variable alone, so it got its own criterion.
  - Round-trip test: now `it.each` over umask `0o000` and `0o277`. Under `0o000`, M2.10 (delete the dir `chmod`)
    is unfalsifiable, because `mkdir(mode 0o700)` already yields 0700 (`0o277` narrows modes below the owner's
    read/write, so only the explicit `chmod` keeps 0700/0600). Count 17 (brief) → 21.
  - Cache-dir test: two extra literals for RF3, a relative `XDG_CACHE_HOME` and a relative `HOME` (never
    cwd-relative).
- Commit: `af0e4ea feat(agents): cache file for agent catalogs, keyed by binary and config stamps`. Staged exactly the
  3 paths; `node_modules` left untracked.

## RED / GREEN
- `$LOGS/t2-red.log`: RC=1, load failure (`catalogCache.js` missing). Crash-red, recorded only.
- `$LOGS/t2-red-stub.log` (stub `export {};`): RC=1, `19 tests | 19 failed`. Every test listed × (`… is not a
  function`). That was 19 tests at the time; the umask split and the kind test were added after the stub run, and
  both were seen red under their mutations below.
- `$LOGS/t2-green-final.log`: RC=0, `Tests 21 passed (21)`. Every title is listed ✓ and none is skipped. The RUN
  root is the worktree.
- `$LOGS/t2-tsc-final.log`: `tsc --noEmit -p .` RC=0 (tsconfig includes tests).
- Neighbours, `$LOGS/t2-neighbours.log` (`vitest run tests/agents`): RC=1, `1 failed | 162 passed (163)`. The one
  failure is `updates.test.ts > replays a matching completed receipt before reading a unreadable current table`,
  "Test timed out in 5000ms" at 5037 ms under the parallel run. Run alone (`$LOGS/t2-updates-alone.log`): RC=0,
  15/15 passed, that test 2131 ms.
  - Nothing outside the new files imports `catalogCache` (`$LOGS/t2-importers.txt`). The only edit to existing
    code is an optional type field.
  - Classified as a load flake per the ccloop handoff item 12 procedure: it timed out, and it is green alone.
    Not edited.

## Mutations (P-3)
- Clone: `/private/tmp/mut-l6UE/repo`, made with `git clone --local` of the worktree at 6632dee. The 3 uncommitted
  files were copied in with `cat`. Its node_modules symlink is removed; the dir is left for the human.
- Runner: `$SCRATCH/t2-mut.sh` (mutate.py, then run, then `cat` restore, then `cmp`).
- Round 1 used the 20-test file (`$LOGS/t2-m2.*.log`). Round 2, the authoritative one, used the final 21-test file
  (`$LOGS/t2-round2/<name>.log`, concatenated in `$LOGS/t2-round2/all.txt` and read whole). Every run ends
  `RESTORE-CMP-RC=0`.
- Baseline in the clone: 21/21 green.
- Base sha256 of `catalogCache.ts`: 722216695e3d…d141.

| # | mutation | sha256 after | red in (round 2) |
|---|---|---|---|
| M2.1 | `files: argvFiles,`→`files: [],` | ae48a980…1bae | binary mtime, size, realpath, argv-file mtime (4) — yes |
| M2.1a | stamp `mtimeMs: info.mtimeMs`→`null` | 158490e1…a27b | binary mtime, argv-file mtime, config.yml, models.yaml, config.toml — yes |
| M2.1b | stamp `size: info.size`→`null` | 02489e39…560d | "the binary's size, mtime held" only — yes |
| M2.1c | stamp `path: real`→`path` | a474358f…b909 | "the binary's realpath…" only — yes |
| M2.1d | `command: [...]`→`[]` | 06f0ff77…67fe | "an argv word that names no file" only — yes |
| M2.2 | `profile: …`→`null` | 05967992…ba05 | "the profile…" only — yes |
| M2.3 | `configDir: installation.configDir`→`null` | 04b310d2…5d44 | "the configDir…" only — yes |
| M2.4 | `inheritedConfigDir: …`→`null` | fc8e6740…6d33 | "the inherited config dir variable…" only — yes |
| M2.5 | `configFiles: …`→`[]` | cf4f8c3e…09b6 | config.yml, models.yaml, config.toml — yes |
| M2.5a | drop `models.yaml` from omp list | bca6a8aa…5940 | "omp's models.yaml mtime" only — yes |
| M2.6 | `age <`→`age <=` | 3b874691…8854 | "is a miss at exactly 30 minutes…" (line 62) — yes |
| M2.7 | drop `age >= 0 && ` | 8337b8ec…ea03 | same test (line 63, future entry) — yes |
| M2.8 | drop the stored-key hash check | a6629a53…22ad | "treats a corrupt entry… stored key differs" — yes |
| M2.9 | drop file `mode` and `chmod(temporary)` | 701c534d…→ae65fa82…3e9b | round-trip umask 0o000 (438≠384) and 0o277 — yes |
| M2.9b | drop only `chmod(temporary)` | af0a204a…9028 | round-trip umask 0o277 (256≠384) — yes |
| M2.10 | drop dir `chmod(path, 0o700)` | 1891d53e…e527 | round-trip umask 0o277 — yes (green under the brief's 0o000-only test, see above) |
| M2.11 | empty the write's catch body | d3df0774…8de5 | **green** — see below |
| M2.12 | relative `CCLOOP_CACHE_DIR` returned | 5375ed52…beb3 | "prefers CCLOOP_CACHE_DIR…" — yes |
| M2.13 | `chmod` an existing dir in ensureDir (preflight S10) | 305329d1…f065 | "leaves an existing dir's mode alone" — yes (also RF2, since the 0500 dir becomes writable) |
| M2.14 | drop `isAbsolute(XDG_CACHE_HOME)` | 1139f502…34c8 | cache-dir test — yes |
| M2.15 | drop `isAbsolute(HOME)` | f6ac7d32…40b7 | cache-dir test — yes |
| M2.16 | stamp every argv word (`if (true)`) | b4a13a84…e16a | "an argv word that names no file" — yes |
| M2.17 | drop `index === 0 ||` | 9b40c09c…add7 | **green** — see below |
| M2.18 | `kind: installation.kind`→`""` | 6d3151cb…16a | "the kind, with no HOME…" — yes |

Restore proof (`$LOGS/t2-restore.txt`):
- `cmp` of all 3 files, worktree vs clone: RC=0.
- `git diff` + `git diff --cached` byte count: clone 913 bytes, worktree 913 bytes, identical (`cmp` RC=0). That
  913 bytes is the uncommitted `types.ts` change in both trees; the two new files are untracked in the clone.

`pgrep -fl "fake-omp|fake-codex|worker.js"` returned 0 bytes both before and after (`$LOGS/pgrep-t2-{before,after}.txt`).

Green mutations, recorded, no criterion invented:
- **M2.11**: green, as the brief predicted. Both RF2 shapes fail before a temp file exists: `ensureDir` throws on a
  file where the dir should be, and the `wx` write gets EACCES in the 0500 dir. Registered as a redundant guard for
  these inputs. The guard is not dead code in general: when the rename fails after the temp is written (e.g. the
  entry name is occupied by a directory), it removes the temp. A criterion for that shape would make the guard
  falsifiable. That is the controller's call; the brief said not to invent one.
- **M2.17**: green. Stamping a missing `command[0]` is behaviourally redundant: the binary appearing later changes
  the key with or without the branch (`files` gains an entry vs. its stamp changes). Registered as redundant;
  verbatim brief code kept.

Key field that cannot be varied alone: none. `schema` is a constant.

## Self-review (diff read: `git show af0e4ea`)
- Only the brief's interfaces are exported. There are no imports from registry/materialize; the module imports only
  `../control/protocol.js` (`canonicalHash`) and `./types.js` (types). That leaves Task 4 free to build
  `readAgentCatalog` on top.
- No test touches real user data: every world uses an mkdtemp `HOME` and `CCLOOP_CACHE_DIR`. The cache-dir
  function is tested on literals only.
- The `changedLeaves` helper puts the expected leaf paths in literals. They are not computed from the code under
  test.

## Concerns
1. **Spec vs brief, codex profile file**: spec §4.1 also lists "the `-p` profile file when set" for codex. Plan
   issue 7(a) records that the codex installation has no `-p` field, so the key reads `config.toml` only. I
   followed the plan.
2. **cwd-dependent key**: `catalogKey` stamps every argv word that resolves to an existing path, and a relative
   word resolves against the process cwd. If an argv word like `models` happens to name a file in the cwd, the key
   (and so hit/miss) depends on where ccloop runs. It is harmless for correctness (at worst an extra miss), but
   worth knowing for Task 4.
3. **The omp precedence is the brief's**: the `inherited ?? profile path` order in `configFilesOf` (an inherited
   `PI_CODING_AGENT_DIR` wins over a named profile's dir) is taken from the brief, citing omp `dirs.ts:119-133`. I
   did not re-read omp's source. The profile test relies on this order to hold the paths equal.
4. **Deviation from the brief**: the test file deviates from the brief's code as listed above (21 tests, not 17).
   Each deviation comes from the Task 2 mutation ruling or makes a named mutation falsifiable (M2.10, M2.18).
5. **Load flake**: the timeout in `tests/agents/updates.test.ts` under a full `tests/agents` run is a load flake
   per handoff item 12, not touched. It may recur in the Task 16 gate.

## Fix round 1 (2026-10-16, same implementer) — commit 3204a47 (new commit; af0e4ea untouched)

### Changes
1. **omp config-dir precedence** (`configFilesOf`). I read omp 18.10.1
   `/Users/biran/.bun/install/global/node_modules/@oh-my-pi/pi-utils/src/dirs.ts`:
   - `normalizeProfileName` trims, and maps ""/"default" to undefined.
   - In the `DirResolver` constructor, `agentDirOverride = profile ? undefined : options.agentDirOverride`.
   - `resolveActiveAgentDirOverride` returns undefined for an active profile.

   New order: a NAMED profile (trimmed, not ""/"default") reads `<HOME>/.omp/profiles/<p>/agent`. Otherwise the
   order is `configDir ?? inherited ?? <HOME>/.omp/agent`. The doc comment now cites the constructor,
   `resolveActiveAgentDirOverride` and `normalizeProfileName`; the `dirs.ts:119-133` citation is removed.
2. **Only-profile criterion rebuilt**: "the profile, with no HOME so neither profile has config files" now yields
   `fields: ["profile"]`.

   New criterion "a named omp profile reads its own agent dir, whatever configDir or PI_CODING_AGENT_DIR say;
   \"default\" honours them". It asserts the stamped paths for four cases:
   - `work` + configDir
   - `work` + inherited dir
   - `default` + configDir
   - `default` + inherited dir
3. **Empty or relative inherited dir is treated as unset**: `inherited = raw && isAbsolute(raw) ? raw : null`, for
   both `PI_CODING_AGENT_DIR` and `CODEX_HOME`. New criterion "an empty or relative inherited config dir is unset,
   never a cwd-relative path" covers omp and codex, each with "" and "rel".
4. **Removed `index === 0 ||`**: the argv loop is now `for (const part of installation.command)`, and a stamp is
   kept only when the path exists.

Side note: I briefly changed `inheritedConfigDir` from `?? null` to `|| null`. No criterion could redden it, and
it was not asked for, so I reverted it before the mutation run. It is not in the commit.

### Tests
- `$LOGS/t2f1-green-final.log`: RC=0, `Tests 23 passed (23)`. Every title is listed ✓, and the RUN root is the
  worktree.
- `$LOGS/t2f1-tsc-final.log`: RC=0.
- Neighbours, `$LOGS/t2f1-neighbours.log` (`vitest run tests/agents`): RC=1, `1 failed | 164 passed (165)`.
  - The failure is `command.test.ts > ccloop agents validate > answers ok…`, timed out at 5005 ms under load. In
    the previous full run the same test took 4119 ms and passed.
  - Run alone (`$LOGS/t2f1-command-alone.log`): RC=0, 11/11, that test 510 ms.
  - This is a load flake per handoff item 12. It is a different file from round 0's flake (updates.test.ts, which
    passed this time). Not edited.

### Mutations
- Fresh clone `/private/tmp/mut-cG27/repo` (af0e4ea plus the two fixed files copied in). Its node_modules link is
  removed; the dir is left for the human.
- Logs: `$LOGS/t2-fix1/<name>.log`, concatenated in `$LOGS/t2-fix1/all.txt` and read whole.
- Baseline 23/23. Base sha256 is 88241c26…4938. Every run ends `RESTORE-CMP-RC=0`.

New mutations:
- **f1-old-order** (the old `configDir ?? inherited ?? (named ? profile dir : default dir)`), sha 2d7082f5…46d8:
  red in "a named omp profile reads its own agent dir…". Received `custom/config.yml`, expected
  `profiles/work/agent/config.yml`.
- **f1-no-default-sentinel** (`profile ? profile : null`), sha 40ec0b62…54f5: red in the same test, line 179.
  Received `profiles/default/agent`.
- **f3-raw-inherited** (`const inherited = raw ?? null;`), sha 3933d518…6a68: red in "an empty or relative
  inherited config dir…". Received `config.yml` (the "" case).
- **f3-relative-inherited** (`raw ? raw : null`), sha acce5b68…8e18: red in the same test. Received
  `rel/config.yml`.

Re-run of the earlier set against the fixed code:
- Red in their named tests: M2.1, 1a, 1b, 1c, 1d, 2, 3, 4, 5, 5a, 6, 7, 8, 9, 9b, 10, 12, 13, 14, 15, 16 and 18.
- M2.2 is now red in "the profile, with no HOME…".
- M2.16's anchor is now `if (s.mtimeMs !== null) argvFiles.push(s);` → `argvFiles.push(s);`.
- M2.1a now also reddens size and realpath. Without the index branch, a null mtime drops every argv stamp. It is
  still red in its named tests.
- M2.5 and M2.5a also redden the new path tests.
- M2.11 is still green, registered as before.
- M2.17 is no longer applicable (branch removed).

Restore proof (`$LOGS/t2f1-restore.txt`):
- `cmp` of both files, worktree vs clone: RC=0.
- `git diff` + `--cached`: clone 6213 bytes, worktree 6213 bytes, identical. Both measured before the commit;
  this is the fix diff against af0e4ea.

pgrep returned 0 bytes before and after.

### Remaining notes
- omp's `PI_CONFIG_DIR` (it replaces `.omp`) and the Linux XDG layout are not in the key. The XDG layout was
  already accepted in plan issue 7(d); `PI_CONFIG_DIR` was not raised there. Both are bounded only by the
  30-minute lifetime.
- ccloop's profile schema allows uppercase (`omp.ts:18`), but omp's `PROFILE_NAME_RE` is lowercase-only, so omp
  would refuse such a profile. The key just uses the trimmed name.
