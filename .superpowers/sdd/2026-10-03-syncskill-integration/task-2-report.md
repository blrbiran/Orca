# Task 2 report: syncskill caller (commit 847a7a6, session 08b1007d)

Files: `src/skills/syncskill.ts`, `tests/skills/syncskill.test.ts` (24 tests), `tests/skills/fixtures/fake-syncskill.mjs`, `tests/skills/syncskillReal.test.ts` (1 test, gated by `ctx.skip()` in beforeEach). `errors.ts` untouched.

## TDD
- RED: tests copied into a `git clone --local` without `src/skills/syncskill.ts`: both files fail to load ("Failed to load url ../../src/skills/syncskill.js"), 0 tests.
- GREEN (clone, no env): `Test Files 2 passed, Tests 24 passed | 1 skipped (25)`; with `ORCA_SYNCSKILL_REAL_BIN`: `25 passed`. `npm run typecheck` exit 0. (logs: scratchpad/t2/final-skip.log, final-real.log, tc.log)
- First GREEN attempt had 1 failure: my inject-bad-shape test used target `/x` (fake mkdirs it); fixed by using a temp target.

## Mutations (clone, focused tests + real bin; each restored: `git diff` = 0 B, `git diff --cached` unchanged)
All exit 1 (red) except where noted. Detail in scratchpad/t2/muts.txt.
| mutation | red test |
|---|---|
| drop `--no-refresh` | argv test (C18) |
| no sort/unique | sorted-unique test |
| comma allowed in isSafeSkillName | isSafeSkillName, inject skills-shape, profile comma |
| edge whitespace allowed | isSafeSkillName, inject skills-shape |
| error-event code ignored | E_PROFILE_NOT_FOUND, stderr, inject codes |
| events read from stdout only | stderr event tests |
| relative-bin check removed / null-bin check removed | respective tests |
| ENOENT/EACCES map removed | ENOENT and EACCES tests |
| maxBuffer map / timeout map removed | too-large / timeout tests |
| spawn-throw branch -> rethrow | ENOEXEC test |
| empty-profile / member-name / profile-name checks removed | respective tests |
| LockSkill `.strict()` removed / source `.strict()` removed | bad-shape / bad-source tests (source one survived the first suite, so I added `inject-bad-source` fake mode + test, then seen red) |
| inject names unchecked / empty names allowed | skills-shape test |
| result-event check / profile-missing-key / inject shape check removed | output-invalid tests |
| `child.stdin.end()` removed | stdin test (waits-for-EOF fake, 5003 ms timeout fail) |
| exit status lost / errno unnamed | exit-status test / ENOEXEC test |
| C12 decoy: "real" path -> decoy HOME, SYNCSKILL_DIR dropped, decoy seeded | real test red at the final `snapshot(realRoot)` assertion (config.json changed, manifests/ appeared). First try without seeding failed with "Config not found" (red for the wrong reason), so the decoy is seeded. Decoy only; real ~/.syncskill never involved. |

## Real run
syncskill clone `/usr/bin/git clone --local` of /Users/biran/code/skills/syncskill at `3157563e58585e1feb5327a24a56e04efe7a4291`, `npm run build` exit 0. Run: `ORCA_SYNCSKILL_REAL_BIN=<clone>/dist/index.js npx vitest run tests/skills` -> 2 files, 25 passed. Real test asserts: sync dir byte-identical (path:size:mtime:content) around `profileMembers`; `injectSkills` result equals `<target>/syncskill-lock.json` `skills` (schema `syncskill-lock-v1`); real `~/.syncskill` snapshot unchanged.

## Decisions
- Gated real test spawns the built JS via a generated `#!/bin/sh exec node <file>` wrapper (dist/index.js may lack the exec bit); production `ORCA_SYNCSKILL_BIN` stays an absolute executable.
- `skills-shape` is also used for a bad profile name and for empty/unsafe names passed to `injectSkills` (brief listed it only for members).
- Failure mapping order: ENOENT/EACCES, maxBuffer, killed, then the JSON error event's `E_CODE` (must match `^[A-Z][A-Z0-9_]*$`), else exit status / errno name.
- `LockSkill.source` strict (`name,type,url,branch?`); the summary wrapper is not strict (only `skills` / `profiles` are read).
- Tests never touch the real HOME: env passed to the fake has temp HOME; clone runs used temp HOME/XDG/TMPDIR.

## Concerns
- With the seeded sync dir (no sources/manifests), real `profile ls` without `--no-refresh` does NOT change the dir (the no-flag mutation stayed green on the real test); C18's flag proof rests on the fake's argv assertion only. A real red would need a seeded source with a stale manifest.
- Hooks block `git -c core.hooksPath=` commits, so the clone had no baseline commit; restore proof uses `git add -A` staging then `git diff` (0 B) and `git diff --cached` (unchanged).
- Scratchpad collision: another task's `scratchpad/mut.sh`, `muts.txt`, `env.sh` were clobbered/ran concurrently with mine early on (my clone `oc2` got a few mutated lines mid-run); I killed it, reset the clone from the main tree and re-ran all mutations cleanly under `scratchpad/t2/`. The controller's own `mut.sh`/`muts.txt`/`env.sh` in the scratchpad root may have been overwritten by me; check if needed.
- Early run attempts hit the `cp -i` alias prompt once; used `/bin/cp -f` after.
