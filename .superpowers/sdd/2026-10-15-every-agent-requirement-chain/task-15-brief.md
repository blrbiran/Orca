## Task 15: Repin ccloop in the same Orca branch (spec §8.2)

**Files:** `package.json:35`, `package-lock.json` (written by the script)

- [ ] **Step 1:** precondition: H1 done; `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main > "$LOGS/t15-remote.txt"` names `<SHA>`; `$OR` is clean (`/usr/bin/git -C "$OR" status --porcelain > "$LOGS/t15-status.txt"`, 0 bytes).
- [ ] **Step 2:** `( cd "$OR" && node scripts/pin-ccloop.mjs <SHA> ) > "$LOGS/t15-pin.log" 2>&1; echo "RC=$?" >> "$LOGS/t15-pin.log"` -- RC 0 required (the script runs its own checks, including the default E2E with relocated HOME/XDG).
- [ ] **Step 3:** P-2 `npm run verify:ccloop-pin` → `$LOGS/t15-verify-pin.log`, RC 0.
- [ ] **Step 4: commit** `package.json package-lock.json`, subject `chore(deps): repin ccloop to <short SHA> for the every-agent requirement chain`.

---

