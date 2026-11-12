# Agent CLI upgrades: Orca records the new version itself and goes on

Orca implementer run under session `308b874c` (Claude Code), 2026-10-20. Observation anchor: Orca `main` at `95d04cca`,
ccloop pin `af4ad33` (repin to `86f6123` in flight; the probe and refusal read below are the same in both).

## 1. Problem

codex and claude ship new versions every one to two days, sometimes several a day, and usually update themselves.
ccloop compares `<command> --version` with the table's `version` at every resolution (ccloop
`src/agents/materialize.ts`, `resolveAgent`) and refuses a mismatch as `agent-version-drift`. So a group that was
confirmed, or is half way through, stops at its next claim/start/resume until someone records the new version by hand,
and the Agents page shows numbers that are no longer true.

`version` is not in the configHash (human ruling 2026-09-26), so once the table records the new version a frozen group
resolves to the same hash and continues. Nothing but the table's `version` field stands between the upgrade and the
group going on.

## 2. Rulings (verbatim)

The human, session `308b874c`, 2026-10-20:

- 「组跑到一半遇到 agent 升级 => 直接用新版本继续」
- 「不用看版本号变化，静默更新就行」
- Agreed the design in §3 as written in the implementer's brief.

## 3. Design

1. **One core** (`src/agents/versionRefresh.ts`). Input: the table path, one observation, and optionally one
   installation id. The observation is ccloop's own: `ccloop control agent-installation-observe` (already used by the
   panel's detection flow) runs ccloop's `probeVersion` once per installation, the same probe `resolveAgent` uses on a
   cache miss. For each installation in scope whose observed version is a valid `x.y.z[-tag]` and differs from the
   table, the core rewrites **only** `installations.<id>.version`. A probe that observed nothing leaves the table
   untouched and reports the installation as `unavailable`.
   - Atomic: the new bytes go to a fresh temporary file beside the table (`.<name>.orca-agents-<16 hex>.tmp`, the
     pattern `orca agents init` already cleans), fsync'd, then renamed over the table.
   - Mode: the temporary file is created and chmod-ed to the existing table's mode (Rule 17: an existing file keeps its
     mode). The core never creates a missing table.
   - Backup: before the rename, the previous bytes are written (same temp-and-rename) to `<table>.bak-auto`, 0600,
     replaced on every write — one rolling copy, nothing accumulates.
   - Formatting: the file is re-serialized in its own style — one line if it was one line, else the indent of its
     first nested line — and its trailing whitespace is kept. Key order is kept; no other field changes.
   - Concurrent writers: Orca has no lock for user files, so the core re-reads the table immediately before the rename
     and starts over (up to three times) when the bytes changed since it read them; if a concurrent writer already
     recorded the observed version, the installation is reported `unchanged`.
2. **Automatic** (`src/control/ccloopPort.ts`, the one place every ccloop control call goes through). When a call is
   refused with `agent-version-drift: <id>: table <A>, observed <B>`, the port runs the core for `<id>` with a fresh
   observation; if the table now records an observed version different from `<A>`, it retries the same call once,
   immediately, and writes one stderr line. Otherwise (no observation, same version, peer without
   `agentInstallationUpdate`) the original refusal stands, as today.
3. **Agents page**: on the page's first agents load, and on a "Refresh versions" button (en + zh), the web calls
   `POST /api/control/agents/refresh-versions` (owner only, like the models refresh: it spawns CLIs and writes the
   table) before reading `/api/control/agents`. One observation per load, so one probe per installation; the panel's
   stored observation is replaced by the refreshed one, so the detection list does not show a stale "changed".
4. **CLI**: `orca agents refresh` prints `<id>: <old> -> <new>`, `<id>: unchanged (<v>)` or
   `<id>: probe failed (table <v>)` per installation; exit 0, exit 1 only when a probe failed (or the table/peer
   refused).

## 4. Out-of-repository writes (Rule 17)

| Path | Written by | Triggered by | Mode | A failure leaves |
|---|---|---|---|---|
| the agents table: `$ORCA_AGENTS_TABLE`, else `$HOME/.orca/agents.json` | `src/agents/versionRefresh.ts` | a drift refusal in the port; the Agents page load/button; `orca agents refresh` | unchanged (existing file) | the table as it was; at most one `.<name>.orca-agents-*.tmp` beside it after a crash between create and rename (removed on every handled error; `orca agents init` removes leftovers) |
| `<table>.bak-auto` | same | same, only when a version changes | 0600 | the previous backup, or a leftover temp as above |

Criteria point `ORCA_AGENTS_TABLE` (and `HOME`) at temporary directories; none touches the real `~/.orca`.

## 5. Non-goals

- No ccloop change (Rule 16); ccloop's detection preview/apply flow stays as it is for path changes and additions.
- No version history and no UI notice of a change.
- No change to `command`, to the configHash, or to which fields the hash covers.

## 6. Addendum: a first-use seed of the table (seat G1, tester follow-up G, Orca session `d1cbbd58`, 2026-11-12; §1–§5 unchanged)

Handoff §4.0 item 5: with no agent installed the only way out was `orca agent init`, against the operating principle
that every action can be done in the Web UI. ccloop's protected preview/apply (the Agents page's owner-only "Detect
again" and "Apply selected changes") already offers each detected CLI as an `addition`, but it refuses a missing table.
So, with no ccloop change (Rule 16):

- `GET /api/control/agents` answers `installations: []` while nothing is at the table's path (`agentsTableAbsent()` on
  the ccloop port), so the Agents page renders and says how to install the first agent there.
- The port's `previewAgentInstallations` (reached only through the owner-only `POST /api/control/operator/agent-update-preview`)
  first writes an empty table when none exists, then asks ccloop for the preview; the owner applies the additions through
  the existing ledgered apply. A member is refused before the port is reached, as before.

| Path | Written by | Triggered by | Mode | A failure leaves |
|---|---|---|---|---|
| the agents table: `$ORCA_AGENTS_TABLE`, else `$HOME/.orca/agents.json`, only when nothing is there | `src/agents/command.ts` `seedEmptyAgentsTable` (called by `src/control/ccloopPort.ts`) | an owner's detection on the Agents page | missing directories 0700, file 0600 (explicit); `link`, so an existing or concurrently written table is never replaced | no table, or the empty table; at most one `.<name>.orca-agents-*.tmp` beside it after a crash (removed by the next seed or `orca agent init`) |

Consequence, accepted: a detection that finds nothing, or that the owner does not apply, leaves the empty table; a later
`orca agent init` then writes its detection to the draft beside it, as for any existing table.
