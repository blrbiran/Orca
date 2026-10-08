## Part F — ccloop re-pin, final gate and closing (spec §7, §9)

Part F runs after Parts A–E. Task F1 waits for the human to push the ccloop branch `fix/codex-planner-output` (merged
into ccloop `main`); until then F2 runs against the current pin and F1 is listed under `awaitingHuman`.

No existing test is rewritten by this part.

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

### Task F2: Final gate on an isolated clone

**Files:** none changed (evidence only, in the scratchpad and the ledger).

- [ ] **Step 1: Clone.** `git clone --local /Users/biran/code/skills/loop/Orca-issues <scratch>/gate`, checkout the branch
  head; link `node_modules` and `web/node_modules` from the worktree.
- [ ] **Step 2: Environment.** HOME and `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` set to fresh
  directories under `<scratch>/gate-home`; `TMPDIR` a short real directory; `ORCA_CCLOOP_BIN` the clone build (F1 step 4,
  or the current pin's clone build if F1 is waiting); `ORCA_AGENTS_TABLE` the fake codex `integration` table used by
  earlier gates (see `docs/handoff/handoff.md` §3 "现行基线"); `ECC_GATEGUARD=off DISABLE_OMC=1`.
  Before and after: `ls -la ~/.orca/control > <scratch>/orca-before.txt` / `after.txt` and `cmp` them (Rule 17).
- [ ] **Step 3: Run each segment, each redirected to its own file and read whole, recording RC and `uptime`:**
  `npm run build --workspace web`; `npm run typecheck`; `npm run --ws check`; `npm run verify:control`;
  `npm run verify:panel`; `npm test`; `node scripts/check-tmp-leak.mjs`.
- [ ] **Step 4: Judge reds.** Every red must be a registered load flake (handoff §3 list, plus `driverReconcileN`
  "lands all three…"); re-run that file alone three times after load drops and record `uptime`. Any other red is a
  regression: stop and fix in the owning part.
- [ ] **Step 5: Record** the counts, RCs, uptimes and the clone path in the ledger.

### Task F3: Close the round

- [ ] **Step 1: Final whole-branch review** by a fresh reviewer subagent (brief: both specs, this plan, the ledger, the
  known flakes list, the list of rewritten tests), then fix waves as needed with mutation proof for each fix.
- [ ] **Step 2: Ledger.** `.superpowers/sdd/2026-10-08-issue-fixes/progress.md` (force-added: `.superpowers/sdd` is
  git-ignored) gets the closing section: what landed per part, rewritten tests by name, rulings made during execution,
  awaitingHuman.
- [ ] **Step 3: Handoff (Chinese).** Replace `docs/handoff/handoff.md` §4.0 with this round's state; compress the
  previous §4.0 into a `4.0.v` conclusions entry (Rule 13 three conditions); no current hashes. Update the "Orca 那条线"
  section of ccloop's `docs/handoff/handoff.md` in the ccloop worktree branch the same way.
- [ ] **Step 4: awaitingHuman** (agent never does these): merge `fix/codex-planner-output` into ccloop main and push;
  after F1, `--ff-only` merge `fix/issues-20261008` into Orca main and push; delete the two worktrees
  `Orca-issues` and `ccloop-planner`; note that the control store becomes schema 9 (older Orca cannot open it).
