### Task F1: Re-pin ccloop to the pushed hardening commit

**Files:**
- Modify: `package.json` (the `"ccloop": "github:blrbiran/ccloop#<sha>"` dependency line)
- Modify: `package-lock.json` (by npm)

**Interfaces:**
- Consumes: the ccloop commit on `origin/main` that contains the commit subject
  `docs(spec): make codex final-object extraction schema-aware and unambiguous after review` and the implementation
  commits of the ccloop plan `docs/superpowers/plans/2026-10-08-codex-phase-output-hardening.md`.
- Produces: Orca's pin at that SHA; the gate's `ORCA_CCLOOP_BIN` is a clone build of that SHA.

- [ ] **Step 1: Prove the commit is published.** Run
  `/usr/bin/git -C /Users/biran/code/skills/loop/ccloop ls-remote origin refs/heads/main > <scratch>/ccloop-remote.txt; echo rc=$?`
  and read the file. Let `<sha>` be that value. Then
  `/usr/bin/git -C /Users/biran/code/skills/loop/ccloop fetch origin && /usr/bin/git -C /Users/biran/code/skills/loop/ccloop merge-base --is-ancestor <hardening-impl-commit> <sha>; echo rc=$?`
  must print `rc=0`. If not, stop: F1 stays in `awaitingHuman`.
- [ ] **Step 2: Re-pin.** In the worktree (node_modules is a symlink to the main checkout's — remove the symlink first and
  install a real tree so the main checkout is not changed):
  `/bin/rm /Users/biran/code/skills/loop/Orca-issues/node_modules` then
  `cd /Users/biran/code/skills/loop/Orca-issues && npm install github:blrbiran/ccloop#<sha> > <scratch>/npm-install.txt 2>&1; echo rc=$?`.
  If it hangs on an ssh dependency (handoff note), stop it and instead restore the symlink and record the blocker.
- [ ] **Step 3: Check the pin.** `node scripts/pin-ccloop.mjs > <scratch>/pin.txt 2>&1; echo rc=$?` (all checks ok) and
  `npm run verify:ccloop-pin > <scratch>/verify-pin.txt 2>&1; echo rc=$?`.
- [ ] **Step 4: Build the gate binary.** `git clone --local /Users/biran/code/skills/loop/ccloop <scratch>/ccloop-<sha7>`,
  `git -C <scratch>/ccloop-<sha7> checkout <sha>`, link or install its node_modules, `npm run build`; the gate uses
  `ORCA_CCLOOP_BIN=<scratch>/ccloop-<sha7>/dist/cli.js` (absolute, no `..`). This clone is never mutated.
- [ ] **Step 5: Commit.**
  `git -C /Users/biran/code/skills/loop/Orca-issues add package.json package-lock.json` and commit
  `deps: pin ccloop to the codex phase output hardening`.

