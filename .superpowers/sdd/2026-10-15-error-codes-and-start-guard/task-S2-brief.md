### Task S2: `codex-rate-limited` held to both languages as a view-shown reason

**Files:** Modify `tests/panel/refusalCoverage.test.ts:51-54` (the "Issue fixes spec §4.2(1): ccloop's stop reasons" group of `VIEW_REASONS`).

**Interfaces:** none (the entries exist: `web/src/locales/en.ts:1325`, `zh.ts` the same key).

- [ ] **Step 1: Edit** — after `"codex-skills-source-invalid", "codex-exit-error",` add `  // Feedback #62: Codex answered HTTP 429 and ccloop's backoff ran out (ccloop 3069dbf codexAdapter.ts).\n  "codex-rate-limited",`.
- [ ] **Step 2: Run** — `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > /private/tmp/oec/logs/s2-green.log 2>&1`: green (both entries exist — this criterion is green from the start by construction; its value is the mutation below).
- [ ] **Step 3: Commit** — `tests/panel/refusalCoverage.test.ts`; message `test(panel): hold codex-rate-limited to both languages as a view-shown reason`.
- [ ] **Step 4 (reviewer, clone `s2`): mutation** `S2a` delete the en entry: `web/src/locales/en.ts` `{"from": "  \"codex-rate-limited\": \"The provider rate-limited the Codex call (HTTP 429). Retry the task later, once the provider quota window has passed; a call refused before any work booked no usage.\",\n", "to": ""}`, dir `root`, test `tests/panel/refusalCoverage.test.ts` — red: "has a en entry for every …" (`["codex-rate-limited"]`) and "keeps the two tables over the same codes". As a contrast, run the same mutation on a clone of the commit **before** S2 (`/usr/bin/git clone -q --local --branch feat/error-codes-start-guard …` then read `git log`; build the clone at `HEAD~1` with `git clone --local` + `git -C <clone> switch --detach HEAD~1` — if Tier 0 refuses `switch`, record that and skip the contrast): only "keeps the two tables…" is red there.

---

