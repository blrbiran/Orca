### Task 11 (Orca): Repin ccloop to the new commit — **awaits the human's push first**

`scripts/pin-ccloop.mjs` installs `github:blrbiran/ccloop#<sha>`: npm can install nothing GitHub does not have. Pushing is the human's (ccloop Rule 13; Orca Rule 15 — the Tier 0 gate blocks it for the agent).

**Files:** Modify `package.json`, `package-lock.json` (by the script only).

**Interfaces:** Consumes ccloop `codex/omp-single-call`'s head commit, pushed. Produces Orca's `dependencies.ccloop = "github:blrbiran/ccloop#<sha>"`.

- [ ] **Step 1: List for the human** (checkpoint `awaitingHuman`): "push ccloop `codex/omp-single-call` (or ff-merge it into main and push main) so `<full sha>` is on GitHub". Get the sha with `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call rev-parse HEAD > /private/tmp/osc/logs/t11-sha.log`.
- [ ] **Step 2: After the human says it is pushed, check it is there (read-only)**

```bash
/usr/bin/git ls-remote https://github.com/blrbiran/ccloop > /private/tmp/osc/logs/t11-lsremote.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-lsremote.log
```
Read it whole: the sha is the head of the pushed ref.
- [ ] **Step 3: Replace the worktree's dependency symlinks with a real install** (the symlinks are the ones S3 created; check first)

```bash
test -L /Users/biran/code/skills/orca/Orca-wt/omp-single-call/node_modules && test -L /Users/biran/code/skills/orca/Orca-wt/omp-single-call/web/node_modules && /bin/rm -f /Users/biran/code/skills/orca/Orca-wt/omp-single-call/node_modules /Users/biran/code/skills/orca/Orca-wt/omp-single-call/web/node_modules; echo rc=$?
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm ci > /private/tmp/osc/logs/t11-ci.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-ci.log
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call status --porcelain > /private/tmp/osc/logs/t11-status.log 2>&1
```
Read all; `rc=0`; status empty (pin-ccloop requires a clean tree).
- [ ] **Step 4: Pin**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && node scripts/pin-ccloop.mjs <full 40-hex sha from Step 1> > /private/tmp/osc/logs/t11-pin.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-pin.log
```
Read it whole. Expected: every check `ok` (package.json pins the commit; the lock changes only ccloop; only the two files changed; built real directory; the default-resolution E2E passed; typecheck; `npm ci` reproduces the lock), `rc=0`. Any `FAIL` ⇒ stop and report; do not commit.
- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add package.json package-lock.json
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t11-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
chore(deps): repin ccloop to the omp single-call commit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

If the human has not pushed by the time Task 12 runs, Task 12 runs on the unrepinned tree (its default-resolution tests then use the old pin) and Steps 2-5 here plus a second Orca gate go to `awaitingHuman`.

---

