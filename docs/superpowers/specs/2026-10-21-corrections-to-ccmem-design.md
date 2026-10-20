# Closed corrections written back to ccmem — design

- **Author:** controller of Orca session `308b874c` (2026-10-21). **Status:** design; not planned. Spans Orca (export)
  and ccmem (idempotent import); ccmem needs its own mirroring spec (its rules; Orca Rule 16).
- **Roadmap:** `docs/handoff/goal.md` mid-term item "纠正写回 ccmem 给人自己的会话看"; `src/memory/adapter.ts`
  `recordCorrection` is `false` today. Until this lands, "memory write-back closed" must not be claimed.

## 1. Intent
A correction is the person overriding an agent's choice in Orca. When the person later works in the same repository in
their own sessions (Claude Code / Codex / OMP with ccmem), that correction should be available so their own agent does
not repeat the mistake.

Human (this session): retrieval only, not session-start injection — "只在文档相关内容时才被检索出来".

## 2. Rules
- **What is written:** only corrections that are **closed and not withdrawn** (closed = the target ref's tree has the
  closing line, `src/control/correctionState.ts`). Only person-made corrections (system findings open debug tasks, not
  corrections — protect spec §7a.3), so the memory layer only holds the person's own judgments.
- **Where:** the repository's **project** scope in ccmem (projectKey via the shared `normalizeRemoteUrl` rule), never
  global.
- **How it surfaces:** per-prompt retrieval only (ccmem's existing retrieval: embedding path, or FTS fallback when the
  embedding provider is unavailable). Not added to the stable session-start context.
- **Content:** one memory per correction: what the agent chose, what the person ruled instead and why (`because`), the
  file/area, and the Orca correction id. Bounded length.
- **Idempotent:** tagged `orca:correction:<id>`; re-export never duplicates; a later withdrawal removes or supersedes
  the memory (ccmem `forget`/quarantine path, never a raw delete).
- **Trust:** a source distinct from generic `external` (initial trust 0.3 today); proposed initial trust higher than
  external because it is the person's own ruling — exact value is ccmem's call in its spec.
- **Who triggers:** Orca, when a correction closes (and a catch-up pass for already-closed ones); through ccmem's CLI
  boundary only (`ccmem import` with the new idempotency), env passed through, `CCMEM_CONFIG_PATH` handling as the
  existing Memory page does. A failure leaves the correction un-exported and retried later; never blocks Orca.

## 3. Needs in ccmem (its own spec)
External-reference tag + idempotent import keyed by it; a source/trust value for Orca corrections; withdrawal handling.
Today `ccmem import` has no de-duplication (ccmem handoff §6.2).

## 4. Constraints
Rule 17: the ccmem data root is the person's data — criteria use a relocated `CCMEM_DATA_ROOT`/HOME; the write path is
registered here (writer: Orca on correction close; path: ccmem's data root via its CLI; failure residue: none — the
export is retried).

## 5. Left to the builder
Memory text template; catch-up batching; how Orca records "exported" per correction.

## 6. As-built (Orca session 9ec98639, 2026-10-21; controller's calls under "先按你的建议执行", reversible)

- **ccmem contract used** (ccmem spec `2026-10-21-orca-correction-import-design.md`, ccmem `3d2b6bf`…`30b59f3`):
  `ccmem orca-correction upsert|withdraw`, cwd = the repository, stdin `{"version":1,"id","content"}` / `{"version":1,"id"}`;
  exit 0 done, 64 refused (not resent), anything else failed (retried). ccmem resolves the project key from cwd itself;
  rows are `source: external`, trust 0.8, tags `orca-correction`, `orca:correction:<id>`, `retrieval_only` (kept out of
  the session-start stable section). `ccmem export` is unchanged, so the Memory page's strict reader is unchanged.
- **One mechanism for "on close", catch-up and withdrawal:** closed state is computed, never stored (debug-task design
  §12.1), so there is no close event to hook. A pass (`src/memory/correctionExport.ts`) reads `readCorrectionList`,
  writes every closed, not-withdrawn correction whose text changed since it was last sent, and withdraws every
  withdrawn one that was written (or whose write failed, since a timed-out write may have committed). The first pass
  after enabling is the catch-up. The pump starts a pass without waiting for it; at most one runs, at most one per 5 min.
  Calls are one at a time (ccmem takes its write lock per call).
- **Who is exported:** every row of the corrections store — all are a person's (system findings open system debug groups,
  `2026-10-21-system-debug-task-design.md`, never correction rows). A correction whose repository is not configured is skipped.
- **Text template (≤ 500 UTF-16 chars, ccmem's default `save.max_chars_per_memory`):**
  `Orca correction: for "<question>" an agent chose "<chose>"; the person ruled it <kind>. Instead: "<chose_instead>". Because: <because>. [decision <id>; correction <id>]`
  — question/chose read from the ledger at the ref the correction was found closed on; clipped to 100/100/120 chars so
  the reason survives; without a ledger row (pending-decision corrections) the head names the target instead. A person
  whose ccmem limit is lower gets exit 64, recorded as `refused`.
- **"Exported" record:** `<correctionsDir>/ccmem-exports.json` (`ORCA_CORRECTIONS_DIR`, beside `corrections.jsonl`), not
  the control DB — corrections already live there and a control schema step would buy nothing. Per correction: state
  (`exported` | `refused` | `failed` | `withdrawn`), sha256 of the sent text, memory id, time; `failed` carries attempts
  and the next attempt (5 min doubling to 6 h). Written after every call (temp + fsync + rename, created 0600, dir
  0700). A file that does not parse stops the pass with a log line and is never overwritten.
- **Off by default:** the panel flag `--ccmem-corrections`, refused by name without an absolute `ORCA_CCMEM_BIN`
  (`ccmem-corrections-need-ccmem`) or with `--no-control` (`ccmem-corrections-need-control`). Not an env variable:
  the service only captures path-valued variables (`src/service/config.ts`). **Enable only after the ccmem daemon was
  restarted on ccmem ≥ `30b59f3`** (its cache rebuild and synthesis must know `retrieval_only`): reinstall the panel
  service with the flag added to the run args (read the stored `~/.orca/panel/service.json` first).
- **`recordCorrection` stays `false`** in `src/memory/adapter.ts`: the Memory adapter is still read-only; the writer is a
  separate module, and the chain is off until the person turns it on.
- **Rule 17 registration:** writer = the panel process (pass started by the control pump); paths = ccmem's data root
  through its CLI (ccmem's own rules) and `<correctionsDir>/ccmem-exports.json`; residue on failure = a `failed` row,
  retried; nothing else.
- **Withdrawal reachability:** Orca refuses to withdraw a closed correction (`src/corrections/withdrawals.ts`), so the
  withdraw call happens only when a correction's closing left its ref (e.g. the target was reset) and the person then
  withdrew it, or a write raced a withdrawal. A closed correction that becomes open again without being withdrawn keeps
  its memory (not designed here; residual).
