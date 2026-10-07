# Accounts, per-model usage and spend caps — design

Session 9a20ac38, 2026-10-07. Status: draft for human review.
Follows the N2 agent entry (`2026-10-07-agent-entry-design.md`, §13 and §14).

## 1. Human rulings this design encodes

- H1. The human-only gate must become a real boundary at the interface, not only a guardrail for cooperating agents (N2 spec §13).
- H2. No separate OS user and no system-level user isolation. The system is cross-platform; macOS and Linux are the targets. No platform-specific mechanism (Touch ID, Keychain).
- H3. Interface layer only: tampering with the store directly is out of scope (no start-up unlock, no row signatures).
- H4. Human proof is a user account with a password, JWT-style sessions. The account model must be extensible: multi-user login comes later.
- H4a. The default user's initial password is a truncated hash; the default user can change it; added users type their own password directly.
- H4b. A token is valid for 15 days or a month by default and can be refreshed.
- H5. The whole Web UI requires login. The page no longer carries a token.
- H6. Requests on the control socket (CLI, MCP, skill) act as a separate `agent` principal: everything except human-only actions.
- H7. Spend caps are measured in tokens. Usage is tracked per model, because model prices differ; a per-model price table can turn it into dollars later (not in this design).
- H8. Caps can be set overall and per project; each cap is total, weekly or monthly, and any subset may be set (only an overall total, only a monthly, …). The human sees current usage (total / this week / this month, period adjustable) and changes the caps.
- H9. Usage tokens come from ccloop as a per-model breakdown (ccloop protocol change), not attributed to the run's selected model.
- H10. Agent-channel imports may not produce a group limit beyond what the caps leave (the "agent ceiling" from the N2 review).

## 2. Threat model

The boundary holds against any process that talks to Orca through its interfaces: the panel's TCP port (with or without a stolen page), the control socket, `orca control`, `orca mcp serve`. Such a process cannot perform a human-only action without a human's password.

It does not hold against a process running as the same OS user that:
- writes the control store directly (adds a user row, edits a cap), or edits Orca's code (H3);
- reads the JWT signing key file or the initial-password file (§3.2, §3.3).

Spend that bypasses Orca entirely (an agent running a model CLI itself) is outside what any Orca limit can bound. The residuals are restated in the UI help text and §12.

## 3. Accounts and sessions

### 3.1 Data

Migration 7→8 adds:

- `users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, roles TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER) STRICT`.
  - `password_hash`: `scrypt$N$r$p$<salt b64>$<hash b64>` from `node:crypto` scrypt (N=2^17, r=8, p=1, 32-byte salt, 64-byte key). No native dependency; identical on macOS and Linux.
  - `roles`: JSON array; v1 knows `owner` and `member`. `owner` may do human-only actions; `member` may do everything else. Roles are checked through one permission table in code (§3.5), so adding a role is a table edit.
- `sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER) STRICT` (§3.3).
- `users` also has `must_change_password INTEGER NOT NULL DEFAULT 0` (§3.2).
- `security_events(seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT` — user created / password changed / user disabled / login failed (rate-limited summary) / cap changed. Append-only from code.

### 3.2 Users: the default owner and added users

- **Default owner.** When a panel starts on a store with no user, it creates one owner named after `--by` (the panel's operator id), with an initial password = the first 16 hex characters of SHA-256 over 32 random bytes. The panel writes the password once to its stderr log line `orca-panel: initial password for <name> written to <path>` (the password itself is not logged) and to `<control root>/initial-password` (mode 0600, created with an explicit mode, Rule 17). The user row carries `must_change_password = 1`.
- First login with the initial password succeeds only into a "change your password" step; every other route answers 403 `password-change-required` until it is changed. Changing it deletes `initial-password` and records a `security_events` row.
- **The default owner can change** their password and their display name (`POST /api/auth/password {current,next}`, `POST /api/auth/profile {name}`); so can every user for themselves.
- **Added users set their own password directly**: an owner adds a user in the UI (name, role, password typed for that user) or with `orca user add <name> [--role owner|member]`, which reads the password twice from a TTY (refuses a non-TTY stdin; never from argv or env). No generated password and no forced change for added users.
- `orca user passwd <name>` (TTY) is the recovery path when an owner forgets a password; `orca user disable <name>` revokes a user and their sessions.
- Minimum password length 12 for changed and added passwords (the initial one is 16 hex).
- Every `security_events` row of kind user-created / password-changed / user-disabled shows in the UI as a notice until an owner acknowledges it, so a user row added by a same-user process (§2 residual) is visible the next time an owner logs in.

### 3.3 Tokens

- Login: `POST /api/auth/login {name,password}` → a JWT (HS256) in cookie `orca_at` (`HttpOnly; SameSite=Strict; Path=/`), claims `{sub,roles,sid,iat,exp}`.
- Lifetime: 15 days by default, configurable per panel (`--session-days <n>`, 1..30).
- Refresh: `POST /api/auth/refresh` with a still-valid token issues a fresh one with a new `exp` (same `sid`). The SPA calls it when less than half the lifetime is left, so an active human is never logged out.
- Revocation: every request checks that the `sid` row in `sessions` exists and is not revoked, so logout and disabling a user take effect immediately even though the token is a JWT. `sessions` stores `sid`, user, created/expires/revoked times; no secret.
- Signing key: 32 random bytes in `<control root>/jwt.key`, mode 0600, created on first start (explicit mode; an existing file keeps its mode). It persists so a panel restart (the daemon restarting) does not log anyone out. A same-user process that reads it can mint a token: the same residual class as writing the store (§2, §12). `orca user rotate-key` replaces it and so logs everyone out.
- Login attempts: per-name exponential delay after 5 failures (in memory), one summary row in `security_events`.
- `--bind` (external mode) keeps its existing warning; with login it no longer ships a credential in HTML. TLS is still out of scope.

### 3.4 What changes for the Web UI

- `window.__ORCA_TOKEN__` and the `x-orca-token` header are removed. All `/api/*` routes on the TCP app require a valid access token (cookie). Static files are served without auth; the SPA shows the login form when `GET /api/auth/me` answers 401.
- CSRF: `SameSite=Strict` cookies plus a required `x-orca-csrf` header equal to a non-HttpOnly cookie `orca_csrf` issued at login (double submit), checked on every non-GET.
- The command ledger's actor becomes the logged-in user id (`user:<id>`). `--by <who>` stays as the panel's default operator id for non-request writes (recovery, pump) and for agent-preference scoping until a later design maps preferences to users.

### 3.5 Principals and permissions

One table in `src/panel/permissions.ts`:

| principal | where | may |
|---|---|---|
| `user` with role `owner` | TCP, logged in | everything |
| `user` with role `member` | TCP, logged in | everything except human-only |
| `agent` | control socket (`x-orca-client: cli|mcp[:name]`) | everything except human-only |

Human-only (extends N2 §5): verb `set-limit`; fields `requirement-open.limit`, `proposal-edit.proposedGroupLimit`; the new verbs `set-spend-cap`, `clear-spend-cap`, `set-usage-calendar` (§6). The N2 criterion C19 (amount-field walker) is extended to cover cap verbs.

The socket keeps no login: it is reachable only by the same OS user (mode 0600), and it can never do a human-only action whatever it sends. The agent principal is recorded as `agent:<client>`.

## 4. Per-model usage from ccloop (H9)

### 4.1 ccloop protocol

ccloop's collect event gains an optional field, protocol stays 3 with a capability flag `usageBreakdown: "per-model" | "unavailable"` in the capability vocabulary:

```
byModel: Array<{ model: string; input: int; output: int; cacheRead: int; cacheWrite: int }> | null
```

- Cumulative, like `cumulative`, per (run, generation, bucket).
- claude: from the result's `modelUsage` map (one entry per model the CLI actually used, including internal haiku calls). codex: one entry, the run's model, `cacheRead` = cached input tokens, `cacheWrite` = 0.
- Absent or `null` when the adapter cannot tell; never invented.
- Reconciliation rule, stated by ccloop and checked by Orca: `sum(input+output)` over entries equals `cumulative.tokens` under the adapter's own normalization (codex today: input+output). An event whose breakdown does not reconcile is accepted for the total and its breakdown is stored as `breakdown-mismatch` (counted in the UI, never used for caps).

The same field is added to the single-call usage Orca books for estimate / clarify / split calls (`singleCallLedger.ts`).

### 4.2 Orca side

- `ccloopPort.ts` schema accepts `byModel` (strict) and the capability flag.
- Orca re-pins ccloop after the ccloop change is published (memory: re-pin is done by the agent after the human pushes ccloop).

## 5. Usage ledger and periods

### 5.1 `usage_ledger`

Migration 7→8 adds `usage_ledger(id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, group_id TEXT NOT NULL, repo_id TEXT, run_id TEXT, source TEXT NOT NULL, model TEXT, input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, tokens INTEGER NOT NULL, quality TEXT NOT NULL) STRICT` with an index on `(applied_at)` and `(repo_id, applied_at)`.

- One row per applied delta, written in the same transaction that adds the delta to `group.used` (`usage.ts`, and the single-call path). `applied_at` is the store clock at application time, so usage is attributed to when it was booked, never to a session's start (the hermes mistake).
- With a breakdown: one row per model with the per-model delta; `quality = "reported"`. Without: one row, `model = NULL`, `quality = "unattributed"`. Mismatch: rows as reported plus `quality = "breakdown-mismatch"`; the total row is authoritative for caps.
- `source`: `run-work` | `run-handoff` | `estimate` | `clarify` | `split`.
- Usage that became unknown (`cumulative: null`) adds no row; it is counted as an "unknown usage" run in the view, as today's `usageUnknown`.
- Existing usage before the migration: one row per group with `applied_at = 0`, `source = "pre-ledger"`, `quality = "unattributed"`. It counts in totals, in no week or month.

### 5.2 Calendar

`usage_calendar` setting (operator scope, one row): `{ timeZone: IANA string, weekStart: 1..7 }`, default the panel host's resolved time zone and Monday. Periods are calendar periods in that zone: week = [weekStart 00:00, +7 days), month = [1st 00:00, next 1st). DST is handled by computing boundaries with `Intl` in that zone, not by adding 86,400,000 ms. Changing it is human-only (`set-usage-calendar`) because it moves cap boundaries.

### 5.3 Query

`GET /api/control/usage?scope=all|repo:<id>&from=<ms>&to=<ms>&groupBy=model|repo|day|week|month` answers sums of `tokens`, and per model `input/output/cacheRead/cacheWrite`, plus counts of `unattributed` / `breakdown-mismatch` rows and unknown-usage runs. Readable by every principal (agents may read).

## 6. Spend caps

### 6.1 Data and verbs

`spend_caps(scope TEXT NOT NULL, period TEXT NOT NULL CHECK(period IN ('total','week','month')), tokens INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(scope, period)) STRICT`, `scope` = `all` or `repo:<repoId>`.

Verbs (human-only, operator scope, revisioned like other operator commands): `set-spend-cap {scope, period, tokens}`, `clear-spend-cap {scope, period}`, `set-usage-calendar {timeZone, weekStart}`. Each writes a `security_events` row.

### 6.2 Headroom

For a cap (scope, period, tokens) at time t:

`headroom = tokens − used(scope, period containing t) − committed(scope)`

- `used`: sum of `usage_ledger.tokens` in the period (all rows for `total`).
- `committed`: the sum of `committedRemaining.tokens` of every group in scope that is not done — tokens already promised to claimed runs, so two runs cannot both fit into the same headroom.
- The binding headroom for a group is the minimum over every cap that applies to it (its repo's caps and the `all` caps).

### 6.3 Enforcement

1. **Claim gate.** Before the driver claims a run (and before a single-call estimate / clarify / split call), it checks `grant.tokens ≤ binding headroom`. If not, the group gets dispatch blocker `spend-cap-reached` naming the cap (scope, period) and the numbers; nothing is claimed. Blocked groups are re-checked on each wake, so a raised cap or a new week/month resumes them without a command. Applies to every group, whoever created it.
2. **Agent-channel ceiling (H10).** `import-plan` and `requirement-draft-accept` from the `agent` principal are refused 403 `control-limit-over-cap-headroom` when the computed group limit's tokens exceed the binding headroom. From a logged-in user they are accepted and the claim gate still applies.
3. Caps never abort a run in progress: a run's grant was inside the headroom when it was claimed. Overshoot is bounded by the grant, as group limits are today.

No cap set ⇒ no gate (today's behavior), and the UI says so.

## 7. UI

- Login page; a first-run page when no user exists ("run `orca user add <name>` in a terminal").
- Header: the logged-in user, logout.
- Security notices (§3.2) as a dismissible banner for owners.
- Metrics section, new "Usage" panel:
  - scope picker (All projects / one project), period picker (day / week / month / custom range), and headline totals: total, this week, this month.
  - a table per model (input / output / cache read / cache write / total), and the count of unattributed and mismatched rows.
  - the caps that apply, with used / committed / headroom; owners edit them in place (set / clear), members see them read-only.
  - the calendar setting (time zone, week start), owner-editable.
- Task control: a group blocked by `spend-cap-reached` shows the cap and a link to the Usage panel.

## 8. API summary

| route | principal | notes |
|---|---|---|
| `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me` | anyone / session | §3.3 |
| `GET /api/control/usage` | all | §5.3 |
| `POST /api/control/operator/set-spend-cap`, `clear-spend-cap`, `set-usage-calendar` | owner | §6.1 |
| existing `/api/control/*` | per §3.5 | |

`skills/orca-control/SKILL.md` gains the usage read route and a line saying caps are owner-only; its route-count criterion is updated.

## 9. Migrations and compatibility

- Store 7→8: `users`, `sessions`, `security_events`, `usage_ledger` (with the pre-ledger rows), `spend_caps`, `usage_calendar`.
- A panel started on a store with no users still starts; the Web UI shows the first-run page; the socket works as before (agent principal). So upgrading never locks the human out of agents, and the human creates the first user from a terminal.
- The `x-orca-token` path is removed in the same change; tests that use it move to a login helper.

## 10. Criteria (outline; the plan names each)

- Auth: no cookie → 401 on every `/api/*` route (walker over the route table); a token signed with another key → 401; expired → 401; refresh extends `exp` and keeps `sid`; a token survives a panel restart; logout / disable → the same token 401 at once; CSRF header missing → 403; initial password: only the change step until changed, file deleted after, created 0600; added user's own password works without a forced change; minimum length enforced.
- Human-only: for every human-only verb/field, `member` and `agent` → 403 and no ledger row; `owner` → accepted. Walker C19 extended.
- `orca user add` refuses a non-TTY stdin; never accepts a password from argv/env.
- Usage ledger: one row per applied delta with model split; reconciliation mismatch flagged and excluded from caps; pre-ledger rows in totals only.
- Calendar: week/month boundaries across a DST change in a non-UTC zone and across a year end; `weekStart` honored.
- Caps: claim gate blocks at headroom and resumes after a cap raise and after a period rollover (injected clock); committed counted; agent-channel import refused over headroom, user import accepted.
- ccloop: `byModel` from a fake claude result with two models; codex single entry; null when unknown; reconciliation holds.
- Every new branch gets its own deletion mutation seen red (Rule 9). All criteria run under relocated HOME / `ORCA_CONTROL_DIR` (Rule 17).

## 11. Out of scope

Dollar prices and conversion (H7: later, a per-model price table over `usage_ledger`); per-model caps; per-user caps; agent API keys; TLS; store tamper detection (H3); mapping agent preferences to users.

## 12. Residual risks (stated, accepted under H2/H3)

- A same-user process can add a user row or edit `spend_caps` in the store, or edit Orca's code. User creation is surfaced as a notice (§3.2); cap edits are not detected.
- A same-user process can read `jwt.key` and mint a token, or read `initial-password` before the human does (the forced change on first login and the user-created notice make the latter visible).
- Spend outside Orca is not bounded by Orca.

## 13. Plan-time decisions (2026-10-07, session 9a20ac38)

Earlier sections are kept as written; this section records decisions taken while planning.

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

## 14. Corrections recorded at execution (2026-10-07, session 30bd7e40)

Earlier sections are kept as written; this section records corrections found while executing.

- §4.1 says the per-model breakdown reconciles as `sum(input+output)`; D7 and ccloop (branch `orca/usage-by-model`) use the four-field entry total `input + output + cacheRead + cacheWrite` (input = non-cached input). The four-field sum is authoritative.
- Breakdown semantics as ccloop emits them: `byModel` is absent (never `null`, never `[]`) when unknown; once a run's breakdown is unknown (a phase spent tokens without one, or a phase's entries do not add up to its own tokens) it stays absent for the rest of that run — Orca never falls back to an earlier event's breakdown; handoff events never carry `byModel`; codex's single entry is named after the configured model; entries are sorted by `model` in JS code-unit order (Orca compares the same way, never `localeCompare`).
- Orca's usage event schemas are strict; Orca must accept the optional `byModel` before any re-pin to a ccloop that emits it (codex emits it on every successful phase).

Recorded in the final fix wave (2026-10-08, session 30bd7e40, on top of 33cc5cf):

- Ruling R2 (Task 7): reconciliation spend (`recordReconcileUsage`) is booked in the same transaction that adds it to `group.used`, as one `run-work` row with quality `unattributed` and `model NULL`, under the reconciled run's id (no row for 0 tokens). There is no `reconcile` source: §5.1's `source` list and the v8 `usage_ledger` CHECK have none. A per-run view therefore counts that run's reconciliation as its own work.
- D6 is binding over §6.1: the cap and calendar verbs are recorded in the command ledger (verb, payload, principal) and write no `security_events` row. §6.1's "Each writes a `security_events` row" is superseded.
- Pre-ledger rows (`source = 'pre-ledger'`, `applied_at` 0) count in the headline total and in every `total` (all-time) cap, but in no range (including the Usage panel's "All time" range) and in no week or month. The panel names the difference (headline total − all-time range) on one line rather than itemising it.
- Task 3 rulings (spec silent): a successful password change revokes the user's other sessions and keeps the current one; a wrong current password on the password change counts against the same per-name login throttle (429 `login-throttled`).
- `POST /api/chains` and a chain's `maxCostUsd` are outside the spend caps and open to members. The spec (§3.5, §6.3) is silent; this is an open question for the human, not a decision.
