# Accounts, per-model usage and spend caps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, **in a new session** (decided by the controller that wrote this plan; the writing-plans skill's execution question is not asked). Steps use checkbox (`- [ ]`) syntax for tracking. Ledger: `.superpowers/sdd/2026-10-07-accounts-and-spend-caps/progress.md` (gitignored; commit with `git add -f`).

**Goal:** Make the Web UI a real login boundary (accounts, JWT sessions, an `agent` principal on the socket), book every applied usage delta per model into a ledger, and let an owner set token spend caps that gate every claim and bound agent-channel imports.

**Architecture:** Accounts live in a per-user store `<control root>/accounts.sqlite` beside `jwt.key` and `initial-password` (decision D1); an auth middleware on the TCP app turns a cookie into a `user` principal, the socket's header gate turns a client into an `agent` principal, and one permission table (`src/panel/permissions.ts`) decides human-only. Usage, caps and the calendar live in the control store (migration 7→8): `recordUsage` writes `usage_ledger` rows in the same transaction that books `group.used`; `spendCaps.ts` computes headroom; the driver's three claim paths and the import path consult it. ccloop gains an optional per-model `byModel` on usage events (Part B), which Orca accepts but does not need, so Part A never waits on the pin.

**Tech Stack:** TypeScript (ESM, Node ≥ 22.13.1), express 5, zod 3, node:sqlite, node:crypto (scrypt, HMAC-SHA256), vitest 5, React 19 + i18next (web).

**Spec:** `docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md` (human-approved 2026-10-07), plus §13 plan-time decisions appended by Task 0. Read also `docs/superpowers/specs/2026-10-07-agent-entry-design.md` §5, §13, §14.

## Global Constraints

- Never touch the real `~/.orca`, never run a paid model, never restart the human's panel, never push, never merge into `main` from a branch (CLAUDE.md Rules 15, 17). Part B never touches ccloop's `main` checkout (see Part B).
- Every criterion relocates `ORCA_CONTROL_DIR` (accounts, `jwt.key`, `initial-password` live under it), `ORCA_CORRECTIONS_DIR`, and, when it spawns, HOME. `tests/setup/relocateUserData.ts` already relocates `ORCA_CONTROL_DIR` and snapshots the real `~/.orca` after each file — a criterion that writes there goes red by name.
- New directories `0o700`, new files `0o600`, created with an explicit mode (`openSync(path, "wx", 0o600)`, `mkdirSync(dir, { mode: 0o700 })`); an existing file's or directory's mode is never changed (Rule 17).
- Password hash: `scrypt$131072$8$1$<salt b64>$<hash b64>`, 32-byte salt, 64-byte key, `maxmem: 256 * 1024 * 1024` (decision D17). Minimum length for changed and added passwords: 12. Initial password: first 16 hex chars of SHA-256 over 32 random bytes.
- JWT: HS256, claims exactly `{sub,roles,sid,iat,exp}` (seconds), cookie `orca_at` (`HttpOnly; SameSite=Strict; Path=/`); CSRF cookie `orca_csrf` (`SameSite=Strict; Path=/`, not HttpOnly) and header `x-orca-csrf` on every non-GET except `POST /api/auth/login`. Lifetime `--session-days <n>` 1..30, default 15.
- Error codes (new): `login-required` 401, `login-failed` 401, `login-throttled` 429, `password-change-required` 403, `csrf-required` 403, `password-too-short` 400, `user-name-invalid` 400, `user-name-taken` 409, `owner-required` 403, `control-limit-over-cap-headroom` 403, `spend-cap-reached` (projected on groups, never a command outcome), `usage-query-invalid` 400. `control-verb-human-only` / `control-field-human-only` keep their names and now also answer a `member` on the Web.
- Principal labels in the command ledger: `user:<userId>`, `agent:<client>` (column `commands.principal`, decision D3). `actorId` is unchanged.
- Usage ledger `source` ∈ `run-work|run-handoff|estimate|clarify|split|pre-ledger`; `quality` ∈ `reported|unattributed|breakdown-mismatch`. Caps sum `tokens` over rows whose quality is not `breakdown-mismatch`.
- Per-model entry total = `input + output + cacheRead + cacheWrite`, where `input` is non-cached input (decision D7).
- Code, comments, commits, ledger, spec text: English. Commits end with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_015m3hAnKcXK1pE3xYwnLTXz` (the implementing session uses its own session line). Use `/usr/bin/git`, `/bin/rm`, `/bin/cp`. Stage named paths only (another agent writes in this repo); never `git add -A`.
- Verification output is redirected to a file and read back whole; never piped through grep/tail (Rule 14). `$SCRATCH` is the session scratchpad.
- Rule 9: every new branch has a named deletion mutation, run only in a `git clone --local` copy (`$SCRATCH/mut-tN`, uncommitted work copied in with `cat src > copy/src`), seen red, restore proven by `git diff | wc -c` and `git diff --cached | wc -c` both `0`. Each task lists its own.
- Success criteria are commands with exit codes. "Green" = the named command exits 0 and its output file shows no failed and no skipped test that was not skipped before.
- The human pre-authorized: rewrites of existing criteria follow the controller's recommendation and are reported at the end. Each rewrite is recorded as one `Ruling:` line in the ledger (file, what changed, which spec item it encodes) — the controller does not stop for them. This does **not** extend to ccloop (Orca Rule 16; ccloop Rules 15 and 18): in Part B any existing ccloop criterion that goes red stops Part B and goes to `awaitingHuman`.

## Review Focus

1. **A panel with no control store** (`--no-control`, no `--repo`, or the store held by another panel): the Web UI must still require and accept a login. Pinned in Task 3 (accounts are not in the control store, D1) — test "a --no-control panel answers 401 without a cookie and 200 after login".
2. **A same-user process that reads `initial-password` first**: the account must still force a change on first login and show a notice. Pinned in Task 3 ("the initial password reaches only the change step").
3. **A stale tab after a panel restart**: the cookie must still work (persisted key), and after `orca user rotate-key` it must stop at once. Pinned in Task 3 (restart test) and Task 6 (rotate-key test).
4. **A cap lowered below what is already committed** (two runs in flight): no new claim, nothing aborted, and the group resumes by itself when the cap is raised or the week rolls over. Pinned in Task 10 (gate tests with injected clock).
5. **A run whose breakdown arrives only for some phases** (an aborted claude phase has no `modelUsage`): later events must not be attributed against an unknown baseline. Pinned in Task 7 ("an unattributed event makes later breakdowns unattributed").

---

## Plan-time decisions (Task 0 appends these verbatim to the spec as §13)

- D1. Accounts (`users`, `sessions`, `security_events`, plus `security_acks`) live in `<control root>/accounts.sqlite`, not in the control store's migration 7→8. A panel serves `/api/*` with no control store at all (`--no-control`, no `--repo`, or the store held elsewhere — `resolveControlOptions` turns 11 of 40 boots off), and legacy `--repo` mode has one store per repository, which would split users; the control root is where §3.2/§3.3 already put `jwt.key` and `initial-password`. Usage, caps and calendar stay in the control store (7→8).
- D2. §3.2's default owner (the revision after review) supersedes §7's first-run page and §9's "a panel with no users". A panel creates the owner at start, so it always has a user; `orca user add` remains for added users.
- D3. A command's `actorId` stays the panel operator id: it is inside the raw command hash (cross-channel replay, N2 C12) and scopes agent preferences. The principal is a new column `commands.principal` (`user:<id>` / `agent:<client>`), written beside N2's `client`.
- D4. `committed(scope)` is the sum of the remaining grant tokens (work + handoff) of active runs (`runs.active=1`) whose group is in scope — "tokens already promised to claimed runs". A group's `committedRemaining` also holds unclaimed allocations, including the grant being claimed, which would count it twice. The agent ceiling compares the import's fresh group limit (without carried clarifying spend) with headroom computed without the importing group's own runs.
- D5. The three cap verbs use a new command scope `spend` (key `@spend`, revision in `spend_settings`), not `operator`, whose revision is `agent_preferences.revision`.
- D6. Cap and calendar changes are recorded by the command ledger (verb, payload, principal), not `security_events`, which lives in the accounts store (no cross-database transaction).
- D7. `byModel` entries reconcile as `Σ(input + output + cacheRead + cacheWrite) = cumulative.tokens`, with `input` = non-cached input (claude: `input_tokens`; codex: `input_tokens − cached_input_tokens`). This is each adapter's own normalization (claude counts cache reads and writes, codex's input already holds its cached part). ccloop omits the field when it cannot tell (absent, so earlier events hash identically); Orca accepts absent or `null`.
- D8. ccloop's `usageBreakdown` flag is a sibling of `singleCallExecution` in the capabilities answer, outside the frozen seven-key view. Orca accepts it optionally and consumes no behavior from it. Its ccloop task waits for the human to name `tests/control/singleCallCapability.test.ts` C1 (ccloop Rule 15), or to drop the flag.
- D9. A spend-capped claim defers its wake (the handler answers "not delivered") instead of writing a recovery blocker, so a raised cap or a new period resumes the group without a command. The block is visible in `spend_cap_blocks` and as `spendCapBlock` on the group and requirement views.
- D10. The agent-ceiling refusal is thrown inside the command transaction as a non-`ControlError` (`AgentCeilingRefusal`): the transaction rolls back, no ledger row is written, the route answers 403 — the human-only gate's behavior (the commandId is not burned).
- D11. The ready line drops `token=`: `orca-panel ready url=<url>`.
- D12. `orca user rotate-key` replaces `jwt.key` and revokes every session; the running panel keeps its loaded key until it restarts, and revocation logs everyone out at once.
- D13. Login throttling: after 5 consecutive failures for a name, attempts for that name answer 429 `login-throttled` for `min(2^(n−5), 300)` seconds (n = consecutive failures); nothing sleeps; one `login-failed` summary row per streak.
- D14. Corrections and reviews keep `by = --by` (§3.4 changes only the command ledger's actor).
- D15. Single-call usage (estimate, clarify, split) reaches `usage_ledger` through the same collect events and `recordUsage`; `singleCallLedger.ts` needs no change; `source` is derived from the run's phase and purpose.
- D16. A usage event whose token delta is 0 writes no ledger row (mechanical handoff events would otherwise add a row per run).
- D17. scrypt needs `maxmem` 256 MiB (N=2^17, r=8 takes 128 MiB; Node's default limit is 32 MiB).
- D18. A mismatched breakdown writes one authoritative row (`model NULL`, quality `unattributed`, the event's token delta) plus the reported per-model rows with quality `breakdown-mismatch`; caps and totals read only the former.
- D19. The legacy scheduler's `claimWork` (`src/control/budget.ts`, used by `orca scheduler`) is not gated in this round; the Web driver, estimate, clarify and split claims are. Recorded as a known gap, not silently skipped.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/control/migrations.ts`, `src/control/store.ts` | modify | `schema7To8`, version 8 |
| `src/control/commandClient.ts` | modify | context carries `principal`; `commandPrincipalFor` |
| `src/control/commandLedger.ts` | modify | write `principal`; `spend` scope |
| `src/panel/accounts/password.ts` | create | scrypt hash/verify |
| `src/panel/accounts/jwt.ts` | create | HS256 sign/verify |
| `src/panel/accounts/signingKey.ts` | create | `jwt.key` load/create/rotate |
| `src/panel/accounts/store.ts` | create | accounts SQLite (users, sessions, security events, acks) |
| `src/panel/accounts/initialOwner.ts` | create | default owner + `initial-password` |
| `src/panel/auth.ts` | create | `PanelAuth`: login, authenticate, refresh, logout, throttle |
| `src/panel/authRoutes.ts` | create | `/api/auth/*` routes and the `/api` middleware |
| `src/panel/permissions.ts` | create | principals and the human-only decision |
| `src/panel/accounts/userCommand.ts`, `src/panel/accounts/ttySecret.ts` | create | `orca user add|passwd|disable|list|rotate-key` |
| `src/panel/api.ts`, `src/panel/staticFiles.ts`, `src/panel/server.ts`, `src/panel/rejection.ts`, `src/panel/controlErrors.ts`, `src/cli.ts` | modify | token removal, auth wiring, ready line, `--session-days` |
| `src/panel/token.ts` | delete | (Task 4) |
| `src/control/usageLedger.ts` | create | rows per applied delta |
| `src/control/usage.ts`, `src/control/types.ts`, `src/control/ccloopPort.ts` | modify | `byModel`, ledger rows, `usageBreakdown` |
| `src/control/usageCalendar.ts` | create | calendar read, period bounds (Intl) |
| `src/control/usageQuery.ts` | create | `GET /api/control/usage` body |
| `src/control/spendCaps.ts` | create | caps, committed, headroom, gate, `AgentCeilingRefusal` |
| `src/control/spendCommands.ts` | create | set/clear cap, set calendar |
| `src/control/webProtocol.ts` | modify | verbs, payloads, `spend` target, views |
| `src/control/webDispatch.ts`, `src/control/webService.ts`, `src/control/requirementCalls.ts`, `src/control/planImport.ts`, `src/control/requirementCommands.ts` | modify | claim gate, agent ceiling |
| `src/panel/controlApi.ts`, `src/panel/controlSocket.ts`, `src/panel/humanOnly.ts`, `src/panel/controlViews.ts` | modify | principal, gate, routes, views |
| `web/src/auth.ts`, `web/src/AuthGate.tsx`, `web/src/UsagePanel.tsx` | create | login, account bar, notices, usage panel |
| `web/src/api.ts`, `web/src/controlApi.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/ControlGroupView.tsx`, `web/src/controlTypes.ts`, `web/src/locales/{en,zh}.ts`, `web/index.html` | modify | |
| `skills/orca-control/SKILL.md`, `README.md` | modify | |
| `tests/panel/fixtures/auth.ts` | create | seed owner, log in, authed fetch |
| ccloop (Part B) `src/control/usage.ts`, `src/control/command.ts`, `src/control/worker.ts`, `src/control/singleCall.ts`, `src/controller/runLoop.ts`, `src/runtime/types.ts`, `src/runtime/codex/protocol.ts`, `src/runtime/codex/codexAdapter.ts`, `src/runtime/claude/claudeAgentAdapter.ts`, `scripts/claude-phase-runner.mjs`, `scripts/claude-stream.mjs` | modify | `byModel` |

## Rewrite inventory (existing criteria that change)

Each entry is rewritten in the named task and recorded as one ledger line `Ruling: rewrite <file> — <change> — encodes spec <§>` (pre-authorized; no stop). Nothing in this list is loosened: every assertion keeps its intent and moves to the login path.

| # | File | Task | Change |
|---|---|---|---|
| 1 | `tests/control/requirementRecords.test.ts` | 1 | `schemaVersion` "7" → "8" |
| 2 | `tests/control/commandClient.test.ts` | 1 | the two version expectations "7" → "8" (the 6→7 upgrade test still drops `client` and expects the final version) |
| 3 | `tests/panel/fixtures/controlPanel.ts` | 4 | `buildApi` gets `auth`; `get`/`command` carry the cookie and CSRF instead of `x-orca-token`; `PANEL_TOKEN` removed (covers its 8 importing files) |
| 4 | `tests/panel/metricsApi.test.ts` | 4 | token → login; "401 without a token" → without a cookie / with a cookie signed by another key; "serves the token-injected index.html" → index.html carries no credential |
| 5 | `tests/panel/staticFiles.test.ts` | 4 | anchor-missing refusal and injection tests → no anchor, bytes served verbatim |
| 6 | `tests/panel/endToEnd.test.ts` | 4 | `parseReadyLine` accepts `orca-panel ready url=<url>` only (D11) |
| 7 | `tests/panel/controlReadApi.test.ts` | 4 | token header → session; "401 without token" cases → `login-required` |
| 8 | `tests/panel/controlViewOrder.test.ts` | 4 | token → session |
| 9 | `tests/panel/correctApi.test.ts` | 4 | token → session (+ CSRF on POST) |
| 10 | `tests/panel/decisionsApi.test.ts` | 4 | token → session |
| 11 | `tests/panel/todo.test.ts` | 4 | token → session |
| 12 | `tests/panel/projectsApi.test.ts` | 4 | token → session (+ CSRF) |
| 13 | `tests/panel/projectsFileMode.test.ts` | 4 | token → session |
| 14 | `tests/panel/security.test.ts` | 4 | token assertions → cookie assertions (Host gate cases unchanged) |
| 15 | `tests/panel/chainsApi.test.ts` | 4 | token → session (+ CSRF) |
| 16 | `tests/panel/controlMount.test.ts` | 4 | token → session |
| 17 | `tests/panel/controlSocket.test.ts` | 4 | C2/C15 Web probe with a session instead of `panel.token` |
| 18 | `tests/panel/controlSocketGate.test.ts` | 4, 5 | Web POSTs with an owner session; C9 "over the Web it is not" stays (owner), plus a member case in Task 5 |
| 19 | `tests/memory/memoryApi.test.ts` | 4 | token → session |
| 20 | `tests/panel/refusalCoverage.test.ts` | 4 | add-only: new codes in `BY_HAND` |
| 21 | `tests/panel/humanOnly.test.ts` | 9 | C19 walker also counts `spendTokensSchema`; expects the three new verbs human-only; `humanOnlyRefusal` cases unchanged |
| 22 | `tests/entry/skill.test.ts` | 9 | 22 → 25 routes; `schemaByVerb` gains three; phrase "not a security boundary" → "is a boundary at the panel's interfaces" |
| 23 | `web/tests/controlPanel.test.tsx` | 4 | expects `x-orca-csrf` on POST and no `x-orca-token` |
| 24 | `web/tests/evidenceLink.test.tsx` | 4 | same |
| 25 | `web/tests/taskLabels.test.tsx` | 4 | same |
| 26 | `web/tests/shell.test.tsx` | 4 | the token mention → none |
| 27 | `scripts/verify-panel.ts` | 4 | parses the new ready line; logs in with `initial-password`, changes the password, uses the cookie |
| 28 | `scripts/live-panel-http-acceptance.ts` | 4 | same login flow (paid script, not run in the gate; typecheck only) |

Completeness check (Task 4, Step 9): `rg -n -e 'x-orca-token' -e '__ORCA_TOKEN__' -e 'orca-panel-token' -e 'TOKEN_ANCHOR' -e 'token-required' -e 'panel\.token' -e 'started\.token' -e 'token=' tests web/src web/tests web/index.html scripts src > $SCRATCH/t4-scan.txt; echo rc=$?` → `rc=1` (no match). A match not in this table is added to it (ledger Ruling line) and rewritten the same way.

---

### Task 0: Record plan-time decisions in the spec

**Files:** Modify: `docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md` (append only, Rule 13)

- [ ] **Step 1:** Append `## 13. Plan-time decisions (2026-10-07, session 9a20ac38)` with an opening line "Earlier sections are kept as written; this section records decisions taken while planning." followed by D1–D19 copied verbatim from this plan.
- [ ] **Step 2:** Verify: `git diff --stat docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md > $SCRATCH/t0.txt; git diff docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md | rg -c '^-[^-]' > $SCRATCH/t0-removed.txt; echo rc=$?` → `rc=1` (no removed line).
- [ ] **Step 3: Commit** `docs(spec): record the accounts plan's decisions` (stage only the spec).

---

### Task 1: Store migration 7→8 and the principal column

**Files:**
- Modify: `src/control/migrations.ts`, `src/control/store.ts:86` (accept "7"), `src/control/commandClient.ts`, `src/control/commandLedger.ts` (`persistCommandOutcome` writes `principal`), `tests/control/requirementRecords.test.ts:27`, `tests/control/commandClient.test.ts:44,60` (inventory 1, 2)
- Test: `tests/control/schema8.test.ts`

**Interfaces:**
- Produces: `schemaVersion === "8"`; tables `usage_ledger`, `spend_caps`, `usage_calendar`, `spend_settings`, `spend_cap_blocks`; column `commands.principal TEXT`; `withCommandContext<T>(commandId: string, context: { client: string; principal: string }, fn: () => T): T`; `commandPrincipalFor(commandId: string): string | null`. `withCommandClient(commandId, client, fn)` stays as `withCommandContext(commandId, { client, principal: client === "web" ? "web" : \`agent:${client}\` }, fn)` until Task 5 replaces its callers.

- [ ] **Step 1: Failing test** `tests/control/schema8.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandClientFor, commandPrincipalFor, withCommandContext } from "../../src/control/commandClient.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function stateDir() { const root = await mkdtemp(join(tmpdir(), "s8-")); roots.push(root); return join(root, "s"); }
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name));

describe("schema 7 to 8 (accounts spec §5, §6, D3)", () => {
  it("a fresh store is version 8 with the usage, cap and principal surfaces", async () => {
    const store = await openControlStore({ stateDir: await stateDir() });
    try {
      expect(schemaVersion).toBe("8");
      expect(tables(store.db)).toEqual(expect.arrayContaining(["usage_ledger", "spend_caps", "usage_calendar", "spend_settings", "spend_cap_blocks"]));
      expect(store.db.prepare("PRAGMA table_info(commands)").all().map((row) => String(row.name))).toContain("principal");
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get()).toMatchObject({ n: 0 });
    } finally { store.close(); }
  });

  it("a version-7 store upgrades and books each group's existing usage as one pre-ledger row, in no period", async () => {
    const dir = await stateDir();
    (await openControlStore({ stateDir: dir })).close();
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    for (const t of ["usage_ledger", "spend_caps", "usage_calendar", "spend_settings", "spend_cap_blocks"]) raw.exec(`DROP TABLE ${t}`);
    raw.exec("ALTER TABLE commands DROP COLUMN principal");
    raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run("g1", JSON.stringify({ plan: { repoId: "r1" }, used: { tokens: 1234, activeMs: 0, attempts: 0, sessions: 0 } }));
    raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run("g2", JSON.stringify({ requirement: { repoId: "r2" }, used: { tokens: 5, activeMs: 0, attempts: 0, sessions: 0 } }));
    raw.prepare("UPDATE meta SET value='7' WHERE key='schemaVersion'").run();
    raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()).toMatchObject({ value: "8" });
      const rows = store.db.prepare("SELECT applied_at,group_id,repo_id,source,model,tokens,quality FROM usage_ledger ORDER BY group_id").all();
      expect(rows).toEqual([
        { applied_at: 0, group_id: "g1", repo_id: "r1", source: "pre-ledger", model: null, tokens: 1234, quality: "unattributed" },
        { applied_at: 0, group_id: "g2", repo_id: "r2", source: "pre-ledger", model: null, tokens: 5, quality: "unattributed" },
      ]);
    } finally { store.close(); }
  });

  it("the command context answers client and principal only for its own commandId", async () => {
    await withCommandContext("cmd-a", { client: "web", principal: "user:u1" }, async () => {
      expect(commandPrincipalFor("cmd-a")).toBe("user:u1");
      expect(commandClientFor("cmd-a")).toBe("web");
      expect(commandPrincipalFor("cmd-b")).toBe(null);
    });
    expect(commandPrincipalFor("cmd-a")).toBe(null);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/control/schema8.test.ts > $SCRATCH/t1.txt 2>&1; echo rc=$?` → `rc=1`; read: `commandPrincipalFor` not exported / version "7".

- [ ] **Step 3: Migration.** In `src/control/migrations.ts` set `schemaVersion = "8"` and add after `schema6To7`:

```ts
// Accounts spec §5.1, §5.2, §6.1, D3, D4, D5, D9: the usage ledger (with each group's existing usage as one pre-ledger
// row, applied_at 0, so it counts in totals and in no week or month), caps, the calendar, the spend scope's revision,
// the spend-cap block of a deferred claim, and the principal that delivered a command.
export const schema7To8 = `ALTER TABLE commands ADD COLUMN principal TEXT;
CREATE TABLE usage_ledger(id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, group_id TEXT NOT NULL, repo_id TEXT, run_id TEXT, source TEXT NOT NULL CHECK(source IN ('run-work','run-handoff','estimate','clarify','split','pre-ledger')), model TEXT, input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, tokens INTEGER NOT NULL CHECK(tokens >= 0), quality TEXT NOT NULL CHECK(quality IN ('reported','unattributed','breakdown-mismatch'))) STRICT;
CREATE INDEX usage_ledger_at ON usage_ledger(applied_at);
CREATE INDEX usage_ledger_repo_at ON usage_ledger(repo_id,applied_at);
CREATE TABLE spend_caps(scope TEXT NOT NULL, period TEXT NOT NULL CHECK(period IN ('total','week','month')), tokens INTEGER NOT NULL CHECK(tokens > 0), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(scope,period)) STRICT;
CREATE TABLE usage_calendar(singleton INTEGER PRIMARY KEY CHECK(singleton=1), time_zone TEXT NOT NULL, week_start INTEGER NOT NULL CHECK(week_start BETWEEN 1 AND 7)) STRICT;
CREATE TABLE spend_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision >= 0)) STRICT;
CREATE TABLE spend_cap_blocks(group_id TEXT PRIMARY KEY REFERENCES groups(id), body TEXT NOT NULL) STRICT;
INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality)
  SELECT 0, id, COALESCE(json_extract(body,'$.plan.repoId'), json_extract(body,'$.requirement.repoId'), json_extract(body,'$.projectKey')), NULL, 'pre-ledger', NULL, NULL, NULL, NULL, NULL, COALESCE(json_extract(body,'$.used.tokens'), 0), 'unattributed' FROM groups;
`;
```

Append `+ schema7To8` to `initialSchema` (a fresh store has no groups, so the pre-ledger insert adds nothing). For `migrateSchema`, do **not** append the string: existing downgrade criteria (`tests/control/commandClient.test.ts` 6→7, the version-3/4 criteria of `agentPreferences`/`workspaceSettings`) drop only their own column or table and set an older version, so the 7→8 step meets `principal` and the new tables already present (the same reason `schema5To6` uses `IF NOT EXISTS`). Add instead:

```ts
/** Accounts spec §9: idempotent on a store a criterion downgraded by dropping only its own column or table. */
function migrate7To8(store: DatabaseSync): void {
  const hasPrincipal = store.prepare("PRAGMA table_info(commands)").all().some((row) => row.name === "principal");
  const ledgerExisted = store.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_ledger'").get() !== undefined;
  const [alter, ...rest] = schema7To8.split("\n");
  if (!hasPrincipal) store.exec(alter!);
  store.exec(rest.join("\n").replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ").replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ")
    .split("INSERT INTO usage_ledger")[0]!);
  if (!ledgerExisted) store.exec(`INSERT INTO usage_ledger${schema7To8.split("INSERT INTO usage_ledger")[1]!}`);
}
```

Call `migrate7To8(store)` after the existing exec in every branch of `migrateSchema` (from "1" through "6"), add `else if (fromVersion === "7") migrate7To8(store);` before the `else throw`, and add `&& version !== "7"` in `src/control/store.ts:86`. (If the string surgery reads badly in review, split `schema7To8` into three exported constants — `ALTER`, `TABLES`, `PRE_LEDGER` — and concatenate them for `initialSchema`; record the choice.)

- [ ] **Step 4: Context.** Replace the body of `src/control/commandClient.ts` below the constants with:

```ts
const current = new AsyncLocalStorage<{ commandId: string; client: string; principal: string }>();

/** Accounts spec §3.5, D3: client (N2 §6) and principal ride beside the command, in neither hash. */
export function withCommandContext<T>(commandId: string, context: { client: string; principal: string }, fn: () => T): T {
  return current.run({ commandId, ...context }, fn);
}
/** Kept for its callers until Task 5 passes a principal. */
export function withCommandClient<T>(commandId: string, client: string, fn: () => T): T {
  return withCommandContext(commandId, { client, principal: client === "web" ? "web" : `agent:${client}` }, fn);
}
const forCommand = (commandId: string) => { const c = current.getStore(); return c !== undefined && c.commandId === commandId ? c : null; };
export function commandClientFor(commandId: string): string | null { return forCommand(commandId)?.client ?? null; }
export function commandPrincipalFor(commandId: string): string | null { return forCommand(commandId)?.principal ?? null; }
```

In `persistCommandOutcome` (`src/control/commandLedger.ts`, the insert that writes `client`) add `principal` after `client` with one more `?` and value `commandPrincipalFor(rawCommand.commandId)`.

- [ ] **Step 5:** Rewrite inventory 1 and 2 ("7" → "8"); ledger `Ruling:` lines.
- [ ] **Step 6: Run** `npx vitest run tests/control/schema8.test.ts tests/control/commandClient.test.ts tests/control/requirementRecords.test.ts tests/control/commandLedger*.test.ts > $SCRATCH/t1g.txt 2>&1; echo rc=$?` → `rc=0`; `npm run typecheck > $SCRATCH/t1tc.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 7: Mutations (clone):** (a) delete `+ schema7To8` from `initialSchema` → fresh-store test red; (b) delete the `fromVersion === "7"` branch → upgrade test red; (c) delete the pre-ledger exec in `migrate7To8` → upgrade test red (rows `[]`); (d) in `forCommand` drop `c.commandId === commandId &&` → context test red (`cmd-b`); (e) drop the `hasPrincipal` guard → `tests/control/commandClient.test.ts` 6→7 upgrade red (duplicate column).
- [ ] **Step 8: Commit** `feat(control): migrate the store to version 8 for usage, caps and principals`.

---

### Task 2: Accounts core (password, JWT, key, store, default owner)

**Files:**
- Create: `src/panel/accounts/password.ts`, `src/panel/accounts/jwt.ts`, `src/panel/accounts/signingKey.ts`, `src/panel/accounts/store.ts`, `src/panel/accounts/initialOwner.ts`
- Test: `tests/panel/accounts.test.ts`

**Interfaces:**
- Produces:
  - `password.ts`: `MIN_PASSWORD_LENGTH = 12`; `hashPassword(password: string): string`; `verifyPassword(password: string, stored: string): boolean`.
  - `jwt.ts`: `type Role = "owner" | "member"`; `interface AccessClaims { sub: string; roles: Role[]; sid: string; iat: number; exp: number }`; `signAccessToken(key: Buffer, claims: AccessClaims): string`; `verifyAccessToken(key: Buffer, token: string, nowSec: number): AccessClaims | null`.
  - `signingKey.ts`: `JWT_KEY_FILE = "jwt.key"`; `loadOrCreateSigningKey(root: string): Buffer` (throws `Error("jwt-key-invalid")` when the file is not 32 bytes or not a regular file); `rotateSigningKey(root: string): void`.
  - `store.ts`: `ACCOUNTS_FILE = "accounts.sqlite"`; `USER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/`; `class AccountsRejection extends Error { code: string; status: number }`; `interface UserRow { id: string; name: string; roles: Role[]; createdAt: number; disabledAt: number | null; mustChangePassword: boolean }`; `type SecurityEventKind = "user-created" | "password-changed" | "user-disabled" | "login-failed" | "key-rotated"`; `openAccountsStore(root: string): AccountsStore` with methods `userCount(): number`, `listUsers(): UserRow[]`, `findByName(name): (UserRow & { passwordHash: string }) | null`, `findById(id): UserRow | null`, `createUser(input: { name: string; password: string; roles: Role[]; mustChangePassword?: boolean; now: number; by: string; allowShort?: boolean }): UserRow`, `setPassword(userId: string, password: string, now: number, by: string): void`, `setName(userId: string, name: string): void`, `disableUser(userId: string, now: number, by: string): void`, `createSession(userId: string, now: number, expiresAt: number): string`, `extendSession(sid: string, expiresAt: number): void`, `sessionActive(sid: string, userId: string, now: number): boolean`, `revokeSession(sid: string, now: number): void`, `revokeAllSessions(now: number): void`, `appendSecurityEvent(kind: SecurityEventKind, body: Record<string, unknown>, now: number): number`, `openNotices(): Array<{ seq: number; at: number; kind: SecurityEventKind; body: unknown }>`, `acknowledge(seq: number, by: string, now: number): void`, `close(): void`.
  - `initialOwner.ts`: `INITIAL_PASSWORD_FILE = "initial-password"`; `ensureDefaultOwner(store: AccountsStore, root: string, by: string, log: (line: string) => void, now: number): { created: boolean }`.

- [ ] **Step 1: Failing tests** `tests/panel/accounts.test.ts`:

```ts
import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/panel/accounts/password.js";
import { signAccessToken, verifyAccessToken } from "../../src/panel/accounts/jwt.js";
import { JWT_KEY_FILE, loadOrCreateSigningKey, rotateSigningKey } from "../../src/panel/accounts/signingKey.js";
import { ACCOUNTS_FILE, openAccountsStore } from "../../src/panel/accounts/store.js";
import { INITIAL_PASSWORD_FILE, ensureDefaultOwner } from "../../src/panel/accounts/initialOwner.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "ac-")); roots.push(r); return join(r, "control"); }
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

describe("passwords (spec §3.1)", () => {
  it("stores scrypt N=2^17 r=8 p=1 with a 32-byte salt and a 64-byte key, and verifies only the right password", () => {
    const stored = hashPassword("correct horse battery");
    const [scheme, n, r, p, salt, key] = stored.split("$");
    expect([scheme, n, r, p]).toEqual(["scrypt", "131072", "8", "1"]);
    expect(Buffer.from(salt!, "base64").length).toBe(32);
    expect(Buffer.from(key!, "base64").length).toBe(64);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(verifyPassword("x", "plain$text")).toBe(false);
  });
});

describe("access tokens (spec §3.3)", () => {
  const key = randomBytes(32);
  const claims = { sub: "u1", roles: ["owner" as const], sid: "s1", iat: 1000, exp: 2000 };
  it("verifies its own token until exp, and nothing signed with another key, unsigned or with another alg", () => {
    const token = signAccessToken(key, claims);
    expect(verifyAccessToken(key, token, 1999)).toEqual(claims);
    expect(verifyAccessToken(key, token, 2000)).toBe(null);
    expect(verifyAccessToken(randomBytes(32), token, 1500)).toBe(null);
    const [, payload] = token.split(".");
    const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${payload}.`;
    expect(verifyAccessToken(key, none, 1500)).toBe(null);
    const h512 = b64url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
    const sig = createHmac("sha512", key).update(`${h512}.${payload}`).digest("base64url");
    expect(verifyAccessToken(key, `${h512}.${payload}.${sig}`, 1500)).toBe(null);
    const extra = b64url(JSON.stringify({ ...claims, admin: true }));
    const h = token.split(".")[0]!;
    expect(verifyAccessToken(key, `${h}.${extra}.${createHmac("sha256", key).update(`${h}.${extra}`).digest("base64url")}`, 1500)).toBe(null);
  });
});

describe("the signing key (spec §3.3, Rule 17)", () => {
  it("is created once as a 0600 file of 32 bytes, read back unchanged, and an existing file's mode is left alone", async () => {
    const r = await root();
    const first = loadOrCreateSigningKey(r);
    expect(first.length).toBe(32);
    expect((await stat(join(r, JWT_KEY_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(r)).mode & 0o777).toBe(0o700);
    expect(loadOrCreateSigningKey(r).equals(first)).toBe(true);
    await chmod(join(r, JWT_KEY_FILE), 0o640);
    loadOrCreateSigningKey(r);
    expect((await stat(join(r, JWT_KEY_FILE))).mode & 0o777).toBe(0o640);
    rotateSigningKey(r);
    expect(loadOrCreateSigningKey(r).equals(first)).toBe(false);
    await writeFile(join(r, JWT_KEY_FILE), "short");
    expect(() => loadOrCreateSigningKey(r)).toThrow("jwt-key-invalid");
  });
});

describe("the accounts store and the default owner (spec §3.1, §3.2, D1)", () => {
  it("creates the store 0600, the owner named after --by with a forced change, and the initial password file 0600, logging only its path", async () => {
    const r = await root();
    const store = openAccountsStore(r);
    try {
      expect((await stat(join(r, ACCOUNTS_FILE))).mode & 0o777).toBe(0o600);
      const lines: string[] = [];
      expect(ensureDefaultOwner(store, r, "biran", (line) => lines.push(line), 1)).toEqual({ created: true });
      const password = (await readFile(join(r, INITIAL_PASSWORD_FILE), "utf8")).trim();
      expect(password).toMatch(/^[0-9a-f]{16}$/);
      expect((await stat(join(r, INITIAL_PASSWORD_FILE))).mode & 0o777).toBe(0o600);
      expect(lines).toEqual([`orca-panel: initial password for biran written to ${join(r, INITIAL_PASSWORD_FILE)}\n`]);
      expect(lines.join("")).not.toContain(password);
      const owner = store.findByName("biran")!;
      expect(owner).toMatchObject({ roles: ["owner"], mustChangePassword: true });
      expect(verifyPassword(password, owner.passwordHash)).toBe(true);
      expect(ensureDefaultOwner(store, r, "someone", () => undefined, 2)).toEqual({ created: false });
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-created"]);
    } finally { store.close(); }
  });

  it("enforces the minimum length, unique names and the name pattern; revokes sessions on disable", async () => {
    const store = openAccountsStore(await root());
    try {
      expect(() => store.createUser({ name: "amy", password: "short", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "password-too-short" }));
      const amy = store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" });
      expect(amy.mustChangePassword).toBe(false);
      expect(() => store.createUser({ name: "amy", password: "twelve chars!", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "user-name-taken" }));
      expect(() => store.createUser({ name: "a b", password: "twelve chars!", roles: ["member"], now: 1, by: "t" })).toThrow(expect.objectContaining({ code: "user-name-invalid" }));
      const sid = store.createSession(amy.id, 10, 100);
      expect(store.sessionActive(sid, amy.id, 50)).toBe(true);
      expect(store.sessionActive(sid, amy.id, 100)).toBe(false);
      store.disableUser(amy.id, 20, "t");
      expect(store.sessionActive(sid, amy.id, 50)).toBe(false);
      expect(store.openNotices().map((n) => n.kind)).toEqual(["user-created", "user-disabled"]);
    } finally { store.close(); }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/panel/accounts.test.ts > $SCRATCH/t2.txt 2>&1; echo rc=$?` → `rc=1`, modules missing.

- [ ] **Step 3: `password.ts`:**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Accounts spec §3.1: scrypt from node:crypto, no native dependency. D17: N=2^17, r=8 needs 128 MiB. */
const N = 131072, R = 8, P = 1, KEY_BYTES = 64, SALT_BYTES = 32, MAXMEM = 256 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (n !== N || r !== R || p !== P) return false;
  const salt = Buffer.from(parts[4]!, "base64"), expected = Buffer.from(parts[5]!, "base64");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  return timingSafeEqual(scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM }), expected);
}
```

- [ ] **Step 4: `jwt.ts`:**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "member";
export interface AccessClaims { sub: string; roles: Role[]; sid: string; iat: number; exp: number }
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const CLAIM_KEYS = ["exp", "iat", "roles", "sid", "sub"];

export function signAccessToken(key: Buffer, claims: AccessClaims): string {
  const body = Buffer.from(JSON.stringify({ sub: claims.sub, roles: claims.roles, sid: claims.sid, iat: claims.iat, exp: claims.exp })).toString("base64url");
  return `${HEADER}.${body}.${createHmac("sha256", key).update(`${HEADER}.${body}`).digest("base64url")}`;
}

/** Spec §3.3: only this exact header, only these claims, only before exp. Anything else is no token. */
export function verifyAccessToken(key: Buffer, token: string, nowSec: number): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = createHmac("sha256", key).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2]!, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>; } catch { return null; }
  if (Object.keys(claims).sort().join(",") !== CLAIM_KEYS.join(",")) return null;
  const { sub, roles, sid, iat, exp } = claims;
  if (typeof sub !== "string" || typeof sid !== "string" || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  if (!Array.isArray(roles) || !roles.every((role) => role === "owner" || role === "member")) return null;
  if ((exp as number) <= nowSec) return null;
  return { sub, roles: roles as Role[], sid, iat: iat as number, exp: exp as number };
}
```

- [ ] **Step 5: `signingKey.ts`:**

```ts
import { randomBytes } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";

export const JWT_KEY_FILE = "jwt.key";

/** Rule 17: the directory is created 0700 only when absent; an existing one keeps its mode. */
export function ensurePrivateDir(root: string): void { mkdirSync(root, { recursive: true, mode: 0o700 }); }

function writeNew(path: string, bytes: Buffer): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeSync(fd, bytes); } finally { closeSync(fd); }
}

/** Spec §3.3: 32 random bytes, created once with mode 0600, persisted so a restart logs nobody out. */
export function loadOrCreateSigningKey(root: string): Buffer {
  ensurePrivateDir(root);
  const path = join(root, JWT_KEY_FILE);
  try { writeNew(path, randomBytes(32)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = lstatSync(path);
  const key = info.isFile() ? readFileSync(path) : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("jwt-key-invalid");
  return key;
}

/** D12: a new key under a temp name, renamed over the old one; the caller also revokes every session. */
export function rotateSigningKey(root: string): void {
  ensurePrivateDir(root);
  const temp = join(root, `${JWT_KEY_FILE}.${process.pid}.tmp`);
  writeNew(temp, randomBytes(32));
  renameSync(temp, join(root, JWT_KEY_FILE));
}
```

- [ ] **Step 6: `store.ts`** — `openAccountsStore(root)`: `ensurePrivateDir(root)`; create the file with `openSync(path, "wx", 0o600)` when absent (ignore `EEXIST`); open `new DatabaseSync(path)`; `PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;`; create when absent:

```sql
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, roles TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER, must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))) STRICT;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER) STRICT;
CREATE TABLE IF NOT EXISTS security_events(seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS security_acks(seq INTEGER PRIMARY KEY REFERENCES security_events(seq), at INTEGER NOT NULL, by TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO meta VALUES ('accountsSchemaVersion','1');
```

Method rules (each a few lines; write them out in full):
- `createUser`: name must match `USER_NAME_PATTERN` else `AccountsRejection("user-name-invalid", 400)`; `password.length < MIN_PASSWORD_LENGTH && !allowShort` → `("password-too-short", 400)`; a taken name → `("user-name-taken", 409)`; id `user-${randomUUID()}`; `roles` stored as `JSON.stringify(roles)`; inserts and appends `user-created` `{ userId, name, roles, by }` in one transaction (`BEGIN IMMEDIATE`/`COMMIT`).
- `setPassword`: length rule; sets hash, `must_change_password=0`; event `password-changed` `{ userId, by }`.
- `disableUser`: sets `disabled_at`, `UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`; event `user-disabled`.
- `createSession`: id `randomUUID()`; `sessionActive` = row exists, `user_id` matches, `revoked_at IS NULL`, `expires_at > now`, and the user is not disabled.
- `openNotices`: events of kind `user-created|password-changed|user-disabled|key-rotated` with no `security_acks` row, ordered by `seq`.
- `UserRow` maps `roles` by `JSON.parse` and refuses (throws `Error("accounts-row-invalid")`) a value that is not an array of `owner|member`.

- [ ] **Step 7: `initialOwner.ts`:**

```ts
import { createHash, randomBytes } from "node:crypto";
import { closeSync, openSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AccountsStore } from "./store.js";
import { USER_NAME_PATTERN } from "./store.js";

export const INITIAL_PASSWORD_FILE = "initial-password";

/**
 * Accounts spec §3.2 (D2): a store with no user gets one owner named after --by (or "owner" when --by is not a valid
 * name), whose initial password is the first 16 hex characters of SHA-256 over 32 random bytes. The password goes to a
 * 0600 file only; the log line names the file, never the password.
 */
export function ensureDefaultOwner(store: AccountsStore, root: string, by: string, log: (line: string) => void, now: number): { created: boolean } {
  if (store.userCount() > 0) return { created: false };
  const name = USER_NAME_PATTERN.test(by) ? by : "owner";
  const password = createHash("sha256").update(randomBytes(32)).digest("hex").slice(0, 16);
  const path = join(root, INITIAL_PASSWORD_FILE), temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeSync(fd, `${password}\n`); } finally { closeSync(fd); }
  renameSync(temp, path);
  store.createUser({ name, password, roles: ["owner"], mustChangePassword: true, now, by: "panel" });
  log(`orca-panel: initial password for ${name} written to ${path}\n`);
  return { created: true };
}
```

- [ ] **Step 8: Run** the test file → `rc=0`; `npm run typecheck` → `rc=0`. Record in the ledger the measured wall time of the test file (vitest's `Duration` line) — scrypt cost matters for Task 4.
- [ ] **Step 9: Mutations (clone):** (a) in `verifyAccessToken` delete `|| parts[0] !== HEADER` → alg tests red; (b) delete the `CLAIM_KEYS` check → extra-claim test red; (c) delete `if ((exp as number) <= nowSec) return null;` → exp test red; (d) replace `"wx", 0o600` in `writeNew` with `"w"` and set `process.umask(0o022)` in the test's `beforeAll` (restore in `afterAll`) → mode test red (record whether the umask line was needed); (e) delete the `key.length !== 32` check → short-file test red; (f) delete `UPDATE sessions SET revoked_at` in `disableUser` → disable test red; (g) delete `if (store.userCount() > 0) return { created: false };` → second-call expectation red.
- [ ] **Step 10: Commit** `feat(panel): accounts store, password hashing, signed sessions and the default owner`.

---

### Task 3: Login, sessions and the `/api` middleware (token still accepted until Task 4)

**Files:**
- Create: `src/panel/auth.ts`, `src/panel/authRoutes.ts`, `tests/panel/fixtures/auth.ts`
- Modify: `src/panel/api.ts` (middleware at ~L178: session first, legacy token second), `src/panel/server.ts` (build `PanelAuth`, `--session-days`, pass to `buildApi`, close it), `src/panel/rejection.ts` (codes), `src/panel/controlErrors.ts` (`panelOnlyErrorStatuses` gains `login-required` 401, `password-change-required` 403, `csrf-required` 403), `web/src/locales/zh.ts` + `en.ts` (error copy for the new codes)
- Test: `tests/panel/auth.test.ts`

**Interfaces:**
- Consumes: Task 2 modules; `controlRoot(env)` (`src/panel/controlOptions.ts:56`).
- Produces:
  - `auth.ts`: `interface Principal` lives in Task 5; here `interface AuthenticatedUser { user: UserRow; claims: AccessClaims }`; `interface PanelAuth { readonly store: AccountsStore; readonly sessionDays: number; login(name: string, password: string, nowMs: number): LoginResult; authenticate(token: string | undefined, nowMs: number): AuthenticatedUser | null; refresh(current: AuthenticatedUser, nowMs: number): string; logout(sid: string, nowMs: number): void; close(): void }`; `type LoginResult = { ok: true; token: string; csrf: string; user: UserRow } | { ok: false; code: "login-failed" } | { ok: false; code: "login-throttled"; retryAfterSec: number }`; `createPanelAuth(input: { root: string; by: string; sessionDays: number; log: (line: string) => void; nowMs: () => number }): PanelAuth`.
  - `authRoutes.ts`: `AUTH_COOKIE = "orca_at"`, `CSRF_COOKIE = "orca_csrf"`, `CSRF_HEADER = "x-orca-csrf"`; `registerAuthRoutes(app: Express, auth: PanelAuth): void`; `authMiddleware(auth: PanelAuth, legacyToken: string | null): RequestHandler` (sets `res.locals.orcaUser: AuthenticatedUser`).
  - `PanelOptions.sessionDays: number` (parse: `--session-days` integer 1..30, default 15, else `PanelRejection("malformed-session-days")`); `PanelOptions.accountsDir?: string` (set by `parsePanelArgs` to `controlRoot(env)`; `createPanelServer` uses `opts.accountsDir ?? controlRoot(env)`).
  - `tests/panel/fixtures/auth.ts`: `TEST_PASSWORD = "orca-test-password"`; `seedUser(accountsDir: string, name: string, role?: Role): void` (upsert, `must_change_password=0`, password `TEST_PASSWORD`; the hash is computed once per process and reused); `login(baseUrl: string, name?: string, password?: string): Promise<Session>` where `interface Session { cookie: string; csrf: string; fetch(path: string, init?: RequestInit): Promise<Response> }` (adds `cookie`, and `x-orca-csrf` on non-GET); `sessionFor(panel: { url: string }, env: NodeJS.ProcessEnv, name?: string, role?: Role): Promise<Session>` (seeds into `controlRoot(env)`, logs in, caches per panel url + name).

Routes (all JSON; non-`/api/auth/login` POSTs need CSRF):

| route | who | answer |
|---|---|---|
| `POST /api/auth/login {name,password}` | anyone | 200 `{user}` + cookies; 401 `login-failed`; 429 `login-throttled` `{retryAfterSec}` |
| `GET /api/auth/me` | session | 200 `{user:{id,name,roles,mustChangePassword}, expiresAt, sessionDays}`; 401 `login-required` |
| `POST /api/auth/refresh` | session | 200 `{expiresAt}` + new `orca_at` (same sid, `sessions.expires_at` extended) |
| `POST /api/auth/logout` | session | 200; session revoked; cookies cleared |
| `POST /api/auth/password {current,next}` | session (also during forced change) | 200; 401 `login-failed` on a wrong current; 400 `password-too-short`; deletes `initial-password` when it existed for a forced change |
| `POST /api/auth/profile {name}` | session | 200 `{user}`; 400/409 per store |
| `GET /api/auth/users` | owner | 200 `{users}` |
| `POST /api/auth/users {name,role,password}` | owner | 201 `{user}`; 403 `owner-required` for a member |
| `GET /api/auth/notices` | owner | 200 `{notices}` (members get `[]`) |
| `POST /api/auth/notices/:seq/ack` | owner | 200 |

Middleware order on `/api` (after the Host gate and the body parser, before every other `/api` route): `/api/auth/login` passes; otherwise read `orca_at` (parse `req.headers.cookie` by hand: split on `;`, trim, first `=`); `auth.authenticate` → null ⇒ if `legacyToken !== null && tokenMatches(legacyToken, req.header("x-orca-token"))` pass with no user (Task 4 deletes this arm) else 401 `login-required` (control routes in `controlErrorBody` shape, others `{code,message}`, as today); user with `mustChangePassword` and path not in `{/auth/me, /auth/password, /auth/logout}` ⇒ 403 `password-change-required`; non-GET and path ≠ `/auth/login` and `x-orca-csrf` ≠ the `orca_csrf` cookie (timing-safe, both present) ⇒ 403 `csrf-required`.

- [ ] **Step 1: Fixture** `tests/panel/fixtures/auth.ts` (no test of its own; Steps 2–3 exercise it):

```ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hashPassword } from "../../../src/panel/accounts/password.js";
import { ACCOUNTS_FILE, openAccountsStore } from "../../../src/panel/accounts/store.js";
import type { Role } from "../../../src/panel/accounts/jwt.js";
import { controlRoot } from "../../../src/panel/controlOptions.js";

export const TEST_PASSWORD = "orca-test-password";
let testHash: string | null = null;

/** A user the criterion can log in as: created, or reset to TEST_PASSWORD with no forced change. The criterion's own temp store. */
export function seedUser(accountsDir: string, name: string, role: Role = "owner"): void {
  openAccountsStore(accountsDir).close();
  testHash ??= hashPassword(TEST_PASSWORD);
  const db = new DatabaseSync(join(accountsDir, ACCOUNTS_FILE));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare(`INSERT INTO users(id,name,password_hash,roles,created_at,disabled_at,must_change_password) VALUES (?,?,?,?,?,NULL,0)
      ON CONFLICT(name) DO UPDATE SET password_hash=excluded.password_hash, roles=excluded.roles, disabled_at=NULL, must_change_password=0`)
      .run(`user-${randomUUID()}`, name, testHash, JSON.stringify([role]), Date.now());
  } finally { db.close(); }
}

export interface Session { cookie: string; csrf: string; fetch(path: string, init?: RequestInit): Promise<Response> }

const cookieValue = (setCookies: string[], name: string): string | undefined =>
  setCookies.map((line) => line.split(";")[0]!).find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);

export async function login(baseUrl: string, name = "tester", password = TEST_PASSWORD): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password }) });
  if (res.status !== 200) throw new Error(`login as ${name} answered ${res.status}: ${await res.text()}`);
  const set = res.headers.getSetCookie();
  const at = cookieValue(set, "orca_at"), csrf = cookieValue(set, "orca_csrf");
  if (at === undefined || csrf === undefined) throw new Error(`login set no session cookies: ${JSON.stringify(set)}`);
  const cookie = `orca_at=${at}; orca_csrf=${csrf}`;
  return {
    cookie, csrf,
    fetch: (path, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      if (method !== "GET" && method !== "HEAD") headers.set("x-orca-csrf", csrf);
      return fetch(`${baseUrl}${path}`, { ...init, headers });
    },
  };
}

const sessions = new Map<string, Promise<Session>>();
/** Seeds `name` into the panel's accounts dir (ORCA_CONTROL_DIR of `env`) and logs in once per panel and name. */
export function sessionFor(panel: { url: string }, env: NodeJS.ProcessEnv = process.env, name = "tester", role: Role = "owner"): Promise<Session> {
  const key = `${panel.url}\0${name}`;
  let session = sessions.get(key);
  if (session === undefined) {
    seedUser(controlRoot(env), name, role);
    session = login(panel.url, name);
    sessions.set(key, session);
  }
  return session;
}
```

- [ ] **Step 2: Failing tests** `tests/panel/auth.test.ts` (boots real panels with `parsePanelArgs(["--by","tester","--dist",<fixture dist>, ...])`; copy the fixture-dist helper the existing `tests/panel/metricsApi.test.ts` uses; `env = { ...process.env, ORCA_CONTROL_DIR: <tmp>/control, ORCA_CORRECTIONS_DIR: <tmp>/corrections }`):

```ts
// helpers: boot(extra: string[] = []) -> StartedPanel tracked for close; root = env.ORCA_CONTROL_DIR
describe("login and sessions (spec §3.2-§3.4)", () => {
  it("answers 401 login-required with no cookie, and 200 after login, on a --no-control panel too (D1)", async () => {
    const panel = await boot(["--no-control"]);
    expect((await fetch(`${panel.url}/api/metrics`)).status).toBe(401);
    expect(await (await fetch(`${panel.url}/api/metrics`)).json()).toMatchObject({ code: "login-required" });
    const s = await sessionFor(panel, env);
    expect((await s.fetch("/api/metrics")).status).toBe(200);
  });

  it("the initial password reaches only the change step; the change deletes the file and lifts the gate", async () => {
    const panel = await boot();
    const initial = (await readFile(join(root, "initial-password"), "utf8")).trim();
    const s = await login(panel.url, "tester", initial);
    expect(await (await s.fetch("/api/auth/me")).json()).toMatchObject({ user: { name: "tester", mustChangePassword: true } });
    expect(await (await s.fetch("/api/metrics")).json()).toMatchObject({ code: "password-change-required" });
    expect((await s.fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: initial, next: "short" }) })).status).toBe(400);
    expect((await s.fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: initial, next: "a long enough one" }) })).status).toBe(200);
    await expect(stat(join(root, "initial-password"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await s.fetch("/api/metrics")).status).toBe(200);
  });

  it("refuses a token signed with another key, a POST without the CSRF header, and a logged-out or disabled session at once", async () => {
    const panel = await boot();
    const s = await sessionFor(panel, env);
    const forged = signAccessToken(randomBytes(32), { sub: "x", roles: ["owner"], sid: "x", iat: 1, exp: 4_000_000_000 });
    expect((await fetch(`${panel.url}/api/metrics`, { headers: { cookie: `orca_at=${forged}` } })).status).toBe(401);
    const noCsrf = await fetch(`${panel.url}/api/reviews`, { method: "POST", headers: { cookie: s.cookie, "content-type": "application/json" }, body: "{}" });
    expect(await noCsrf.json()).toMatchObject({ code: "csrf-required" });
    expect((await s.fetch("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await s.fetch("/api/metrics")).status).toBe(401);
    seedUser(root, "amy", "member");
    const amy = await login(panel.url, "amy");
    const store = openAccountsStore(root);
    try { store.disableUser(store.findByName("amy")!.id, Date.now(), "test"); } finally { store.close(); }
    expect((await amy.fetch("/api/metrics")).status).toBe(401);
  });

  it("refresh extends exp and keeps sid; a token survives a panel restart; an expired one does not", async () => {
    let now = 1_800_000_000_000;
    const panel = await boot([], () => new Date(now)); // passes opts.now; PanelAuth reads nowMs from it
    const s = await sessionFor(panel, env);
    const claimsOf = (cookie: string) => JSON.parse(Buffer.from(cookie.split("orca_at=")[1]!.split(";")[0]!.split(".")[1]!, "base64url").toString());
    const before = claimsOf(s.cookie);
    expect(before.exp - before.iat).toBe(15 * 86_400);
    now += 86_400_000;
    const refreshed = await s.fetch("/api/auth/refresh", { method: "POST" });
    const after = claimsOf(refreshed.headers.getSetCookie().find((line) => line.startsWith("orca_at="))!);
    expect(after.sid).toBe(before.sid);
    expect(after.exp).toBe(before.exp + 86_400);
    await panel.close();
    const again = await boot([], () => new Date(now));
    expect((await fetch(`${again.url}/api/metrics`, { headers: { cookie: s.cookie } })).status).toBe(200);
    now += 16 * 86_400_000;
    expect((await fetch(`${again.url}/api/metrics`, { headers: { cookie: s.cookie } })).status).toBe(401);
  });

  it("throttles a name after five failures without sleeping, and records one summary event", async () => {
    // A fixed clock: five scrypt verifications can take longer than the 1 s window under load.
    const panel = await boot([], () => new Date(1_800_000_000_000));
    seedUser(root, "amy", "member");
    const attempt = () => fetch(`${panel.url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "amy", password: "wrong wrong wrong" }) });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toMatchObject({ code: "login-throttled", retryAfterSec: 1 });
    const store = openAccountsStore(root);
    try { expect(store.db.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind='login-failed'").get()).toMatchObject({ n: 1 }); } finally { store.close(); }
  });

  it("an added user's own password works with no forced change; a member cannot add users", async () => {
    const panel = await boot();
    const owner = await sessionFor(panel, env);
    const add = (s: Session, name: string) => s.fetch("/api/auth/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, role: "member", password: "bobs own password" }) });
    expect((await add(owner, "bob")).status).toBe(201);
    const bob = await login(panel.url, "bob", "bobs own password");
    expect(await (await bob.fetch("/api/auth/me")).json()).toMatchObject({ user: { mustChangePassword: false, roles: ["member"] } });
    expect(await (await add(bob, "eve")).json()).toMatchObject({ code: "owner-required" });
  });
});
```

Expose `store` on `PanelAuth` only for criteria (`auth.store`); add `boot(extra, now?)` that sets `opts.now = now` after parsing (the existing `PanelOptions.now` clock, `src/panel/server.ts:40`).

- [ ] **Step 3: Run** `npx vitest run tests/panel/auth.test.ts > $SCRATCH/t3.txt 2>&1; echo rc=$?` → `rc=1`.

- [ ] **Step 4: Implement `auth.ts`.** `createPanelAuth`: `const key = loadOrCreateSigningKey(root)`; `const store = openAccountsStore(root)`; `ensureDefaultOwner(store, root, by, log, nowMs())`; throttle state `Map<string, { failures: number; until: number }>`.
  - `login`: throttle check first — `entry.failures >= 5 && nowMs < entry.until` ⇒ `{ ok:false, code:"login-throttled", retryAfterSec: Math.ceil((entry.until - nowMs)/1000) }`. Look the user up; a missing or disabled user still runs `verifyPassword(password, DUMMY_HASH)` (a hash computed once at creation) so timing does not reveal names. Failure ⇒ `failures += 1`; when `failures >= 5`: `until = nowMs + Math.min(2 ** (failures - 5), 300) * 1000`, and at exactly 5 append `login-failed` `{ name, failures: 5 }`; return `login-failed`. Success ⇒ delete the entry; `sid = store.createSession(user.id, nowMs, nowMs + days)`; token with `iat = floor(nowMs/1000)`, `exp = iat + sessionDays*86400`; `csrf = randomBytes(32).toString("base64url")`.
  - `authenticate`: `verifyAccessToken(key, token, floor(nowMs/1000))`, then `store.sessionActive(claims.sid, claims.sub, nowMs)`, then `store.findById(claims.sub)`; roles are read from the user row (a role change applies at once), not from the claim.
  - `refresh`: new claims with the same `sid`, `iat = now`, `exp = now + days`; `store.extendSession(sid, exp*1000)`.
- [ ] **Step 5: Implement `authRoutes.ts`** per the table and middleware order above. Cookies: `res.setHeader("set-cookie", [\`orca_at=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${days*86400}\`, \`orca_csrf=${csrf}; SameSite=Strict; Path=/; Max-Age=${days*86400}\`])`; logout sets both with `Max-Age=0`. `POST /api/auth/password`: verify `current`; `store.setPassword`; if the user had `mustChangePassword` remove `<root>/initial-password` (`rmSync(..., { force: true })`). An `AccountsRejection` answers its `status` and `{code,message}`.
- [ ] **Step 6: Wire.** `server.ts`: after the body parser, `const auth = createPanelAuth({ root: opts.accountsDir ?? controlRoot(env), by: opts.by, sessionDays: opts.sessionDays ?? 15, log: (line) => process.stderr.write(line), nowMs: () => (opts.now ?? (() => new Date()))().getTime() })`; `registerAuthRoutes(app, auth)` before `buildApi`; `buildApi(app, { ..., auth })`; `auth.close()` in the `closed` handler after `control?.close()`. `api.ts`: `ApiDeps.auth: PanelAuth`; replace the token middleware body with `authMiddleware(deps.auth, deps.token)`.
- [ ] **Step 7: Run** the new file → `rc=0`; then `npx vitest run tests/panel tests/memory tests/entry > $SCRATCH/t3all.txt 2>&1; echo rc=$?` → `rc=0` (legacy token still accepted, so existing criteria stay green; the userData guard must not fire); typecheck `rc=0`.
- [ ] **Step 8: Mutations (clone):** (a) drop the `sessionActive` check → logout/disable assertions red; (b) drop the CSRF comparison → csrf test red; (c) drop the `password-change-required` arm → initial-password test red; (d) drop the `rmSync(initial-password)` → ENOENT assertion red; (e) refresh mints a new sid → sid assertion red; (f) make the throttle answer at `failures >= 6` → 429 assertion red; (g) drop the `login-failed` append → summary count red; (h) let `authenticate` read roles from the claim and change the test to demote bob before `/api/auth/users` — record whether it is red; if equivalent, record so.
- [ ] **Step 9: Commit** `feat(panel): log in to the panel with an account and a signed session`.

---

### Task 4: Remove the page token; move every criterion to a session

**Files:**
- Modify: `src/panel/api.ts` (drop the legacy arm, `ApiDeps.token`), `src/panel/staticFiles.ts` (no anchor, no injection, `loadStaticFiles(distDir)`), `src/panel/server.ts` (no `mintToken`; `StartedPanel.token` removed), `src/cli.ts` (ready line D11; stderr "open <url> in a browser and log in"; USAGE `--session-days`), `src/panel/rejection.ts` (`TOKEN_REQUIRED` → `LOGIN_REQUIRED = "login-required"`), `src/panel/controlErrors.ts`, `web/index.html` (anchor line deleted), `web/src/api.ts`, `web/src/controlApi.ts`, `web/src/EvidenceLink.tsx` (comment), `web/src/locales/{en,zh}.ts` (drop `token-required`), `README.md:225`
- Delete: `src/panel/token.ts` (after `rg -n "token.js" src tests scripts` shows no importer)
- Rewrite: inventory 3–20, 23–28.
- Test: `tests/panel/noPageToken.test.ts`

**Interfaces:**
- Produces: web `csrfHeader(): Record<string, string>` in `web/src/api.ts` (reads `orca_csrf` from `document.cookie`); `parseReadyLine(stdout): { url: string }` in `scripts/verify-panel.ts`.

- [ ] **Step 1: Failing test** `tests/panel/noPageToken.test.ts`:

```ts
describe("the page carries no credential (spec §3.4, H5)", () => {
  it("serves index.html byte-for-byte from dist and refuses x-orca-token", async () => {
    const panel = await boot(); // as in auth.test.ts, with a fixture dist whose index.html has no anchor
    const page = await fetch(`${panel.url}/`);
    expect(await page.text()).toBe(await readFile(join(dist, "index.html"), "utf8"));
    expect(Object.keys(panel)).not.toContain("token");
    const res = await fetch(`${panel.url}/api/metrics`, { headers: { "x-orca-token": "a".repeat(64) } });
    expect(await res.json()).toMatchObject({ code: "login-required" });
  });

  it("every /api route answers 401 without a cookie (walker over the route table)", async () => {
    const sources = ["src/panel/api.ts", "src/panel/controlApi.ts", "src/panel/chains.ts", "src/panel/memoryApi.ts", "src/panel/projects.ts", "src/panel/authRoutes.ts"]
      .map((file) => readFileSync(file, "utf8")).join("\n");
    const routes = [...sources.matchAll(/(?:app\.(get|post)\(|path: )"(\/api\/[^"]+)"/g)].map((m) => ({ method: m[1] === "get" ? "GET" : "POST", path: m[2]!.replace(/:[A-Za-z]+/g, "x") }));
    expect(routes.length).toBeGreaterThan(40);
    const panel = await boot(); // with a control plane, so /api/control routes exist
    for (const { method, path } of routes) {
      if (path === "/api/auth/login") continue;
      const res = await fetch(`${panel.url}${path}`, { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
```

(The `path:` alternative matches the mutation route table in `controlApi.ts`; those are POST. If the regex misses a registration style present in these files — e.g. a route registered through a variable — extend the regex and record it.)

- [ ] **Step 2: Run** → `rc=1` (index carries the token script; `x-orca-token` accepted).
- [ ] **Step 3: Implement** the source changes listed under Files. In `web/src/api.ts`: delete `token()`, `panelToken`, the `Window` declaration; `getJson` calls `fetch(path)`; `postJson` sends `{ "content-type": "application/json", ...csrfHeader() }`. In `web/src/controlApi.ts` replace each `"x-orca-token": panelToken()` with `...csrfHeader()` on POST and nothing on GET. `staticFiles.ts`: delete `TOKEN_ANCHOR`, the anchor check and the replacement; `loadStaticFiles(distDir: string | undefined)`.
- [ ] **Step 4: Rewrite the fixture** (inventory 3): `tests/panel/fixtures/controlPanel.ts` builds `const auth = createPanelAuth({ root: join(root, "accounts"), by: "operator", sessionDays: 15, log: () => undefined, nowMs: Date.now })`, passes `auth` to `buildApi` and registers `registerAuthRoutes(app, auth)` before it, seeds `seedUser(join(root, "accounts"), "operator")`, logs in once per panel and stores the `Session` on `Panel.session`; `get(panel, path, auth: "session" | "none" = "session")` and `command(...)` use `panel.session.fetch`. Callers that passed `""` for "no token" pass `"none"`.
- [ ] **Step 5: Rewrite inventory 4–20** file by file: each `headers: { "x-orca-token": … }` request becomes `(await sessionFor(started, env)).fetch(path, init)` (or the fixture helpers); each "401 without a token" case keeps its assertion with no cookie and expects `login-required`; each "wrong token" case uses a cookie signed with another key (`signAccessToken(randomBytes(32), …)`). One ledger `Ruling:` line per file.
- [ ] **Step 6: Rewrite web inventory 23–26**: the assertions that read `x-orca-token` from a mocked `fetch` call now assert `x-orca-csrf` equals the cookie the test sets (`document.cookie = "orca_csrf=t"`) on POSTs and that no request carries `x-orca-token`.
- [ ] **Step 7: Rewrite scripts 27–28**: `READY_LINE = /^orca-panel ready url=(\S+)\s*$/`; after the ready line, read `<ORCA_CONTROL_DIR>/initial-password`, `POST /api/auth/login`, `POST /api/auth/password` to a fixed 20-char password, log in again, and use that session for every former `token` request (`apiGet`/`apiPost` take a `Session`). Step 0's "dist carries the token anchor" check becomes "dist/index.html exists and carries no `__ORCA_TOKEN__`".
- [ ] **Step 8: Add to `tests/panel/refusalCoverage.test.ts` `BY_HAND`** (inventory 20, add-only): `login-failed`, `login-throttled`, `csrf-required`, `password-too-short`, `user-name-invalid`, `user-name-taken`, `owner-required`; and give each a Chinese and English entry in the locales.
- [ ] **Step 9: Completeness scan** (the command in the Rewrite inventory section) → `rc=1`.
- [ ] **Step 10: Run** `npx vitest run > $SCRATCH/t4full.txt 2>&1; echo rc=$?` → `rc=0` except registered load flakes (Task 14 list; re-run a flake alone three times and record); `npm run --ws check > $SCRATCH/t4web.txt 2>&1; echo rc=$?` → `rc=0`; `npm run build --workspace web > $SCRATCH/t4build.txt 2>&1; echo rc=$?` → `rc=0`; `npm run verify:panel > $SCRATCH/t4vp.txt 2>&1; echo rc=$?` → `rc=0`; typecheck `rc=0`.
- [ ] **Step 11: Mutations (clone):** (a) restore the legacy-token arm in the middleware → `noPageToken` first test red; (b) restore the injection in `staticFiles.ts` → byte-for-byte assertion red; (c) register one `/api/x` GET route above the middleware in `api.ts` and add its path to the walker sources → walker red (proves the walker reaches route order).
- [ ] **Step 12: Commit** `feat(panel)!: the Web UI logs in; the page no longer carries a token` (stage every rewritten file by name).

---

### Task 5: Principals and the permission table

**Files:**
- Create: `src/panel/permissions.ts`; Test: `tests/panel/permissions.test.ts`
- Modify: `src/panel/controlApi.ts` (mutation handler: principal instead of `channel === "socket"`), `src/panel/controlSocket.ts` (header middleware also sets `res.locals.orcaPrincipal = { kind: "agent", client }`), `src/panel/authRoutes.ts` (middleware sets `res.locals.orcaPrincipal = { kind: "user", ... }`), `src/panel/controlErrors.ts` (catalog gains `control-verb-human-only` 403 and `control-field-human-only` 403, with zh/en copy: they now reach the Web UI for members — N2 D2 no longer holds, recorded as a ledger Ruling), `tests/panel/controlSocketGate.test.ts` (inventory 18: add-only member case)

**Interfaces:**
- Consumes: `humanOnlyRefusal` (`src/panel/humanOnly.ts`), `withCommandContext` (Task 1).
- Produces: `type Principal = { kind: "user"; userId: string; name: string; roles: readonly Role[] } | { kind: "agent"; client: string }`; `principalLabel(p: Principal): string` (`user:<id>` / `agent:<client>`); `mayDoHumanOnly(p: Principal): boolean` (user with role `owner`); `permissionRefusal(p: Principal, verb: CommandVerbV1, payload: unknown): { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null`.

- [ ] **Step 1: Failing tests** `tests/panel/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mayDoHumanOnly, permissionRefusal, principalLabel } from "../../src/panel/permissions.js";

const owner = { kind: "user" as const, userId: "u1", name: "o", roles: ["owner" as const] };
const member = { kind: "user" as const, userId: "u2", name: "m", roles: ["member" as const] };
const agent = { kind: "agent" as const, client: "cli:claude" };

describe("the permission table (spec §3.5)", () => {
  it("lets an owner do human-only actions and refuses member and agent by the same codes", () => {
    expect(permissionRefusal(owner, "set-limit", { limit: {} })).toBe(null);
    for (const p of [member, agent]) {
      expect(permissionRefusal(p, "set-limit", { limit: {} })?.code).toBe("control-verb-human-only");
      expect(permissionRefusal(p, "requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-field-human-only");
      expect(permissionRefusal(p, "confirm", {})).toBe(null);
    }
    expect([owner, member, agent].map(mayDoHumanOnly)).toEqual([true, false, false]);
    expect([owner, agent].map(principalLabel)).toEqual(["user:u1", "agent:cli:claude"]);
  });
});
```

Add to `tests/panel/controlSocketGate.test.ts` (add-only): "C9-member: a member's set-limit over the Web is refused 403 control-verb-human-only and books nothing; an owner's is not" — seed `amy` as member with `seedUser(controlRoot(w.env), "amy", "member")`, `login(panel.url, "amy")`, POST `groups/g1/set-limit`, read the ledger as the existing `ledger()` helper does; and "rows carry the principal": after the existing C12 sends, `SELECT principal FROM commands WHERE id IN ('ws-socket','ws-web')` → `agent:cli:claude` and `user:<tester's id>`.

- [ ] **Step 2: Run** both files → `rc=1`.
- [ ] **Step 3: Implement** `permissions.ts`:

```ts
import type { Role } from "./accounts/jwt.js";
import type { CommandVerbV1 } from "../control/webProtocol.js";
import { humanOnlyRefusal } from "./humanOnly.js";

/** Accounts spec §3.5: the one table. An owner may do everything; a member and the socket's agent everything but human-only. */
export type Principal = { kind: "user"; userId: string; name: string; roles: readonly Role[] } | { kind: "agent"; client: string };
export const principalLabel = (p: Principal): string => (p.kind === "user" ? `user:${p.userId}` : `agent:${p.client}`);
export const mayDoHumanOnly = (p: Principal): boolean => p.kind === "user" && p.roles.includes("owner");
export function permissionRefusal(p: Principal, verb: CommandVerbV1, payload: unknown) {
  return mayDoHumanOnly(p) ? null : humanOnlyRefusal(verb, payload);
}
```

In the mutation handler replace the `client`/`channel === "socket"` block with:

```ts
      const principal = res.locals.orcaPrincipal as Principal | undefined;
      if (principal === undefined) throw new Error("control request carries no principal (res.locals.orcaPrincipal)");
      const client = channel === "web" ? "web" : (principal as { client: string }).client;
      const refusal = permissionRefusal(principal, route.verb, (req.body as { payload?: unknown } | undefined)?.payload);
      if (refusal !== null) { sendControlError(res, 403, refusal.code, refusal.message); return; }
```

and wrap the service call in `withCommandContext(command.commandId, { client, principal: principalLabel(principal) }, …)`. Delete `withCommandClient` once nothing calls it (`rg -n withCommandClient src tests` empty).

- [ ] **Step 4: Run** `npx vitest run tests/panel/permissions.test.ts tests/panel/controlSocketGate.test.ts tests/panel/controlSocket.test.ts tests/panel/humanOnly.test.ts tests/panel/refusalCoverage.test.ts tests/entry > $SCRATCH/t5.txt 2>&1; echo rc=$?` → `rc=0`; typecheck `rc=0`.
- [ ] **Step 5: Mutations (clone):** (a) `mayDoHumanOnly` returns `p.kind === "user"` → member assertions red; (b) delete the refusal line in the handler → C9-member and existing C9 red; (c) label web rows `"web"` instead of `principalLabel` → principal assertion red; (d) socket middleware leaves `orcaPrincipal` unset → socket tests red (fail loud).
- [ ] **Step 6: Commit** `feat(panel): one permission table for owners, members and agents`.

---

### Task 6: `orca user` commands

**Files:**
- Create: `src/panel/accounts/ttySecret.ts`, `src/panel/accounts/userCommand.ts`; Test: `tests/panel/userCommand.test.ts`
- Modify: `src/cli.ts` (dispatch `user`; USAGE lines)

**Interfaces:**
- Produces: `interface UserIo { stdinIsTTY: boolean; readSecret(prompt: string): Promise<string>; out(line: string): void; err(line: string): void; env: NodeJS.ProcessEnv; nowMs(): number }`; `runUserCommand(argv: string[], io: UserIo): Promise<number>` (0 ok, 1 refused); subcommands `add <name> [--role owner|member]`, `passwd <name>`, `disable <name>`, `list`, `rotate-key`. Refusal codes on stderr as `rejected: <code>: <message>`: `user-password-needs-tty`, `user-argument-invalid` (any unknown flag, including `--password`), `user-passwords-differ`, `user-not-found`, plus `AccountsRejection` codes. The store is `openAccountsStore(controlRoot(io.env))`.

- [ ] **Step 1: Failing tests** `tests/panel/userCommand.test.ts`:

```ts
const io = (over: Partial<UserIo> & { secrets?: string[] } = {}) => {
  const out: string[] = [], err: string[] = [], secrets = [...(over.secrets ?? [])];
  return { out, err, io: { stdinIsTTY: true, readSecret: async () => secrets.shift() ?? "", out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ORCA_CONTROL_DIR: root }, nowMs: () => 1, ...over } as UserIo };
};
describe("orca user (spec §3.2, §10)", () => {
  it("adds a user from two matching TTY entries; refuses a mismatch and a short password", async () => {
    let h = io({ secrets: ["bobs own password", "bobs own password"] });
    expect(await runUserCommand(["add", "bob", "--role", "member"], h.io)).toBe(0);
    h = io({ secrets: ["one long password", "another long one"] });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-passwords-differ");
    h = io({ secrets: ["short", "short"] });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("password-too-short");
  });
  it("refuses a non-TTY stdin and never reads a password from argv or env", async () => {
    let h = io({ stdinIsTTY: false, env: { ORCA_CONTROL_DIR: root, ORCA_PASSWORD: "from env password" } });
    expect(await runUserCommand(["add", "eve"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-password-needs-tty");
    h = io({ secrets: ["x", "x"] });
    expect(await runUserCommand(["add", "eve", "--password", "from argv password"], h.io)).toBe(1);
    expect(h.err.join("")).toContain("user-argument-invalid");
    expect(openAccountsStore(root).findByName("eve")).toBe(null);
  });
  it("rotate-key replaces jwt.key and revokes every session; disable revokes the user's", async () => { /* create amy, createSession, rotate-key, sessionActive false, key bytes differ, notice key-rotated */ });
  it("the real CLI refuses piped stdin (spawned)", async () => {
    const run = spawnSync(resolve("node_modules/.bin/tsx"), ["src/cli.ts", "user", "add", "eve"], { input: "pw\npw\n", env: { ...process.env, ORCA_CONTROL_DIR: root, HOME: home }, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("user-password-needs-tty");
  });
});
```

Write out the rotate-key test body in full when implementing (it uses only Task 2's store methods).

- [ ] **Step 2: Run** → `rc=1`.
- [ ] **Step 3: Implement.** `ttySecret.ts`: `readSecretFromTty(prompt)` writes the prompt to stderr, sets `process.stdin.setRawMode(true)`, collects bytes until `\r`/`\n`, handles backspace (`\x7f`) and Ctrl-C (`\x03` → reject `user-aborted`), restores raw mode in `finally`, echoes nothing. `userCommand.ts`: parse argv strictly (only `--role` with `owner|member`); `add`/`passwd` check `io.stdinIsTTY` **before** reading anything; two reads must match; `rotate-key` calls `rotateSigningKey(root)`, `store.revokeAllSessions(now)`, `store.appendSecurityEvent("key-rotated", {}, now)` and prints `orca-user: signing key replaced; every session is logged out; restart the panel to sign new sessions with it` (D12). `cli.ts`: `case "user": return runUserCommand(rest, { stdinIsTTY: process.stdin.isTTY === true, readSecret: readSecretFromTty, out: (l) => process.stdout.write(l), err: (l) => process.stderr.write(l), env: process.env, nowMs: Date.now })`; USAGE gains `orca user add <name> [--role owner|member] | passwd <name> | disable <name> | list | rotate-key   (passwords are typed at a terminal, never passed as arguments)`.
- [ ] **Step 4: Run** the file and `npx vitest run tests/panel/usage.test.ts tests/cli > $SCRATCH/t6.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutations (clone):** (a) delete the `stdinIsTTY` check → non-TTY test red (both in-process and spawned); (b) accept unknown flags → `--password` test red; (c) drop `revokeAllSessions` in rotate-key → rotate test red; (d) drop the equality check of the two entries → mismatch test red.
- [ ] **Step 6: Commit** `feat(cli): orca user add, passwd, disable, list and rotate-key`.

---

### Task 7: The usage ledger (Orca accepts `byModel`; works without it)

**Files:**
- Create: `src/control/usageLedger.ts`; Test: `tests/control/usageLedger.test.ts`
- Modify: `src/control/types.ts` (`UsageEvent.byModel?: ModelUsage[] | null`, `ModelUsage`), `src/control/usage.ts` (schema; `recordUsage(store, event, appliedAt = Date.now())`; call `bookUsageDelta` per applied non-null event), `src/control/ccloopPort.ts` (event schema accepts `byModel`; resolution schema accepts optional `usageBreakdown`; export both schemas as `ccloopCollectionSchema`, `ccloopResolutionSchema`), `src/control/executionDriver.ts:478` and `src/control/schedulerBridge.ts:46` (pass the driver's clock when it has one; otherwise the default)

**Interfaces:**
- Produces: `interface ModelUsage { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }`; `modelUsageSchema` (strict, safe non-negative integers, `model` non-empty ≤ 200 chars); `byModelSchema = z.array(modelUsageSchema).refine(sorted by model, unique)`; `entryTotal(e: ModelUsage): number`; `reconciles(byModel: readonly ModelUsage[], tokens: number): boolean`; `usageSource(run: { phase?: string; purpose?: string }, bucket: "work" | "handoff"): "run-work" | "run-handoff" | "estimate" | "clarify" | "split"`; `groupRepoIdOf(body: Record<string, unknown>): string | null` (plan.repoId → requirement.repoId → projectKey, the migration's COALESCE); `bookUsageDelta(store: ControlStore, input: { run: { runId: string; groupId: string; phase?: string; purpose?: string }; groupBody: Record<string, unknown>; event: UsageEvent; deltaTokens: number; appliedAt: number }): void`.

- [ ] **Step 1: Failing tests** `tests/control/usageLedger.test.ts` (fixtures as `tests/control/usage.test.ts`: `openTestStore`, `seedBudgetCase`, `claimWork`, `amount`):

```ts
import { describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { recordUsage } from "../../src/control/usage.js";
import { usageSource } from "../../src/control/usageLedger.js";
import { ccloopCollectionSchema, ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { openTestStore, seedBudgetCase, amount } from "./fixtures/store.js";

const rows = (h: { store: { db: import("node:sqlite").DatabaseSync } }) =>
  h.store.db.prepare("SELECT applied_at,run_id,source,model,input,output,cache_read,cache_write,tokens,quality FROM usage_ledger WHERE source<>'pre-ledger' ORDER BY id").all();
const m = (model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ model, input, output, cacheRead, cacheWrite });

describe("the usage ledger (spec §5.1, D7, D16, D18)", () => {
  it("books one row per model per applied delta, in the usage transaction, at the store clock", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(65, 1, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 30, 10, 8, 2)] }, 5_000);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(75, 2, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 35, 15, 8, 2)] }, 6_000);
      expect(rows(h)).toEqual([
        { applied_at: 5_000, run_id: c.runId, source: "run-work", model: "haiku", input: 10, output: 5, cache_read: 0, cache_write: 0, tokens: 15, quality: "reported" },
        { applied_at: 5_000, run_id: c.runId, source: "run-work", model: "opus", input: 30, output: 10, cache_read: 8, cache_write: 2, tokens: 50, quality: "reported" },
        { applied_at: 6_000, run_id: c.runId, source: "run-work", model: "opus", input: 5, output: 5, cache_read: 0, cache_write: 0, tokens: 10, quality: "reported" },
      ]);
      // A replayed event books nothing twice.
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(75, 2, 1, 1), byModel: [m("haiku", 10, 5), m("opus", 35, 15, 8, 2)] }, 7_000);
      expect(rows(h)).toHaveLength(3);
    } finally { await h.dispose(); }
  });

  it("books an event without a breakdown (absent or null) as one unattributed row, and a zero delta as none", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1) }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(20, 2, 1, 1), byModel: null }, 2);
      recordUsage(h.store, { ...e, eventSeq: 3, cumulative: null }, 3);
      expect(rows(h)).toEqual([{ applied_at: 1, run_id: c.runId, source: "run-work", model: null, input: null, output: null, cache_read: null, cache_write: null, tokens: 20, quality: "unattributed" }]);
    } finally { await h.dispose(); }
  });

  it("an unattributed event makes later breakdowns of the same bucket unattributed (unknown baseline)", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      const e = { runId: c.runId, generation: 1, bucket: "work" as const, source: s.usageRef };
      recordUsage(h.store, { ...e, eventSeq: 1, cumulative: amount(20, 1, 1, 1) }, 1);
      recordUsage(h.store, { ...e, eventSeq: 2, cumulative: amount(50, 2, 1, 1), byModel: [m("opus", 40, 10)] }, 2);
      expect(rows(h).map((r) => [r.model, r.tokens, r.quality])).toEqual([[null, 20, "unattributed"], [null, 30, "unattributed"]]);
    } finally { await h.dispose(); }
  });

  it("a breakdown that does not reconcile keeps an authoritative total row and flags the per-model rows", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store); const c = claimWork(h.store, s.t1Claim);
      recordUsage(h.store, { runId: c.runId, generation: 1, bucket: "work", source: s.usageRef, eventSeq: 1, cumulative: amount(40, 1, 1, 1), byModel: [m("opus", 30, 20)] }, 1);
      expect(rows(h).map((r) => [r.model, r.tokens, r.quality])).toEqual([[null, 40, "unattributed"], ["opus", 50, "breakdown-mismatch"]]);
    } finally { await h.dispose(); }
  });

  it("names the source from the run's phase and purpose (D15)", () => {
    expect([usageSource({ phase: "work" }, "work"), usageSource({ phase: "work" }, "handoff"), usageSource({}, "work"), usageSource({ phase: "estimate" }, "work"),
      usageSource({ phase: "single-call", purpose: "clarify" }, "work"), usageSource({ phase: "single-call", purpose: "split" }, "work")])
      .toEqual(["run-work", "run-handoff", "run-work", "estimate", "clarify", "split"]);
  });

  it("the ccloop port accepts byModel (absent, null or sorted entries) and usageBreakdown, and refuses an unsorted breakdown", () => {
    const event = { runId: "r", generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1, activeMs: 0, attempts: 0, sessions: 0 }, source: { artifactId: "a", hash: "a".repeat(64) } };
    const answer = (events: unknown[]) => ({ events, candidate: null, terminal: null });
    expect(ccloopCollectionSchema.safeParse(answer([event, { ...event, byModel: null }, { ...event, byModel: [m("a", 1, 0)] }])).success).toBe(true);
    expect(ccloopCollectionSchema.safeParse(answer([{ ...event, byModel: [m("b", 1, 0), m("a", 0, 0)] }])).success).toBe(false);
    expect(ccloopResolutionSchema.shape.usageBreakdown.safeParse("per-model").success).toBe(true);
    expect(ccloopResolutionSchema.shape.usageBreakdown.safeParse(undefined).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/control/usageLedger.test.ts > $SCRATCH/t7.txt 2>&1; echo rc=$?` → `rc=1`.

- [ ] **Step 3: Implement `usageLedger.ts`:**

```ts
import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { ModelUsage, UsageEvent } from "./types.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const modelUsageSchema = z.object({ model: z.string().min(1).max(200), input: count, output: count, cacheRead: count, cacheWrite: count }).strict();
export const byModelSchema = z.array(modelUsageSchema).refine((entries) => entries.every((entry, index) => index === 0 || entries[index - 1]!.model < entry.model), "byModel must be sorted by model, without repeats");

/** D7: one adapter-neutral total -- `input` is non-cached input, so claude's and codex's own normalizations both reconcile. */
export const entryTotal = (e: ModelUsage): number => e.input + e.output + e.cacheRead + e.cacheWrite;
export const reconciles = (byModel: readonly ModelUsage[], tokens: number): boolean => byModel.reduce((sum, e) => sum + entryTotal(e), 0) === tokens;

export function usageSource(run: { phase?: string; purpose?: string }, bucket: "work" | "handoff") {
  if (run.phase === "estimate") return "estimate" as const;
  if (run.phase === "single-call" && (run.purpose === "clarify" || run.purpose === "split")) return run.purpose;
  return bucket === "work" ? "run-work" as const : "run-handoff" as const;
}

export function groupRepoIdOf(body: Record<string, unknown>): string | null {
  const pick = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  return pick((body.plan as { repoId?: unknown } | undefined)?.repoId) ?? pick((body.requirement as { repoId?: unknown } | undefined)?.repoId) ?? pick(body.projectKey);
}

/** The breakdown the previous applied event of this run and bucket left: a map when it is known and reconciled, null when not. */
function baseline(store: ControlStore, runId: string, bucket: "work" | "handoff", beforeSeq: number): Map<string, ModelUsage> | null {
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<? ORDER BY seq DESC").all(runId, beforeSeq)) {
    const prior = JSON.parse(String(row.body)) as UsageEvent;
    if (prior.bucket !== bucket || prior.cumulative === null) continue;
    if (prior.byModel == null) return prior.cumulative.tokens === 0 ? new Map() : null;
    return reconciles(prior.byModel, prior.cumulative.tokens) ? new Map(prior.byModel.map((entry) => [entry.model, entry])) : null;
  }
  return new Map();
}

/** Accounts spec §5.1: called inside recordUsage's transaction, once per applied event whose cumulative is known. */
export function bookUsageDelta(store: ControlStore, input: { run: { runId: string; groupId: string; phase?: string; purpose?: string }; groupBody: Record<string, unknown>; event: UsageEvent; deltaTokens: number; appliedAt: number }): void {
  const { run, event, deltaTokens, appliedAt } = input;
  if (deltaTokens === 0 || event.cumulative === null) return; // D16
  const source = usageSource(run, event.bucket), repoId = groupRepoIdOf(input.groupBody);
  const insert = (model: string | null, e: Omit<ModelUsage, "model"> | null, tokens: number, quality: "reported" | "unattributed" | "breakdown-mismatch") =>
    store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(appliedAt, run.groupId, repoId, run.runId, source, model, e?.input ?? null, e?.output ?? null, e?.cacheRead ?? null, e?.cacheWrite ?? null, tokens, quality);
  const byModel = event.byModel ?? null;
  const base = byModel === null ? null : baseline(store, run.runId, event.bucket, event.eventSeq);
  if (byModel === null || base === null) { insert(null, null, deltaTokens, "unattributed"); return; }
  const deltas = byModel.map((e) => {
    const b = base.get(e.model);
    return { model: e.model, input: e.input - (b?.input ?? 0), output: e.output - (b?.output ?? 0), cacheRead: e.cacheRead - (b?.cacheRead ?? 0), cacheWrite: e.cacheWrite - (b?.cacheWrite ?? 0) };
  });
  const nonNegative = (d: ModelUsage) => d.input >= 0 && d.output >= 0 && d.cacheRead >= 0 && d.cacheWrite >= 0;
  const ok = reconciles(byModel, event.cumulative.tokens) && deltas.every(nonNegative) && [...base.keys()].every((model) => byModel.some((e) => e.model === model));
  if (ok) { for (const d of deltas) if (entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "reported"); return; }
  insert(null, null, deltaTokens, "unattributed"); // D18: the authoritative row
  for (const d of deltas) if (nonNegative(d) && entryTotal(d) > 0) insert(d.model, d, entryTotal(d), "breakdown-mismatch");
}
```

- [ ] **Step 4: Wire.** `types.ts`: export `ModelUsage` and add `byModel?: ModelUsage[] | null` to `UsageEvent`. `usage.ts`: add `byModel: byModelSchema.nullable().optional()` to `eventSchema`; `recordUsage(store, event, appliedAt: number = Date.now())`; inside the drain loop, in the `else` arm after `const delta = subtract(...)`, call `bookUsageDelta(store, { run, groupBody: group as unknown as Record<string, unknown>, event: next, deltaTokens: delta.tokens, appliedAt })`. `ccloopPort.ts`: the event schema gains `byModel: byModelSchema.nullable().optional()`; `agentResolutionSchema` gains `usageBreakdown: z.enum(["per-model", "unavailable"]).optional()`; export `ccloopCollectionSchema = collectionSchema` and `ccloopResolutionSchema = agentResolutionSchema`; `resolveAgent` strips `usageBreakdown` with `protocol` so `AgentResolution` keeps its shape.
- [ ] **Step 5: Run** the file, `tests/control/usage.test.ts`, `tests/control/budget.test.ts`, `tests/control/ccloopPort.test.ts`, `tests/control/neverStartedUsage.test.ts` → `rc=0`; typecheck `rc=0`. Then `npx vitest run tests/control > $SCRATCH/t7ctl.txt 2>&1; echo rc=$?` → `rc=0` (flakes per Task 14).
- [ ] **Step 6: Mutations (clone):** (a) delete the `bookUsageDelta` call → first test red; (b) `baseline` returns `new Map()` for an unattributed prior → unknown-baseline test red; (c) drop `reconciles(...)` from `ok` → mismatch test red; (d) drop `if (deltaTokens === 0 …) return` → zero-delta expectation red; (e) drop the `refine` in `byModelSchema` → unsorted assertion red; (f) map `estimate` to `run-work` → source test red.
- [ ] **Step 7: Commit** `feat(control): book every applied usage delta per model in a usage ledger`.

---

### Task 8: Usage calendar, periods and the usage read route

**Files:**
- Create: `src/control/usageCalendar.ts`, `src/control/usageQuery.ts`; Test: `tests/control/usageCalendar.test.ts`, `tests/panel/usageRoute.test.ts`
- Modify: `src/panel/controlApi.ts` (`GET /api/control/usage` in `registerControlReadRoutes`, both channels), `src/control/webProtocol.ts` (`usageViewSchema`), `src/panel/controlErrors.ts` (`readErrorStatuses["usage-query-invalid"] = 400`), `src/control/errors.ts` (classify `usage-query-invalid` as non-durable `internal`)

**Interfaces:**
- Produces: `interface UsageCalendar { timeZone: string; weekStart: number }`; `hostTimeZone(): string`; `isTimeZone(name: string): boolean`; `readUsageCalendar(store): UsageCalendar` (default `{ timeZone: hostTimeZone(), weekStart: 1 }`); `periodBounds(period: "day" | "week" | "month", at: number, calendar: UsageCalendar): { from: number; to: number }`; `type UsageScope = "all" | \`repo:${string}\``; `parseUsageScope(text: string): UsageScope | null`; `usedTokens(store, scope: UsageScope, from: number | null, to: number | null): number`; `readUsageView(store, query: { scope: UsageScope; from: number | null; to: number | null; groupBy: "model" | "repo" | "day" | "week" | "month" }, now: number): UsageViewV1` with `UsageViewV1 = { schema: "orca-usage-view-v1"; scope; from; to; now; calendar; spendRevision: number; headline: { total: number; week: number; month: number }; range: { tokens: number; byModel: Array<{ model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number }>; groups: Array<{ key: string; tokens: number }> }; counts: { unattributedRows: number; breakdownMismatchRows: number; unknownUsageRuns: number }; caps: CapStatus[] }` (`caps` is `[]` until Task 9).

- [ ] **Step 1: Failing tests** `tests/control/usageCalendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodBounds } from "../../src/control/usageCalendar.js";

const iso = (ms: number) => new Date(ms).toISOString();
describe("calendar periods (spec §5.2)", () => {
  it("computes weeks across a DST change in New York with Monday weeks", () => {
    const ny = { timeZone: "America/New_York", weekStart: 1 };
    const spring = periodBounds("week", Date.parse("2026-03-08T12:00:00Z"), ny);
    expect([iso(spring.from), iso(spring.to)]).toEqual(["2026-03-02T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
    expect(spring.to - spring.from).toBe(7 * 86_400_000 - 3_600_000);
    const after = periodBounds("week", Date.parse("2026-03-10T12:00:00Z"), ny);
    expect([iso(after.from), iso(after.to)]).toEqual(["2026-03-09T04:00:00.000Z", "2026-03-16T04:00:00.000Z"]);
    const month = periodBounds("month", Date.parse("2026-03-31T23:00:00Z"), ny);
    expect([iso(month.from), iso(month.to)]).toEqual(["2026-03-01T05:00:00.000Z", "2026-04-01T04:00:00.000Z"]);
    const fall = periodBounds("day", Date.parse("2026-11-01T12:00:00Z"), ny);
    expect(fall.to - fall.from).toBe(25 * 3_600_000);
  });

  it("honors weekStart and crosses a year end in Tokyo", () => {
    const tokyo = { timeZone: "Asia/Tokyo", weekStart: 7 };
    const week = periodBounds("week", Date.parse("2026-12-31T03:00:00Z"), tokyo);
    expect([iso(week.from), iso(week.to)]).toEqual(["2026-12-26T15:00:00.000Z", "2027-01-02T15:00:00.000Z"]);
    const month = periodBounds("month", Date.parse("2026-12-31T20:00:00Z"), tokyo); // already 2027-01-01 05:00 in Tokyo
    expect([iso(month.from), iso(month.to)]).toEqual(["2026-12-31T15:00:00.000Z", "2027-01-31T15:00:00.000Z"]);
    expect(periodBounds("week", Date.parse("2026-12-31T03:00:00Z"), { ...tokyo, weekStart: 1 }).from).toBe(Date.parse("2026-12-27T15:00:00Z"));
  });
});
```

`tests/panel/usageRoute.test.ts`: boot a socket panel (`tests/panel/fixtures/socketPanel.ts` `boot(w)`), insert rows into `usage_ledger` through a second read-write `DatabaseSync` on `<state>/control.sqlite` with `busy_timeout` (three reported rows for two models at fixed `applied_at`, one `unattributed`, one `breakdown-mismatch`, one `pre-ledger`), then `GET /api/control/usage?scope=all&from=<a>&to=<b>&groupBy=model` over the socket (an agent may read, spec §5.3) and over the Web with a member session: assert `range.tokens` excludes the mismatch row and the out-of-range row, `byModel` per model sums, `counts`, and `headline.total` includes the pre-ledger row while `headline.week` does not. Also `scope=repo:x y` → 400 `usage-query-invalid`; `from=1.5` → 400.

- [ ] **Step 2: Run** both → `rc=1`.

- [ ] **Step 3: Implement `usageCalendar.ts`:**

```ts
import type { ControlStore } from "./store.js";

export interface UsageCalendar { timeZone: string; weekStart: number }
export const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function isTimeZone(name: string): boolean { try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return true; } catch { return false; } }

export function readUsageCalendar(store: ControlStore): UsageCalendar {
  const row = store.db.prepare("SELECT time_zone,week_start FROM usage_calendar WHERE singleton=1").get();
  return row ? { timeZone: String(row.time_zone), weekStart: Number(row.week_start) } : { timeZone: hostTimeZone(), weekStart: 1 };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function wall(at: number, timeZone: string) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(format.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second), weekday: WEEKDAYS.indexOf(String(p.weekday)) + 1 };
}
/** The zone's offset at instant t: its wall clock read as UTC, minus t (whole seconds). */
const offsetAt = (t: number, tz: string): number => { const w = wall(t, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - (t - (t % 1000)); };
/** Spec §5.2: local midnight of a calendar date, found through Intl (two passes settle a DST edge), never by adding 86,400,000. */
function localMidnight(y: number, m: number, d: number, tz: string): number {
  const asUtc = Date.UTC(y, m - 1, d);
  const first = asUtc - offsetAt(asUtc, tz);
  return asUtc - offsetAt(first, tz);
}
const civil = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

export function periodBounds(period: "day" | "week" | "month", at: number, calendar: UsageCalendar): { from: number; to: number } {
  const w = wall(at, calendar.timeZone), tz = calendar.timeZone;
  if (period === "month") { const next = civil(w.y, w.m + 1, 1); return { from: localMidnight(w.y, w.m, 1, tz), to: localMidnight(next.y, next.m, 1, tz) }; }
  const back = period === "week" ? (w.weekday - calendar.weekStart + 7) % 7 : 0;
  const start = civil(w.y, w.m, w.d - back), end = civil(start.y, start.m, start.d + (period === "week" ? 7 : 1));
  return { from: localMidnight(start.y, start.m, start.d, tz), to: localMidnight(end.y, end.m, end.d, tz) };
}
```

- [ ] **Step 4: Implement `usageQuery.ts`:** `parseUsageScope` accepts `all` or `repo:<id>` where `<id>` passes `idSchema`. `usedTokens`: `SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger WHERE quality<>'breakdown-mismatch'` plus `AND repo_id=?` for a repo scope plus `AND applied_at>=? AND applied_at<?` when bounded. `readUsageView`: headline `total = usedTokens(scope,null,null)`, `week`/`month` from `periodBounds(...,now,calendar)`; range rows `SELECT model,input,output,cache_read,cache_write,tokens,quality,repo_id,applied_at FROM usage_ledger WHERE …` (excluding `breakdown-mismatch` from sums and `byModel`, counting them); `byModel` groups `reported` rows by model and folds all `unattributed` rows into one `{ model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens }` entry, sorted with null last; `groups` by `groupBy` (`repo` → `repo_id ?? "unknown"`, day/week/month → `new Date(periodBounds(p, applied_at, calendar).from).toISOString()`, `model` → same as byModel keys); `unknownUsageRuns` = runs whose group is in scope with `unknown.work || unknown.handoff`; `spendRevision` from `spend_settings` (0 without a row). The route: parse `scope` (required), `from`/`to` (optional canonical decimal safe integers, `from < to`), `groupBy` (default `model`), any other key → 400 `usage-query-invalid`; `now` = `Date.now()` (the route's clock; criteria use fixed `applied_at` values and explicit `from`/`to`).
- [ ] **Step 5: Run** both files → `rc=0`; typecheck `rc=0`.
- [ ] **Step 6: Mutations (clone):** (a) replace the second pass in `localMidnight` with `return first` → spring-week assertion red (record if equivalent and why); (b) `back` ignores `weekStart` (`w.weekday - 1`) → Tokyo week red; (c) drop `quality<>'breakdown-mismatch'` → route range red; (d) count pre-ledger rows in `week` (drop the bounds) → headline red.
- [ ] **Step 7: Commit** `feat(control): usage periods in the operator's calendar and a usage read route`.

---

### Task 9: Spend caps — verbs, headroom, the human-only surface and the skill

**Files:**
- Create: `src/control/spendCaps.ts`, `src/control/spendCommands.ts`; Test: `tests/control/spendCaps.test.ts`
- Modify: `src/control/webProtocol.ts` (three verbs, `spendTokensSchema`, payloads, `spend` target in raw/effective variants and `CommandTargetV1`, the projectionless list at ~L1462), `src/control/commandLedger.ts` (`spend` scope: key `@spend`, revision from `spend_settings`), `src/control/webService.ts` (`setSpendCap`, `clearSpendCap`, `setUsageCalendar` → `applySpendCommand`), `src/panel/controlApi.ts` (three routes, switch cases), `src/control/usageQuery.ts` (`caps` filled), `src/panel/humanOnly.ts` (three verbs), `tests/panel/humanOnly.test.ts` (inventory 21), `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts` (inventory 22)

**Interfaces:**
- Produces:
  - `webProtocol.ts`: `spendTokensSchema` (a distinct `positiveSafeInteger`-based schema instance, so C19 can find it); `spendScopeSchema`; `setSpendCapPayloadSchema = { scope, period: "total"|"week"|"month", tokens: spendTokensSchema }`; `clearSpendCapPayloadSchema = { scope, period }`; `setUsageCalendarPayloadSchema = { timeZone (refined by isTimeZone), weekStart: 1..7 }`; target `{ kind: "spend" }`.
  - `spendCaps.ts`: `type SpendPeriod = "total" | "week" | "month"`; `interface SpendCap { scope: UsageScope; period: SpendPeriod; tokens: number; updatedAt: number; updatedBy: string }`; `interface CapStatus extends SpendCap { used: number; committed: number; headroom: number; from: number | null; to: number | null }`; `readCaps(store): SpendCap[]`; `committedTokens(store, scope: UsageScope, excludeGroupId: string | null): number`; `capStatuses(store, repoId: string | null, at: number, excludeGroupId?: string | null): CapStatus[]` (the `all` caps and the `repo:<repoId>` caps; ordered by headroom ascending); `spendCapBlocking(store, repoId: string | null, grantTokens: number, at: number, excludeGroupId?: string | null): CapStatus | null`; `class AgentCeilingRefusal extends Error { constructor(readonly cap: CapStatus, readonly limitTokens: number) }`.
  - routes: `POST /api/control/operator/set-spend-cap`, `/operator/clear-spend-cap`, `/operator/set-usage-calendar`; ledger scope `@spend`, result lookup `groups/@spend/commands/<id>`; results `{ kind: "spend-cap-set" | "spend-cap-cleared" | "usage-calendar-set", revision }`.

- [ ] **Step 1: Failing tests** `tests/control/spendCaps.test.ts` — with `openTestStore` and direct row setup:

```ts
describe("headroom (spec §6.2, D4)", () => {
  it("is tokens minus used in the period minus what active runs still hold, per applying cap; the binding one is the least", async () => {
    // seedBudgetCase + claimWork(t1) → one active run; read its remaining work+handoff tokens as R.
    // usage_ledger: repo r1 row 100 at t0 (this week), row 50 at t0 - 30 days (last month), pre-ledger 7.
    // spend_caps: all/total 1000, repo:r1/week 400.
    // capStatuses(store, "r1", t0) → [{scope:"repo:r1",period:"week",used:100,committed:R,headroom:300-R}, {scope:"all",period:"total",used:157,committed:R,headroom:843-R}]
    // spendCapBlocking(store,"r1",300-R+1,t0)?.scope === "repo:r1"; spendCapBlocking(store,"r1",300-R,t0) === null
    // excludeGroupId = the run's group → committed 0; repo r2 → only the all cap applies.
  });
});
describe("the cap verbs (spec §6.1, D5)", () => {
  it("set, replace, clear and set-usage-calendar under the @spend revision, recording the principal", async () => {
    // applySpendCommand via withCommandContext(id,{client:"web",principal:"user:u1"}, ...): set all/week 500 (expectedRevision 0) → revision 1;
    // same payload again with a new id → no-op-command; stale expectedRevision → revision-conflict; clear → row gone;
    // set-usage-calendar {timeZone:"Asia/Tokyo",weekStart:7} → readUsageCalendar; {timeZone:"Mars/Base"} → schema refusal 400.
    // spend_caps.updated_by === "user:u1"; commands.principal === "user:u1".
  });
});
```

Write each case as a full `it` (the comments above give every value to assert; derive `R` from the run row, do not hard-code it).

Rewrite `tests/panel/humanOnly.test.ts` (inventory 21): import `spendTokensSchema`; the walker's first line becomes `if (schema === amountSchema || schema === spendTokensSchema) { found.push(...); return; }`; the non-vacuity expectation adds `"set-spend-cap:tokens"`; add `expect(HUMAN_ONLY_VERBS).toEqual(expect.arrayContaining(["set-limit", "set-spend-cap", "clear-spend-cap", "set-usage-calendar"]))`.

Rewrite `tests/entry/skill.test.ts` (inventory 22): `22` → `25` in all three places; `schemaByVerb` gains the three payload schemas; in the phrase list replace `"not a security boundary"` with `"is a boundary at the panel's interfaces"` and add `"get usage"`, `"owner-only"`, `"control-limit-over-cap-headroom"`, `"spend-cap-reached"`.

- [ ] **Step 2: Run** the three files → `rc=1`.
- [ ] **Step 3: Implement `spendCaps.ts`** (`committedTokens` reads `SELECT r.group_id AS group_id, r.body AS body, g.body AS gbody FROM runs r JOIN groups g ON g.id=r.group_id WHERE r.active=1`, filters by `groupRepoIdOf(gbody)` for a repo scope and skips `excludeGroupId`, sums `remaining.work.tokens + remaining.handoff.tokens`; `capStatuses` uses `usedTokens` with `periodBounds(period, at, readUsageCalendar(store))` for week/month and `null` bounds for total; `headroom = tokens - used - committed`, not clamped). Implement `spendCommands.ts` on the model of `applySetAgentPreferences` (`src/control/agentPreferences.ts`): `applyWebCommand` with `authorityChanged: false`, `projectionGroupIds: []`; target must be `{ kind: "spend" }` else `control-target-not-allowed`; same-state → `no-op-command`; writes `spend_settings.revision = context.nextCommandRevision` (upsert); `updated_by = commandPrincipalFor(commandId) ?? actorId`; `updated_at` from the service clock. Wire the verbs through webProtocol, commandLedger (`spend` scope beside `operator`; `spendRevision(store)` = row revision or 0), webService and controlApi routes (target `() => ({ groupId: "@spend", target: { kind: "spend" } })`). Add the verbs to `HUMAN_ONLY_VERBS`. `readUsageView` fills `caps` with `capStatuses` for the view's scope (`all` → caps of scope `all` only; `repo:<id>` → both).
- [ ] **Step 4: Skill.** In `skills/orca-control/SKILL.md`: section 2 gains `usage?scope=all|repo:<id>[&from=<ms>&to=<ms>][&groupBy=model|repo|day|week|month]` (written so the phrase `get usage` appears: "`get usage?scope=all` reads tokens used per model and the caps"); section 6 lists the three verbs as owner-only and replaces the policy sentence with: "The panel enforces this at every interface: the socket's agent can never do a human-only action, and the Web UI requires a logged-in owner. It is a boundary at the panel's interfaces, not against a process that edits Orca's files (accounts spec §2)."; add a line: "Imports from an agent that would exceed the spend-cap headroom answer 403 `control-limit-over-cap-headroom`; a group waiting on a cap shows `spendCapBlock` (`spend-cap-reached`) and resumes by itself when the cap is raised or a new period starts."; three table rows (`POST operator/set-spend-cap` | set-spend-cap | `{"scope":"all","period":"week","tokens":5000000}`, `POST operator/clear-spend-cap` | clear-spend-cap | `{"scope":"all","period":"week"}`, `POST operator/set-usage-calendar` | set-usage-calendar | `{"timeZone":"UTC","weekStart":1}`), each marked owner-only in section 6; section 4 names the `@spend` scope for lookups.
- [ ] **Step 5: Run** `npx vitest run tests/control/spendCaps.test.ts tests/panel/humanOnly.test.ts tests/entry tests/panel/usageRoute.test.ts tests/panel/controlSocketGate.test.ts tests/control/web*.test.ts > $SCRATCH/t9.txt 2>&1; echo rc=$?` → `rc=0`; typecheck `rc=0`; ledger Ruling lines for inventory 21–22.
- [ ] **Step 6: Mutations (clone):** (a) `committedTokens` returns 0 → headroom red; (b) `usedTokens` without the period bounds → week cap red; (c) drop `set-spend-cap` from `HUMAN_ONLY_VERBS` → C19 red; (d) use `spendTokensSchema = positiveSafeInteger` (same instance as other fields) → C19's `set-spend-cap:tokens` expectation red; (e) spend scope reads `operatorRevision` → revision-conflict case red.
- [ ] **Step 7: Commit** `feat(control): token spend caps an owner sets overall and per project`.

---

### Task 10: Enforcement — the claim gate and the agent ceiling

**Files:**
- Modify: `src/control/spendCaps.ts` (`gateClaim`), `src/control/webDispatch.ts` (`deliverScheduledStart`; `WebDispatchDeps.now?: () => number`), `src/control/webService.ts` (`claimEstimate`), `src/control/requirementCalls.ts` (`claimRequirementCallInTransaction(store, groupId, at = Date.now())` → `"capped"`; `claimRequirementCall` treats `"capped"` like `"held"`), `src/control/planImport.ts` (`ImportedPlanWrite.commandId`, `at?`; the ceiling after `groupLimit`), `src/control/requirementCommands.ts:232` (pass `commandId`), `src/panel/controlApi.ts` (map `AgentCeilingRefusal` → 403), `src/control/webProtocol.ts` (`spendCapBlock` optional on `groupViewSchema` and `requirementViewSchema`), `src/panel/controlViews.ts` (read `spend_cap_blocks`)
- Test: `tests/control/spendGate.test.ts`, `tests/panel/agentCeiling.test.ts`

**Interfaces:**
- Produces: `gateClaim(store: ControlStore, groupId: string, grantTokens: number, at: number): boolean` (true = may claim; writes or clears `spend_cap_blocks` and records a projection change only when the row changes); block body `{ code: "spend-cap-reached", scope, period, capTokens, grantTokens }`; views: `spendCapBlock?: { code: "spend-cap-reached"; scope: string; period: "total" | "week" | "month"; capTokens: number; grantTokens: number } | null`.

- [ ] **Step 1: Failing tests** `tests/control/spendGate.test.ts` (fixtures: `startedFixture`/`claimRunId` pattern of `tests/control/webDispatch.test.ts`, `webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b" }])`, a mutable clock passed as `now` in the dispatch deps):

  1. "blocks at headroom, claims nothing, keeps the wake, and resumes after a cap raise without a command": grant `G` = work item `a`'s `grant.work.tokens + grant.handoff.tokens`; insert `spend_caps('all','total',G-1,…)`; `deliverScheduledStart` → `{ kind: "blocked", reason: "spend-cap-reached" }`; no row in `runs`; the start wake still `delivered=0`; `readControlGroup(...).spendCapBlock` → `{ code: "spend-cap-reached", scope: "all", period: "total", capTokens: G-1, grantTokens: G }`; `UPDATE spend_caps SET tokens=?` to `G`; deliver → `claimed`; `spendCapBlock` → null.
  2. "a new week resumes it": cap `all/week = G`; a `usage_ledger` row of `1` token at `now` (repo of `g`); deliver → blocked; `now += 8 days`; deliver → claimed.
  3. "what claimed runs still hold is committed": cap `all/total = Ga + Gb - 1`; claim `a` → claimed; `replenishStartWakes({ store })`; claim → blocked (committed `Ga`).
  4. "an estimate waits under a cap": after import the estimate is queued; cap `all/total = 1`; `service.claimEstimate("g", estimateId)` → estimate state stays `queued`; `spend_cap_blocks` has `g`.
  5. "a clarify or split call waits under a cap": with `requirementHarness` (read `tests/control/fixtures/requirementHarness.ts` for how a criterion opens a requirement), cap `all/total = 1`; `store.transaction(() => claimRequirementCallInTransaction(store, groupId, at))` → `"capped"`; the requirement-call wake stays pending after `deliverSchedulerWakes`.
  6. "a cap never aborts a run in progress": claim `a`; set cap `all/total = 1`; book usage over it with `recordUsage` → the run is still `active=1` and its state unchanged.

  `tests/panel/agentCeiling.test.ts`:
  1. "an agent's import over headroom is refused, rolled back and books nothing; a user's is accepted": replicate `webFixture`'s import call (`tests/control/fixtures/web.ts`, the `importControlPlan({ ...deps, estimatorObservation: … }, importCommand)` line) for group `g2` with cap `all/total = 1`, once inside `withCommandContext(id, { client: "cli", principal: "agent:cli" }, …)` → throws `AgentCeilingRefusal` with `limitTokens` = the import's group limit; no `groups` row `g2`; no `commands` row for that id; then inside `{ client: "web", principal: "user:u1" }` with a new id → imported.
  2. "the route answers 403 control-limit-over-cap-headroom": `express()` app, a middleware setting `res.locals.orcaPrincipal = { kind: "agent", client: "cli" }` and `res.locals.orcaClient = "cli"`, `express.json()`, `registerControlMutationRoutes(app, store, service, "socket")` with `service.importPlan` throwing `new AgentCeilingRefusal(cap, 9)`; POST `/api/control/groups/import-plan` with a valid envelope → 403 and `error.code === "control-limit-over-cap-headroom"`, `retryable: false`.
  3. "requirement-draft-accept from an agent is held to the same ceiling": with `requirementHarness` driven to an accepted-ready draft, cap `all/total = 1`, accept inside an agent context → `AgentCeilingRefusal`; the draft is still `awaiting-review`.

- [ ] **Step 2: Run** both → `rc=1`.
- [ ] **Step 3: Implement `gateClaim`:**

```ts
/** Spec §6.3.1, D9: called inside the claim's transaction. A block is a deferred wake, re-checked on every wake. */
export function gateClaim(store: ControlStore, groupId: string, grantTokens: number, at: number): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const blocking = spendCapBlocking(store, groupRepoIdOf(JSON.parse(String(row.body)) as Record<string, unknown>), grantTokens, at);
  const prior = store.db.prepare("SELECT body FROM spend_cap_blocks WHERE group_id=?").get(groupId);
  if (blocking === null) {
    if (prior) { store.db.prepare("DELETE FROM spend_cap_blocks WHERE group_id=?").run(groupId); recordProjectionChange(store, [groupId]); }
    return true;
  }
  const body = JSON.stringify({ code: "spend-cap-reached", scope: blocking.scope, period: blocking.period, capTokens: blocking.tokens, grantTokens });
  if (!prior || String(prior.body) !== body) {
    store.db.prepare("INSERT INTO spend_cap_blocks(group_id,body) VALUES (?,?) ON CONFLICT(group_id) DO UPDATE SET body=excluded.body").run(groupId, body);
    recordProjectionChange(store, [groupId]);
  }
  return false;
}
```

- [ ] **Step 4: Call sites.**
  - `deliverScheduledStart`, inside the transaction after the `blocked` (capability) branch and before the continuation/normal claim: the tokens of what this delivery would claim — the actionable continuations' work items (`claimableContinuations(...)`'s task ids) when `still` is a resume wake and any are actionable, otherwise `nextClaimableTask(...)`'s work item — each `grant.work.tokens + grant.handoff.tokens`; when that sum is > 0 and `!gateClaim(store, groupId, sum, deps.now?.() ?? Date.now())`, return `{ kind: "blocked" as const, reason: "spend-cap-reached" }` (the handler then leaves the wake pending).
  - `claimEstimate`: before `insertSingleCallRun`, `if (!gateClaim(this.store, id, estimate.grant.tokens, <service clock in ms>)) return null;` — read `WebServiceDeps.now`'s type and convert to epoch ms.
  - `claimRequirementCallInTransaction`: after the `fits` check, `if (!gateClaim(store, groupId, REQUIREMENT_CALL_GRANT.tokens, at)) return "capped";`.
  - `writeImportedPlan`: after `const groupLimit = …`:

```ts
  // Spec §6.3.2 (H10), D4, D10: an agent's import may not promise more than the caps leave.
  if (commandPrincipalFor(input.commandId)?.startsWith("agent:")) {
    const blocking = spendCapBlocking(deps.store, input.repoId, groupLimit.tokens, input.at ?? Date.now(), input.groupId);
    if (blocking !== null) throw new AgentCeilingRefusal(blocking, groupLimit.tokens);
  }
```

  - `controlApi.ts` catch, first branch: `if (error instanceof AgentCeilingRefusal) { sendControlError(res, 403, "control-limit-over-cap-headroom", \`the import's limit of ${error.limitTokens} tokens exceeds the ${error.cap.scope} ${error.cap.period} cap's headroom of ${error.cap.headroom}; a person can import it from the Web UI or raise the cap\`); return; }`. Add `control-limit-over-cap-headroom` (403) to `panelOnlyErrorStatuses` and its zh/en copy; add `spend-cap-reached` to the locales (shown on the group).
  - Views: `readControlGroup` and `readRequirementView` add `spendCapBlock: <parsed row body> ?? null`.
- [ ] **Step 5: Run** both files, `tests/control/webDispatch.test.ts`, `tests/control/requirement*.test.ts`, `tests/control/estimate*.test.ts`, `tests/panel/controlReadApi.test.ts` → `rc=0`; then `npx vitest run tests/control tests/panel > $SCRATCH/t10.txt 2>&1; echo rc=$?` → `rc=0` (flakes per Task 14); typecheck `rc=0`.
- [ ] **Step 6: Mutations (clone):** (a) delete the gate call in `deliverScheduledStart` → test 1 red; (b) `gateClaim` never deletes the block → test 1's null assertion red; (c) the start handler counts `spend-cap-reached` as delivered (return `idle` instead of `blocked`) → wake assertion red; (d) delete the estimate gate → test 4 red; (e) `"capped"` counted as delivered → test 5 red; (f) delete the ceiling block → agent import test red; (g) delete the `AgentCeilingRefusal` branch in the route → 500 instead of 403, route test red; (h) compare against `limit` (with carry) instead of `groupLimit` — record whether test 3 sees it (equivalent when carry is 0; if so, add a carried-spend case and record).
- [ ] **Step 7: Commit** `feat(control): gate every claim and agent imports on the spend caps`.

---

### Task 11: Web UI — login, account bar, notices, Usage panel, capped groups

**Files:**
- Create: `web/src/auth.ts`, `web/src/AuthGate.tsx`, `web/src/UsagePanel.tsx`; Test: `web/tests/authGate.test.tsx`, `web/tests/usagePanel.test.tsx`
- Modify: `web/src/main.tsx` (`<AuthGate><App /></AuthGate>`), `web/src/App.tsx` (metrics section renders `<UsagePanel project={project} />` after `<MetricsView …/>`), `web/src/ControlGroupView.tsx` (a `spendCapBlock` line with a link to `#metrics`), `web/src/controlTypes.ts` (`spendCapBlock?`), `web/src/locales/{en,zh}.ts` (`auth.*`, `usage.*`), `web/src/styles.css` (only what the new elements need), `README.md` (a "Logging in" paragraph: initial password file, `orca user`, `--session-days`)

**Interfaces:**
- Produces: `web/src/auth.ts`: `interface Me { user: { id: string; name: string; roles: Array<"owner" | "member">; mustChangePassword: boolean }; expiresAt: number; sessionDays: number }`; `fetchMe(): Promise<Me | null>` (null on 401); `login(name, password): Promise<PostResult<{ user: Me["user"] }>>`; `logout()`; `changePassword(current, next)`; `refreshSession(): Promise<{ expiresAt: number } | null>`; `addUser(input: { name: string; role: "owner" | "member"; password: string })`; `fetchNotices()`; `ackNotice(seq: number)`; `shouldRefresh(me: Me, nowMs: number): boolean` (`expiresAt - now < sessionDays * 86_400_000 / 2`). `AuthGate.tsx`: `AccountContext` (`React.createContext<Me | null>(null)`), `AuthGate({ children })`. `UsagePanel.tsx`: `UsagePanel({ project }: { project: string | null })`.

- [ ] **Step 1: Failing tests** `web/tests/authGate.test.tsx` (mock `fetch` as the existing web tests do; `document.cookie = "orca_csrf=t"`):

```tsx
describe("AuthGate (spec §7)", () => {
  it("shows the login form on 401 and the app after a successful login", async () => {
    // fetch: GET /api/auth/me → 401 first, then 200 {user:{name:"amy",roles:["member"],mustChangePassword:false},expiresAt:…,sessionDays:15}; POST /api/auth/login → 200
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByRole("form", { name: /log in/i });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "amy" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "amy's password" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    await screen.findByText("app body");
    expect(screen.getByText("amy")).toBeTruthy();
    expect(screen.getByRole("button", { name: /log out/i })).toBeTruthy();
  });
  it("shows only the change-password step while mustChangePassword is set, and sends the CSRF header", async () => { /* me → mustChangePassword true; submit; assert POST /api/auth/password carried x-orca-csrf: t; then app body */ });
  it("refreshes when less than half the lifetime is left", () => {
    expect(shouldRefresh({ user: u, expiresAt: 10 * 86_400_000, sessionDays: 15 }, 2 * 86_400_000)).toBe(true);
    expect(shouldRefresh({ user: u, expiresAt: 10 * 86_400_000, sessionDays: 15 }, 3 * 86_400_000)).toBe(false);
  });
  it("shows owners the security notices and acknowledges one; members see none", async () => { /* notices fetched only for an owner; clicking dismiss POSTs /api/auth/notices/3/ack */ });
});
```

`web/tests/usagePanel.test.tsx`: given a `GET /api/control/usage?scope=all&groupBy=model…` answer (two models, one unattributed entry, counts `{unattributedRows:1, breakdownMismatchRows:2, unknownUsageRuns:0}`, one cap `{scope:"all",period:"week",tokens:1000,used:400,committed:100,headroom:500}`, `spendRevision: 3`), the panel renders the headline totals, a row per model with input/output/cache read/cache write/total, the two counts, and the cap row with used/committed/headroom; for an owner (`AccountContext` value with `owner`) it renders "Set"/"Clear" controls and the calendar form, and "Set" POSTs `/api/control/operator/set-spend-cap` with `{ commandId, expectedRevision: 3, payload: { scope: "all", period: "week", tokens: 2000 } }` and `x-orca-csrf`; for a member none of those controls exist; with `caps: []` it shows the "no cap set — nothing is gated" sentence (spec §6.3 last line); a project scope sends `scope=repo:<id>`; the period picker sends `from`/`to` for a custom range and `groupBy=day|week|month`.

Add to an existing control-view test file only by a new `it` (add-only): a group view with `spendCapBlock` renders its scope/period/cap and a link `href="#metrics"`.

- [ ] **Step 2: Run** `npm run --ws check > $SCRATCH/t11red.txt 2>&1; echo rc=$?` → `rc=1` (new files missing).
- [ ] **Step 3: Implement.** `auth.ts` uses `getJson`/`postJson` from `web/src/api.ts` (CSRF from Task 4) except `fetchMe`, which maps 401 to null. `AuthGate`: states `loading | login | change | ready`; on `ready` renders an account bar (`<header className="account-bar">` with the name, role and a Log out button) above `children`, wrapped in `AccountContext.Provider`; a `setInterval` every 10 minutes calls `refreshSession()` when `shouldRefresh`; owners get a dismissible notices banner (each notice: kind, user name from `body`, time; "Dismiss" → `ackNotice`). Owners also get an "Add user" form (name, role, password typed twice, ≥ 12 chars checked before sending) inside the account bar's menu. `UsagePanel`: scope picker (All projects / the current project), period picker (Day / Week / Month / Custom with two `datetime-local` inputs converted to epoch ms), headline totals from `headline`, the per-model table from `range.byModel` (null model labeled "unattributed"), the counts, caps with used/committed/headroom (owner: inline Set with a tokens input, Clear; member: read-only), calendar (owner: time zone text input + week start select; sends `set-usage-calendar`). Commands go through the existing command helper in `web/src/controlApi.ts` with the scope `@spend` result lookup it already supports for `@operator`/`@repository` (read it and reuse; if it needs the scope string, pass `@spend`). Every string goes through i18n with zh and en entries (the i18n key-parity criteria must stay green).
- [ ] **Step 4: Run** `npm run --ws check > $SCRATCH/t11.txt 2>&1; echo rc=$?` → `rc=0`; `npm run build --workspace web > $SCRATCH/t11b.txt 2>&1; echo rc=$?` → `rc=0`; `npx vitest run tests/panel/scanPanelText.test.ts tests/panel/refusalCoverage.test.ts > $SCRATCH/t11s.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutations (clone):** (a) `AuthGate` renders children while `mustChangePassword` → change-step test red; (b) member gets the Set button → member assertion red; (c) drop the CSRF header in `postJson` → CSRF assertions red; (d) `shouldRefresh` uses `<= sessionDays * 86_400_000` → refresh test red.
- [ ] **Step 6: Commit** `feat(web): log in, see usage per model and set spend caps in the panel`.

---

## Part B: ccloop — per-model usage on collect events

**Where:** `/Users/biran/code/skills/loop/ccloop`, in a new worktree on a new branch (memory: parallel agents use a worktree branch; ccloop has its own rounds on `main`): `git -C /Users/biran/code/skills/loop/ccloop worktree add ../ccloop-usage-by-model -b orca/usage-by-model main`. Work only there.

**Rules that apply here (ccloop's, not Orca's):** ccloop CLAUDE.md Rules 13–18. In particular: no existing ccloop criterion is edited by the implementer (Rule 15) — Part B is add-only; if an existing criterion goes red, stop Part B, record the red (command, file, assertion) in the Orca ledger under "Part B" and in the checkpoint's `awaitingHuman`, and wait for the human to name it. Rulings are the human's (Rule 18). Mutations only in a `git clone --local` copy of the worktree branch (Rule 17). The controller never pushes, merges or deletes the branch (Rule 13).

**Parallelism:** Part B can run beside Orca Tasks 1–11 (disjoint repositories). Orca Task 12 waits for B-gate **and** for the human to merge and push ccloop.

**Shared shape (ccloop side):** `interface ModelUsageV1 { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }`; `input` is non-cached input (D7); arrays sorted by `model`, unique; `byModel` on a usage event is present only when known (absent otherwise, so pre-existing events and fixtures hash and compare identically).

### Task B1: Usage observations and events carry `byModel`

**Files:** Modify: ccloop `src/control/usage.ts` (input `byModel?: ModelUsageV1[]`; event keeps it when given; state schema accepts it), `src/control/command.ts:118-126` (`usageEventSchema` accepts optional `byModel`); Test (new): ccloop `tests/control/usageByModel.test.ts`

**Interfaces:** Produces `modelUsageSchema`, `byModelSchema` exported from `src/control/usage.ts`; `appendUsageObservation(sourceDir, input & { byModel?: ModelUsageV1[] })`.

- [ ] **Step 1: Failing test** `tests/control/usageByModel.test.ts`:

```ts
describe("per-model usage on events (Orca accounts spec §4.1)", () => {
  it("keeps a sorted breakdown on the event, absent when none was given, and refuses an unsorted one", async () => {
    const sourceDir = await root();
    const withBreakdown = await appendUsageObservation(sourceDir, { ...observation("p1", 65), byModel: [{ model: "haiku", input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, { model: "opus", input: 30, output: 10, cacheRead: 8, cacheWrite: 2 }] });
    expect(withBreakdown.byModel?.map((e) => e.model)).toEqual(["haiku", "opus"]);
    const without = await appendUsageObservation(sourceDir, observation("p2", 70));
    expect(Object.hasOwn(without, "byModel")).toBe(false);
    await expect(appendUsageObservation(sourceDir, { ...observation("p3", 80), byModel: [{ model: "z", input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, { model: "a", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }] })).rejects.toThrow("control-usage-invalid");
    expect((await readUsageEvents(sourceDir)).map((e) => e.eventSeq)).toEqual([1, 2]);
  });
  it("collect's schema passes a breakdown through", () => { /* usageEventSchema via the collect answer parser in command.ts accepts an event with byModel */ });
});
```

(`root()` and `observation()` as in ccloop `tests/control/usage.test.ts`; copy them, do not import from a test file.)

- [ ] **Step 2:** `npx vitest run tests/control/usageByModel.test.ts > $SCRATCH/b1.txt 2>&1; echo rc=$?` → `rc=1`.
- [ ] **Step 3: Implement** (schemas `.optional()`, the event spreads `...(input.byModel === undefined ? {} : { byModel: input.byModel })`; the observation hash already covers the input, so a replay with a different breakdown is `control-usage-conflict`).
- [ ] **Step 4:** the file → `rc=0`; then the whole ccloop suite `npm test > $SCRATCH/b1all.txt 2>&1; echo rc=$?` → `rc=0` with no existing criterion changed (`git diff --stat main -- tests` lists only the new file). Any red → stop (see Rules above).
- [ ] **Step 5: Mutations (clone):** (a) drop the spread → the breakdown assertion red; (b) drop the sort refine → unsorted assertion red.
- [ ] **Step 6: Commit** (ccloop branch) `feat(control): carry a per-model breakdown on usage events`.

### Task B2: claude reports `modelUsage`; the worker accumulates it

**Files:** Modify: ccloop `scripts/claude-stream.mjs` (export `buildModelUsage(envelope)`), `scripts/claude-phase-runner.mjs` (response gains `modelUsage` when the envelope has a `modelUsage` map; single-call answer too), `src/runtime/types.ts` (optional `modelUsage?: ModelUsageV1[]` on `AttemptPlan`, `ExecutionArtifacts`, `VerificationResult`, `SingleCallResult`), `src/runtime/claude/claudeAgentAdapter.ts` (`singleCall` returns `modelUsage` when present), `src/controller/runLoop.ts` (`settlePhase` passes `modelUsage` into `onPhaseSettled`'s observation), `src/control/worker.ts` (per-model accumulator beside `cumulativeTokens`), `src/control/singleCall.ts` (passes `byModel` when the result has it); Test (new): ccloop `tests/runtime/claude/claudeModelUsage.test.ts`, `tests/control/workerByModel.test.ts`

- `buildModelUsage(envelope)`: reads `envelope.modelUsage` (an object keyed by model; each value's `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` must be finite non-negative integers, else the whole breakdown is `null`); returns entries `{ model, input: inputTokens, output: outputTokens, cacheRead: cacheReadInputTokens, cacheWrite: cacheCreationInputTokens }` sorted by model, or `null` when the map is absent or empty.
- Worker accumulator: `let byModel: Map<string, ModelUsageV1> | null = new Map()`. On each settled phase with `tokenUsage !== null`: if `byModel !== null` and the observation has `modelUsage`, add each entry; if `byModel !== null` and the phase spent tokens (`tokenUsage > 0`) without `modelUsage`, set `byModel = null` for the rest of the run (an unknown share cannot be recovered). Pass `byModel: [...byModel.values()].sort(...)` to `appendUsageObservation` only while `byModel !== null` **and** the accumulated `Σ entryTotal === cumulativeTokens`; otherwise pass nothing. (ccloop never emits a breakdown it knows does not reconcile; Orca still checks.)
- [ ] **Step 1: Failing tests:** (a) `buildModelUsage` on a result envelope with `modelUsage: { "claude-opus-5-5": {inputTokens: 30, outputTokens: 10, cacheReadInputTokens: 8, cacheCreationInputTokens: 2, costUSD: 0.1}, "claude-haiku-4-5": {inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0} }` → two sorted entries; a string value → `null`; absent → `null`. (b) runner end-to-end with the fake claude used by `tests/runtime/claude/claudePhaseRunner.test.ts`, printing such a result whose `usage` totals `input_tokens 40, output_tokens 15, cache_read 8, cache_creation 2` (so `normalizedTotal` 65 equals the breakdown) → runner stdout carries `modelUsage` with both models. (c) `workerByModel.test.ts`: drive `onPhaseSettled` the way ccloop `tests/control/worker.test.ts` does (it already simulates the worker's usage accounting) for two phases with breakdowns → the second event's `byModel` holds the per-model sums and reconciles to `cumulative.tokens`; a third phase with tokens and no breakdown → that event and later ones have no `byModel`.
- [ ] **Step 2:** run the new files → `rc=1`.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4:** new files → `rc=0`; whole suite → `rc=0`, no existing criterion changed. Any red → stop.
- [ ] **Step 5: Mutations (clone):** (a) `buildModelUsage` ignores a bad value instead of returning null → (a) red; (b) the worker keeps accumulating after a phase without a breakdown → (c) red; (c) the worker emits a non-reconciling breakdown → (c)'s reconciliation assertion red.
- [ ] **Step 6: Commit** `feat(claude): report usage per model from claude's modelUsage`.

### Task B3: codex reports its single model

**Files:** Modify: ccloop `src/runtime/codex/protocol.ts` (new export `codexModelUsage(events: string, model: string): ModelUsageV1[] | null` — re-reads the `turn.completed` usage that `decodeCodexResult` validated: `input = input_tokens − (cached_input_tokens ?? 0)`, `output = output_tokens`, `cacheRead = cached_input_tokens ?? 0`, `cacheWrite = 0`; `decodeCodexResult` is unchanged), `src/runtime/codex/codexAdapter.ts` (attach `modelUsage: codexModelUsage(outcome.events, config.model)` to the decoded phase result when non-null); Test (new): ccloop `tests/runtime/codex/codexModelUsage.test.ts`

- [ ] **Step 1: Failing test:** `codexModelUsage` for `{input_tokens: 15, output_tokens: 3, cached_input_tokens: 5}` and model `gpt-x` → `[{ model: "gpt-x", input: 10, output: 3, cacheRead: 5, cacheWrite: 0 }]`, whose `entryTotal` 18 equals `decodeCodexResult(...).tokenUsage`; without `cached_input_tokens` → `input: 15, cacheRead: 0`; no completion → `null`. An adapter-level case with ccloop's fake codex (`tests/fixtures/fake-codex.mjs`) → the phase result carries `modelUsage` with the configured model.
- [ ] **Steps 2–4:** red, implement, green; whole suite green with no existing criterion changed (in particular `tests/runtime/codex/protocol.test.ts` untouched and green). Any red → stop.
- [ ] **Step 5: Mutations (clone):** (a) `input = input_tokens` (no subtraction) → reconciliation assertion red; (b) adapter does not attach → adapter case red.
- [ ] **Step 6: Commit** `feat(codex): report usage for the run's model`.

### Task B4: capability flag `usageBreakdown` — waits for the human

The flag is a sibling of `singleCallExecution` in the capabilities resolution (D8): `usageBreakdown: "per-model"` for claude and codex descriptors. Emitting it changes the exact answer `tests/control/singleCallCapability.test.ts` C1 compares with `toEqual`, an existing criterion ccloop Rule 15 lets only the human name. **Do not implement until the human either names C1 for rewrite (and any other criterion that then goes red) or drops the flag.** Orca needs nothing from it (it accepts the field optionally, Task 7). Record in the checkpoint's `awaitingHuman`: "ccloop B4: name singleCallCapability C1 for the usageBreakdown flag, or drop the flag (Orca consumes no behavior from it)". If named: add the field in the descriptors (`singleCallExecution`'s sibling in `src/control/command.ts` `defaultHandler` and `capabilitiesSchema`), rewrite exactly the named criteria (whole swap, not loosened), mutation: drop the field → the rewritten C1 red.

### B-gate

- [ ] In the ccloop worktree, each to its own file with `echo rc=$?`: `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:control`. All `rc=0`. Read each file whole.
- [ ] Collect B1–B3 (B4 if done) mutations into the Orca ledger "Part B" section: mutation, criterion, observed red, restore proof.
- [ ] Record in the checkpoint's `awaitingHuman`: "ccloop branch `orca/usage-by-model` (commits …) is green; merge it into ccloop main and push, then tell the Orca session the pushed 40-hex commit". The controller does not merge or push (ccloop Rule 13, Orca Rule 15).

---

### Task 12: Re-pin ccloop and pin the per-model wire end to end

**Precondition:** the human has merged and pushed the Part B branch and given the pushed commit `<sha>` (40 hex). Without it, this task stays open and Task 13 runs on the old pin (Orca accepts events without `byModel`; the gate is still meaningful) — record which.

**Files:** Modify: `package.json`, `package-lock.json` (by the script only); Test (new): `tests/control/usageByModelE2E.test.ts`

- [ ] **Step 1: Re-pin** on a clean tree: `node scripts/pin-ccloop.mjs <sha> > $SCRATCH/t12pin.txt 2>&1; echo rc=$?` → `rc=0`; read the file whole (its checks: exact spec form, lock changes only root/ccloop, built package, default-package E2E). Note: the current pin is `c3af4d6`, older than ccloop `main` (`b9b87d6` when this plan was written); the re-pin brings in every ccloop commit between them — list them in the ledger (`git -C <ccloop> log --oneline c3af4d6..<sha>`).
- [ ] **Step 2: Failing test** `tests/control/usageByModelE2E.test.ts`, on the real-ccloop world (`tests/control/fixtures/ccloopWorld.ts`, as `tests/control/neverStartedUsage.test.ts` uses it, gated the same way when `ORCA_CCLOOP_BIN` is unset — at run time with `ctx.skip()`, per `tests/setup/scopeTmpdir.ts`'s erratum): start one group whose task runs on the fake codex to completion; then `SELECT model,tokens,quality FROM usage_ledger WHERE source='run-work'` → every row `quality = "reported"` and `model` = the codex installation's model; `SUM(tokens)` = the group's `used.tokens`; the handoff bucket books no row (D16). Run it against the **old** ccloop build first (a clone at `c3af4d6`, built) → red (rows `unattributed`) — this is the criterion's own red, seen before the pin.
- [ ] **Step 3: Run** with `ORCA_CCLOOP_BIN` = the newly pinned build (`node_modules/ccloop/dist/cli.js` or a clone at `<sha>`, built) → `rc=0`; and `node scripts/verify-ccloop-pin.mjs > $SCRATCH/t12vp.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 4: Commit** `chore(deps): repin ccloop to report usage per model` (`git add package.json package-lock.json tests/control/usageByModelE2E.test.ts`).

---

### Task 13: Final gate, mutation table and ledger close

**Files:** Modify: `.superpowers/sdd/2026-10-07-accounts-and-spend-caps/progress.md` (append only)

- [ ] **Step 1: Isolated clone gate.** `git clone --local` the final commit into `$SCRATCH/orca-acct-gate`; HOME, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` relocated into `$SCRATCH/home` (created `0700`); a short real `TMPDIR` (e.g. `/private/tmp/claude-501/oa<n>/t`, so socket paths stay under 104 bytes); `ORCA_CCLOOP_BIN` = a build of the pinned ccloop clone (the Task 12 `<sha>`, or `c3af4d6` if Task 12 is still open — say which); `ORCA_AGENTS_TABLE` = the fake codex `integration` agents table used by the N2 gate (`.superpowers/sdd/2026-10-07-agent-entry/progress.md`, Task 9 section). `npm ci`, then each into its own file with `echo rc=$?` appended: `npm run build --workspace web`, `npm run typecheck`, `npm run --ws check`, `npm run verify:control`, `npm run verify:panel`, `npm test`, `node scripts/check-tmp-leak.mjs`. Read every file whole (or, for the full test log, its summary plus a count of `FAIL` lines, and say so — Rule 14).
- [ ] **Step 2: Known load flakes.** A failure in one of these is re-run alone three times with `uptime` before each run and recorded with the load averages: `tests/chain/gateCheck.test.ts` K13, `driverRequirementSplit`, `driverRecovery`, `controlShutdown` (exit 143), `agentSelectionE2E` C3, `driverLanding`, `driverProgress` R2, `executionDriverE2E`, `ccloopPort`, web `controlCommandRecovery`, web `agentPreviewRefresh`. Any other failure is real and is fixed before the round closes.
- [ ] **Step 3: Real home untouched.** `ls -la ~/.orca/control > $SCRATCH/home-after.txt` compared with a listing taken before Task 1 (`$SCRATCH/home-before.txt`): `cmp` → `rc=0` (no `accounts.sqlite`, `jwt.key` or `initial-password` appeared in the person's real control root).
- [ ] **Step 4: Mutation table.** Every mutation from Tasks 1–12 and B1–B4: mutation, criterion, observed red (test + assertion), restore proof (`git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0 in the clone). Equivalent mutants listed with the reason.
- [ ] **Step 5: Append to the ledger** the gate table (command, rc, counts, load, commit subject), the mutation table, D1–D19 as adopted, every `Ruling:` line's outcome, the rewrite inventory as executed (count and any additions), and `awaitingHuman` (ccloop merge/push if Task 12 is open; B4 naming; D19 gap). Commit `docs(sdd): close the accounts and spend caps round in its ledger` with `git add -f`.

---

## Self-review

- **Spec coverage:** H1/H5/§3.4 (Tasks 3–4), H2 (no platform mechanism anywhere; scrypt/HMAC from node:crypto), H3/§2/§12 (stated in SKILL.md and D12; no tamper detection), H4/H4a/H4b/§3.1–§3.3 (Tasks 2–3, D1, D2, D13), H6/§3.5 (Task 5), H7/H8/§6 (Tasks 9–10, Task 11 UI), H9/§4 (Task 7 Orca side; Part B; Task 12), H10/§6.3.2 (Task 10), §5.1 (Tasks 1, 7, D15–D16, D18), §5.2 (Task 8), §5.3 (Task 8), §6.2 (Task 9, D4), §6.3.1/§6.3.3 (Task 10), §7 (Task 11; first-run page superseded by D2), §8 (Tasks 3, 8, 9; skill in Task 9), §9 (Task 1; x-orca-token removal Task 4), §10 criteria (auth: Tasks 3–4; human-only + C19: Tasks 5, 9; `orca user`: Task 6; ledger: Task 7; calendar: Task 8; caps: Tasks 9–10; ccloop: B1–B3, Task 12; mutations and relocation: every task). Gaps stated, not hidden: D19 (legacy `claimWork` not gated); B4 waits on the human; real claude's `usage` vs `modelUsage` agreement is unmeasured (no paid run) — a real claude run whose totals disagree lands as `breakdown-mismatch` rows, visible in the Usage panel's count.
- **Placeholder scan:** test bodies given as comments (Task 9 headroom/verbs, Task 6 rotate-key, Task 11 three web cases, Task 10 cases 4–5) state every value to assert and the fixture to use; the implementer writes them out in full before running red.
- **Type consistency:** `Role`, `AccessClaims`, `UserRow`, `AccountsStore`, `PanelAuth`, `Session`, `Principal`, `ModelUsage`, `UsageScope`, `UsageCalendar`, `CapStatus`, `AgentCeilingRefusal`, `gateClaim`, `spendCapBlocking`, `withCommandContext`/`commandPrincipalFor` carry the same names and signatures in every task that uses them.
