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

