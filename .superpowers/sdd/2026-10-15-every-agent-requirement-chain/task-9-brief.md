## Task 9: ccloop full gate and ledger

**Files:** ccloop `docs/handoff/handoff.md` (Chinese, live document: roll the "Orca line" section in place per its own
rules); Orca ledger `.superpowers/sdd/2026-10-15-every-agent-chain/progress.md` (created here, `git add -f`, committed in
Task 10's first commit since it lives in Orca).

- [ ] **Step 1: gate in a clone of the branch tip (P-3 clone, no mutation).**

```bash
G="$(mktemp -d /private/tmp/ccg-XXXX)"; /usr/bin/git clone --local -q --branch codex/every-agent-chain "$CL" "$G/repo"
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$G/repo/node_modules"; cd "$G/repo"
export TMPDIR="$(mktemp -d /private/tmp/cl-XXXX)"; export CCLOOP_CACHE_DIR="$G/cache"
rtk proxy npm run typecheck > "$LOGS/ccg-typecheck.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-typecheck.log"
rtk proxy npm run build > "$LOGS/ccg-build.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-build.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$LOGS/ccg-vitest.json" > "$LOGS/ccg-vitest.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-vitest.log"
node scripts/check-known-reds.mjs "$LOGS/ccg-vitest.json" > "$LOGS/ccg-known-reds.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-known-reds.log"
# verify:control: a fake-only table (fake codex in integration mode), binary = this clone's build
node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,JSON.stringify({schema:"ccloop-agents-table-v1",installations:{codex:{kind:"codex",command:[process.execPath,process.argv[2],"integration",process.argv[3]],version:"9.9.9-fake",configDir:null,timeoutMs:120000,killGraceMs:5000,sandbox:"workspace-write",budgetMode:"soft"}}}),{mode:0o600})' "$G/agents.json" "$G/repo/tests/fixtures/fake-codex.mjs" "$G/codex-marker"
ORCA_CCLOOP_BIN="$G/repo/dist/cli.js" ORCA_AGENTS_TABLE="$G/agents.json" npm run verify:control > "$LOGS/ccg-verify-control.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-verify-control.log"
node scripts/check-tmp-leak.mjs > "$LOGS/ccg-tmpleak.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-tmpleak.log"
ls -la "$G/cache" > "$LOGS/ccg-cache-dir.txt" 2>&1
```

  Read every log whole. Success = typecheck/build RC 0; `check-known-reds` RC 0 (every red is on the mechanical list) --
  a red not on the list is diagnosed by running its file alone three times (load flakes are classified only that way,
  ccloop handoff); `verify:control` likewise; tmp leak 0. Counts are reported as the tool printed them.

- [ ] **Step 2: ledger + ccloop handoff.** Write the Orca ledger section "ccloop part" (tasks done, commit subjects, each
  mutation and its observed red, the human's named rewrites, Task 0 results, gate counts with commands and the gate commit).
  Roll ccloop `docs/handoff/handoff.md` §"Orca line" in place (that file's rules; keep conclusions), commit on the ccloop
  branch with subject `docs(handoff): every-agent chain ccloop part ready for push`.

- [ ] **Step 3: checkpoint (Rule 10).** State: branch, tip sha, gate result, what waits for the human.

### Checkpoint H1 [HUMAN]: push ccloop

The human, in their own terminal: review `codex/every-agent-chain` in ccloop, merge into `main` with `--ff-only`, push
`main` (Rule 13/15: each a separate nod). The agent then records `git ls-remote origin refs/heads/main` (the 40-hex sha
used by the repin) and does nothing in Orca's `package.json` before that sha is on the remote.

---

