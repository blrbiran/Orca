# Accounts, per-model usage and spend caps — design

Session 9a20ac38, 2026-10-07. Status: draft for human review.
Follows the N2 agent entry (`2026-10-07-agent-entry-design.md`, §13 and §14).

## 1. Human rulings this design encodes

- H1. The human-only gate must become a real boundary at the interface, not only a guardrail for cooperating agents (N2 spec §13).
- H2. No separate OS user and no system-level user isolation. The system is cross-platform; macOS and Linux are the targets. No platform-specific mechanism (Touch ID, Keychain).
- H3. Interface layer only: tampering with the store directly is out of scope (no start-up unlock, no row signatures).
- H4. Human proof is a user account with a password, JWT-style sessions. The account model must be extensible: multi-user login comes later.
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
- reads the panel's process memory (the JWT signing key lives there, §3.3).

Spend that bypasses Orca entirely (an agent running a model CLI itself) is outside what any Orca limit can bound. The residuals are restated in the UI help text and §12.

## 3. Accounts and sessions

### 3.1 Data

Migration 7→8 adds:

- `users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, roles TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER) STRICT`.
  - `password_hash`: `scrypt$N$r$p$<salt b64>$<hash b64>` from `node:crypto` scrypt (N=2^17, r=8, p=1, 32-byte salt, 64-byte key). No native dependency; identical on macOS and Linux.
  - `roles`: JSON array; v1 knows `owner` and `member`. `owner` may do human-only actions; `member` may do everything else. Roles are checked through one permission table in code (§3.5), so adding a role is a table edit.
- `sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), refresh_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER) STRICT`. Only a SHA-256 of the refresh token is stored.
- `security_events(seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT` — user created / password changed / user disabled / login failed (rate-limited summary) / cap changed. Append-only from code.

### 3.2 Creating users

- `orca user add <name> [--role owner|member]` reads the password twice from the TTY (refuses when stdin is not a TTY; never from argv or env). It writes the store directly (the panel need not run). The first user defaults to `owner`.
- `orca user passwd <name>` and `orca user disable <name>`, same TTY rule.
- With no user in the store, the panel serves only a page that says how to create one (§7); every `/api/*` route answers 401 `no-users`.
- Every row in `security_events` of kind user-created / password-changed shows in the UI as a persistent notice until acknowledged by an owner, so a user row added by a same-user process (§2 residual) is at least visible the next time an owner logs in.

### 3.3 Tokens

- Login: `POST /api/auth/login {name,password}` → sets two cookies:
  - access token: JWT (HS256), 15 min, claims `{sub,roles,sid,iat,exp}`, cookie `orca_at`, `HttpOnly; SameSite=Strict; Path=/api`.
  - refresh token: 32 random bytes, 30 days, cookie `orca_rt`, `HttpOnly; SameSite=Strict; Path=/api/auth`.
- The HS256 key is 32 random bytes generated at panel start and held only in memory. It is never written. A restart invalidates every access token; the browser silently calls `POST /api/auth/refresh`, which checks the refresh token's hash in `sessions` and issues a new access token. So a restart does not log the human out, and nothing on disk can mint an access token.
- `POST /api/auth/logout` revokes the session. Disabling a user revokes all their sessions.
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

- Auth: no cookie → 401 on every `/api/*` route (walker over the route table); expired access + valid refresh → refreshed; restart invalidates access tokens but refresh works; a forged JWT with any key other than the in-memory one → 401; refresh hash only on disk (scan the store file for the raw token → absent); CSRF header missing → 403; disabled user → sessions revoked.
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
- A same-user process with debugger access to the panel can read the in-memory JWT key.
- Spend outside Orca is not bounded by Orca.
