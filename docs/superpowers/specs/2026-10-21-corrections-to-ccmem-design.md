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
