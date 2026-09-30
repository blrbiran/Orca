## Controller rulings on the draft

Session `e604b1ba` controller, 2026-10-01, under the human's standing instruction H20 ("先按你的建议执行…执行完在最后阶段报给我审核"); reported to the human at the end of the round. They override the text below wherever they differ.

- **F2 accepted**: a custom `orcaStored` detector reading `orca.panel.lang` through the `readTheme`-style wrapper; the built-in localStorage lookup is not used (it throws once its cached support goes stale). Same key and order as spec §4.
- **F6 accepted**: estimate `reasonCode`, evidence `kind` and agent `kind` are open strings on the wire, shown as sent; the eleven families the scan added are keyed.
- **F8 accepted as drafted**: the codes live in `compute.ts` / `coverage.ts` (one shape for CLI and panel), so `orca metrics --json` gains the fields and the golden is rewritten under H18. Adding them only in `/api/metrics` would give the same report two shapes (Rule 7).
- **F9, F12 accepted**: the two W5 fixture files and the two `webParity` compile-time functions are in H18's categories.
- **F13 accepted and registered**: a web-made message keeps the language it was built in until the next refusal.
- ~~**Scratch clones**: the agent that created a mutation clone deletes it~~ — **withdrawn after the preflight (P10)**: the user's global CLAUDE.md requires explicit approval for any recursive `rm -rf`. Clones are kept, as Global Constraints says; the controller lists them for the human at the end.

Preflight rulings (`.superpowers/sdd/2026-10-01-panel-i18n/preflight.md`):

- **P1**: Task 3 Step 1's capture script is `$SCRATCH/t3-capture.mts` (not `.ts`): tsx compiles `.ts` in the scratchpad as CommonJS and refuses top-level `await`. Measured by the preflight: the `.mts` version rc=0 and byte-identical to the plan's 40 ROWS.
- **P2**: Task 11's pseudo-locale criterion must not collide with fixture data: rename the colliding fixture values (repo keys `repo-one/two/three` → `acme-alpha/beta/gamma`; the refusal code `correction-already-recorded` → a catalog code containing no CHECKED value, e.g. `decision-not-found`; the model `gpt-plan` → `gpt-5x`), and the implementer re-runs the collision check over every fixture string before claiming the criterion.
- **P3**: MT8-1's criterion asserts the `thead th` texts, not a string the limit labels also render.
- **P4**: MT9-3's criterion asserts the `legend` (or the fieldset's `aria-label`), not a substring another label also contains.
- **P8 accepted as a spec deviation**: the Chinese refusal table is a plain `zhErrors` record, not an i18next `errors` namespace — refusal codes may contain `:`, i18next's namespace separator, so `t("errors.<code>")` would misparse them. Behavior matches spec §3.2.
- **P11**: import `JSX` from `react` where the plan writes `JSX.Element` (no global namespace under @types/react 19).
- **P12**: Task 3 Step 5's absence check must not match `view.summary.` — search for `loopPlan.summary` / `planName` only.
- **P15**: at the start of Task 2, compile the assembled typed resources once (tsc) before converting components; if typing ~505 keys fails, stop and report.
- **P17**: `LoopPlanCard.tsx` "Plan summary" is Task 8's (the inventory's T3 tag is wrong).
- **P18**: apply Task 4's golden insertions bottom-up.
- **P5, P6, P7, P9, P16**: minor; P9 accepted (language names are fixed by spec §4); P16 — each implementer adds a named deletion mutation for every new `t`/`enumText` site its criteria can see, and lists the rest in its report.

## Global Constraints

- **Repository:** `/Users/biran/code/skills/loop/Orca`, local commits only on the branch (or worktree branch) the controller names. Never push, merge into `main`, delete a branch or a worktree (Rule 15).
- **Language (spec §2, session memory):** this plan, code, code comments and commit messages are English. Chinese appears only as values in `web/src/locales/zh.ts` (and as expected values in criteria that pin those values).
- **English is byte-identical (spec §2 last bullet):** every English resource value reproduces today's rendered text byte for byte, including leading/trailing spaces, `·` separators and `(s)` forms. JSX whitespace collapses exactly as React renders it (a newline plus indentation between two words is one space); the tables below already give the rendered text.
- **Dependencies (spec §2):** web workspace only, caret ranges like the workspace's other dependencies (Rule 11), the lock file pins them; bundled by vite, nothing fetched at run time.
- **i18next options (spec §2, §9 C1):** `initAsync: false`, `fallbackLng: "en"`, `supportedLngs: ["en", "zh"]`, `load: "languageOnly"`, `interpolation.escapeValue: false`. Detection: `caches: []` (spec §4, §9 I7) — only the switch writes `orca.panel.lang`, wrapped like `writeTheme`. The panel reads `i18n.resolvedLanguage`, never `i18n.language`, for the switch and for `<html lang>`.
- **Keys by area (spec §2):** `nav`, `shell`, `common`, `decisions`, `chains`, `control`, `recovery`, `budget`, `loopPlan`, `agents`, `metrics`, `panelErrors`, `enums`. The refusal table `zhErrors` is Chinese-only, typed `Record<string, string>`, excluded from key parity (spec §3.2, §6.2).
- **Plurals:** only the loop summary's two counts use `_one`/`_other`; Chinese carries both keys with the same text (spec §2). Every other count keeps today's English form, and a non-plural key never takes a parameter named `count` (i18next would look for plural forms).
- **Mutations (Rule 15)** only in `git clone --local` copies:
  ```bash
  SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad
  REPO=/Users/biran/code/skills/loop/Orca   # or the worktree the controller names
  M="$SCRATCH/mut-<task>"
  /usr/bin/git clone --local "$REPO" "$M" > "$SCRATCH/<task>-clone.txt" 2>&1; echo rc=$?
  ln -s "$REPO/node_modules" "$M/node_modules"; ln -s "$REPO/web/node_modules" "$M/web/node_modules" 2>/dev/null
  for f in <every file this Task created or modified>; do mkdir -p "$M/$(dirname "$f")"; cat "$REPO/$f" > "$M/$f"; cmp "$REPO/$f" "$M/$f" || echo "COPY-DIFF $f"; done > "$SCRATCH/<task>-copy.txt" 2>&1; echo rc=$?
  ```
  (`<task>-copy.txt` must be empty; a file the Task deleted is deleted in `$M` too.) Per mutation: make the exact edit in `$M`, run the named criterion from `$M` into `$SCRATCH/<task>-<mutation>.txt`, expect `rc=1` with the named test red **and seen** (read the file), then restore with `cat "$REPO/$f" > "$M/$f"; cmp "$REPO/$f" "$M/$f" > "$SCRATCH/<task>-<mutation>-restore.txt" 2>&1; echo rc=$?` (expect `rc=0`, empty file). Clones are kept (deleting needs the human). **Every new branch gets a named deletion mutation seen red** (Rule 9, spec §6 last line); each Task lists its mutations.
- **Evidence (Rule 14):** every run is `<command> > "$SCRATCH/<name>.txt" 2>&1; echo rc=$?`, then the file is read whole with the Read tool. Never `| tail`, `| grep`, `| head`. Git is `/usr/bin/git` (the rtk hook rewrites `git`). Before running criteria: `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`.
- **Commands:** web criteria and web typecheck: `npm run check --workspace web` (tsc, then every web test); one web file: `(cd web && ../node_modules/.bin/vitest run tests/<file>)`; root typecheck: `npm run typecheck`; one root file: `./node_modules/.bin/vitest run <file>`. The main tree never runs `npm run build` or the full root suite (Task 12 does, in a clone).
- **Known load flakes:** `driverLanding`, `driverRecovery`, `driverProgress` R2, `controlShutdown`, `handoffE2E`, `ccloopPort`. A red one is not a regression if its single-file rerun passes 3/3 (record `uptime` next to the reruns).
- **Existing criteria (spec §6.1, H18):** only the rewrites named in each Task's "Existing criteria rewritten" block are made; each carries a comment line `// Rewritten under human ruling H18 (2026-10-01) for panel i18n.` (JSON fixtures carry none). Any other existing criterion that turns red ⇒ stop and report it by full name.
- **Rule 17:** no criterion here writes outside `mkdtemp` roots or jsdom's in-memory storage; none touches `~/.orca`.
- **Commit trailer** — every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
  ```

