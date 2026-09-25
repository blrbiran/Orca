# Spec review brief — agent selection (Orca controller session 75ec878e, 2026-09-26)

You are an independent reviewer of a DESIGN SPEC (not code). Write your report in Chinese prose (code identifiers stay English).

## What to review
- Spec: `/Users/biran/code/skills/loop/Orca/docs/superpowers/specs/2026-09-26-agent-selection-design.md` (Orca commit subject `docs(spec): design agent selection: installation table, layered defaults, claude over control`).
- It changes two repos: Orca (`/Users/biran/code/skills/loop/Orca`) and ccloop (`/Users/biran/code/skills/loop/ccloop`). Read the real code in BOTH to check every factual claim.
- Upstream specs it builds on (read the parts you need): Orca `docs/superpowers/specs/2026-09-25-handoff-delivery-design.md` (§13.4 > §13 > §12 > §11 > body), `2026-09-25-execution-driver-design.md` (§11, §12 win), `2026-09-19-web-recoverable-control-design.md`, ccloop G1 spec `docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md` if present.

## Human rulings already made (do NOT reopen; flag only if the spec contradicts them)
Merge "claude over control" with layered defaults in one round; "user" = local operator keyed by operatorId; installation table is machine fact + selection travels in the start envelope ("A+C"); detect-then-tweak installation table modelled on cc-switch; `--adapter` form replaced outright (no compat); `configHash` redefined as hash of the materialized config; stream-json usage deferred; profile v2 drops adapter identity fields; panel UI fully in this round. Project is not live — big breaking changes are allowed.

## What I want you to hunt (priority order)
1. **Cross-repo vocabulary mismatches** — the #1 root cause in this project's history (5 occurrences: `missing`, aborted-phase usage `null`, `isolated`…). For every field/word that crosses the Orca↔ccloop wire (selection, configHash, capabilities v3, envelope v2, installationHash-free design, contextWindowTokens, killGraceMs, provenance), ask: does each side mean the same thing? Where does each side produce/consume it? Cite file:line.
2. **Places the spec misses** — every consumer of things it changes. E.g. grep both repos for `configHash`, `capabilities`, `protocol: 1`/`protocol: 2`, `adapterConfig`, `ORCA_CCLOOP_ADAPTER_CONFIG`, `executionProfileSnapshotSchema`, `profileHash`, `handoffGraceMsOf`, `parseCodexConfig`, `CodexAdapter`, `--adapter`. Is every consumer covered by the spec's scope? Especially: estimate runs (`webService.ts` uses `configHash: estimate.profile.profileHash` — does the spec handle that?), continuation (`continuation.ts`), plan import, panel views, scheduler `ccloopRunner.ts`, legacy `service.ts`, resume bundles, recovery.
3. **Hollow guarantees** — any claimed invariant that is vacuously true or not actually enforced by a named mechanism (the spec itself found one: empty `processes.json` makes `isolated:true` vacuous). Check I1–I4 and the "layer reset on agent change" rule, the freeze-at-confirm rule, "operator default change does not affect confirmed groups".
4. **Internal contradictions / ambiguity** — two sections saying different things; a rule that can be read two ways; a table row inconsistent with prose.
5. **Criteria (§9)** — would each criterion actually go red if the behaviour broke? Any criterion whose mutation would stay green? Any behaviour with no criterion?
6. **Rule 17 (writes outside the repo)** and security: table file handling, draft file, modes, symlinks, secrets.
7. Feasibility risks for the ClaudeAgentAdapter (process group, registration order, runner) — read `src/runtime/codex/runCodexPhase.ts`, `src/runtime/claude/*`, `scripts/claude-phase-runner.mjs`, `src/control/worker.ts`, `src/control/stopProof.ts`.

## Hard prohibitions
- **Read-only.** Do NOT modify, create or delete any file in either repo (except your report file below). Do NOT `git stash`, `checkout`, `reset`, `restore`, `commit`, `merge`, `push`, or temporarily move/revert any file — not even "to test something and put it back".
- Do not run the full test suites or anything CPU-heavy (a production daemon runs on this machine). Targeted `grep`/`sed -n`/reading is enough. If you must run something, redirect output to a file under `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/` and read it back whole (no pipes into grep/tail/head for verification).
- Do not sign as or claim human authorization. Do not estimate costs.
- Every line number you cite must come from your own reading in this session.

## Output
Write the report to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-26-agent-selection/spec-review.md`:
- Findings grouped **Critical / Important / Minor**, each with: spec section, the claim, the evidence (file:line from the real code, quoted briefly), why it matters, a concrete suggested fix to the spec.
- Critical = the design as written would ship broken behaviour, a hollow guarantee, or a cross-repo mismatch. Important = a missing consumer / ambiguity that would mislead the plan. Minor = wording.
- A short "verified OK" list of the spec's factual claims you checked and found accurate (so the controller knows what was covered).
Then return a ≤200-word summary (counts per severity + the Critical titles).
