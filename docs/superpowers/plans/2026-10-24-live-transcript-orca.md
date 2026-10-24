# Live transcript (read-only) — Orca part — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green.

- **Goal:** the Orca half of `docs/superpowers/specs/2026-10-23-live-transcript-design.md` (cited "§n"; §12 = Revision 3
  overrides §10 where they differ; C1–C8 are §12.4's corrections): locate a run's transcripts from ccloop's `collect`
  listing, serve windows / follow reads / expand pages with redaction, and show them in one web component mounted in three
  places (flow run page, task detail, group runs table).
- **Base:** branch `feat/live-transcript-orca` from main `6ec49411` (worktree `/private/tmp/orca-ffec7b28/lto`). main
  already accepts ccloop f4de340's `transcripts` and `features.transcripts:"v1"` (`src/control/ccloopPort.ts:47`, `:228`)
  and passes them into `ExecutionReport.transcripts` with no consumer.
- **Author / attribution:** live-transcript Orca implementer subagent of session `ffec7b28`, 2026-10-24.
- **Ruling for criterion rewrites:** 「这次批准改写所有必要的判据」 (human, session `ffec7b28`). Each rewritten criterion is
  named in its commit body with the reason; any other red is this branch's regression first.
- **Rules:** Rule 9 (each new branch: a named mutation seen red, in a `git clone --local` copy at
  `/private/tmp/orca-ffec7b28/lto-mut`, log `/private/tmp/orca-ffec7b28/lto-mutations.log`, restore proved by
  `git diff | wc -c` and `git diff --cached | wc -c` = 0); Rule 14 (logs to files, read whole); Rule 17 (every test uses a
  temp `ORCA_CONTROL_DIR` / run root, never `~/.orca`); Rule 18 (`npm test`; the perf script is on demand only). No paid
  runs, no panel restart, no merge, no push.
- **Parallel work:** a dir-project-requirements implementer edits control/requirement/driver code on another branch. This
  plan keeps to new modules (`src/agentTranscript/**`, `web/src/AgentTranscript.tsx`), the three named web mounts, the
  route registration line, and one-line hooks where `collect` answers arrive (`collectInto`, `collectControlled`).

## Scope decisions (Rule 1, reversible, decided here)

- **D1 Listing store.** The last `transcripts` listing is kept on the run body (`runs.body.transcripts`, an existing path,
  no migration) as `{entries}`. It is rewritten only when an entry changes other than the `bytes` of a non-final entry, so
  a growing live call does not move the group's `changeSeq` every collect; the listing route serves a non-final entry's
  `bytes` from `fstat` of the resolved file when it is readable.
- **D2 Feature.** The listing route asks the panel port's `readFeatures()` (cached per ccloop identity in `ccloopPort`).
  Without `transcripts:"v1"` it answers `{available:false, reason:"ccloop-transcripts-unsupported"}` and serves nothing;
  the window/expand routes refuse `transcript-unsupported`.
- **D3 Route keys.** `:attempt/:phase/:seq` is not unique across runtimes in principle (ccloop orders kind-major); a run
  has one runtime, so a key matching two entries is refused `transcript-ambiguous` rather than guessed.
- **D4 Oversized-line checkpoints** (C6/N1) are computed on the first expand of that line by one streaming pass and
  cached with the index entry, not in the index pass: the index pass then never decodes a 200 MiB line just to serve a
  tail window. Same state, same lookup rule, same equality criterion (T3).
- **D5 Web list.** "Virtualized" is a paged view: at most 200 event rows mounted, Earlier/Later move the view and load
  server windows when needed; follow mode stays pinned to the end. Collapsed rows render no body.
- **D6 codex `item.updated`** is progress of an item whose `item.completed` carries the content: indexed, counted, not
  served (no double rendering, the C1 principle).
- **Out of scope / open:** the boundary pause (§10.5.1, T9) and the operator note (§10.5.2, T10). The spec defines the
  note's Orca surface, but delivery requires 10.5.1's boundary hand-off (`handoff-stop` reach from a flow `pause`,
  continuation, flow-message commands), which edits `stopIntent`/`continuation`/flow kernel/`humanOnly` — outside the
  file scope given for this branch. Listed as open in the report.

## Module layout (`src/agentTranscript/`)

- `reader.ts` — `RangeReader {size, read(position, length)}`; file sources (run dir, `O_NOFOLLOW`, per-component
  `lstat`) and archive sources (artifact `data`, one streaming hash check cached by `(dev, ino)`).
- `lineIndex.ts` — sparse index (checkpoint every 256 lines or 1 MiB), long-line list, head hash, growth/rebuild rules,
  LRU of 8 keyed by `(dev, ino)`.
- `redact.ts` — §10.6.2 shapes + C3–C5 (spans, cover-start, cut at the original offset, surrogate edges, token run,
  END-without-BEGIN, case-insensitive names), literal env matcher (C4).
- `unescape.ts` — streaming UTF-8 + JSON-string unescaper with exposed state (C6/N1).
- `normalize.ts` + `runtimes/{claude,codex,omp}.ts` — one mapper per runtime; deltas never served (C1); markers.
- `window.ts` — tail / before / after windows (≤ 200 events, ≤ 4 MiB bytes read, first line always, continuation),
  expand pages for fields and oversized lines.
- `listing.ts` — store hook (D1), route-side resolution of an entry to a source (run dir, then archive, else
  `transcript-gone`).
- `routes.ts` — `registerTranscriptRoutes(app, deps, channel)`: registers nothing unless `channel === "web"`.

## Tasks

- [ ] **T-A redact + unescape** — `tests/agentTranscript/redact.test.ts` (T4), the unescaper/checkpoint half of
  `tests/agentTranscript/oversized.test.ts` (T3). Mutations: raw-line redaction; `slice(0,4096)` head; redacted-output
  cut; case-sensitive names; no END rule; no token run; no cover-start; no surrogate adjust; checkpoint without pending
  UTF-8 / pending `\u`; unchecked notice `type`.
- [ ] **T-B index + reader** — `tests/agentTranscript/index.test.ts` (T2), `tests/agentTranscript/window.test.ts` (T1 +
  C8). Mutations: cache keyed by path/size/mtime; rebuild on every growth; serve with `readFile`; no byte check.
- [ ] **T-C normalisers + windows** — fixtures from real line shapes (`/private/tmp/orca-ffec7b28/o2/evidence/*.stdout.jsonl`,
  shapes only, synthetic content), thinking omitted unless `include=thinking`, deltas never served. Mutations: serving
  deltas; always including thinking.
- [ ] **T-D listing store + routes** — `tests/agentTranscript/runListing.test.ts` (T13), `access.test.ts` (T5),
  `archive.test.ts` (T6), `tests/control/ccloopTranscriptsSchema.test.ts` (T7). Mutations: storing listings only for flow
  children; registering on both listeners; sending `path`; dropping `O_NOFOLLOW`; reading through `readArtifact`;
  schemas without the key.
- [ ] **T-E web component** — `web/src/AgentTranscript.tsx`, helpers in `web/src/controlApi.ts`, mounts in
  `FlowRunPage.tsx`, `TaskDetail.tsx` (`active` prop), `ControlGroupView.tsx`; en/zh keys.
  `web/tests/agentTranscript.test.tsx` (T8), `web/tests/taskDetailTranscript.test.tsx` (T12). Mutations: `innerHTML`
  rendering; no virtualization; always including thinking; fetching while collapsed; a page-local fetch; polling with
  `active=false`; `TaskDetail` ignoring `active`; a per-component open slot.
- [ ] **T-F perf script** — `scripts/perf-transcript.mjs`, `npm run perf:transcript` (T11, on demand, not in `npm test`):
  generates 64 MiB and 512 MiB fixtures in a temp dir, runs the window/follow/expand workload in a child under
  `--max-old-space-size=96`, exits non-zero over 64 MiB peak; prints latency and redaction cost against the §12.2 budget
  (≤ 100 ms per window, ≤ 15 ms per resumed page, ≤ 2 ms per forward page), recorded not gated.
- [ ] **Final** — the caller's `npm test` command to `/private/tmp/orca-ffec7b28/lto-npmtest.log`; reds rerun alone and
  compared with `docs/handoff/known-load-flakes.md`.

## Success criteria (each a command, exit 0)

`npx vitest run tests/agentTranscript tests/control/ccloopTranscriptsSchema.test.ts`;
`(cd web && npx vitest run tests/agentTranscript.test.tsx tests/taskDetailTranscript.test.tsx)`; `npm run typecheck`;
`(cd web && npx tsc --noEmit -p tsconfig.json)`; `npm test` (selection quoted in the report).

## Review round 1 disposition (independent review of `origin/main...d2358995`)

- 1 (should-fix, `split` decoded a doomed UTF-8 lead with the next byte) — **fixed**: `validPrefix`/`continues` decode
  a doomed prefix alone; covered by the seeded stream-equivalence fuzz and the dangling-lead case.
- 2 (should-fix, `countBytes` lost a low-surrogate unit completing a `\u` escape mid-astral) — **fixed**: the `extra`
  counter keeps `feedCount` equal to `feed().length`; covered by the fuzz's per-chunk unit assertion.
- 3 (`expandOversized`'s `endUnits` unclamped) — **fixed**: `b` is raised to `a` when a short/truncated text would put
  it first.
- 4 (`windowBefore` materializes a whole checkpoint segment) — **deferred**: a segment is at most 1 MiB / 256 lines
  (checkpoint stride), heads are capped at 4 KiB per field, and T11 measures 49.6 / 48.7 MiB peak under the 64 MiB gate;
  reading backwards would trade those parsed heads for a copied segment, not clearly less.
- 5 (>200 events in one line drops the tail silently) — **deferred**: C2 bounds the count only, and a notice or a
  line-internal continuation needs a response-shape addition; a single line normalises to more than 200 events only for
  a message with >200 content blocks. v2.
- 6 (`FlowRunPage` passes `active` unconditionally) — **deferred, not reachable**: `FlowBoard.tsx:221` renders the run
  page only while the run is open (`open !== null` replaces the board), so it is never backgrounded; the prop there is
  `ExecutionFacts`'s head flag, not polling state.
- 7 (`archivedRef` scans the outbox) — **deferred**: correct in this version, and a listing is cached on the run body
  (D1), so the scan is one per run, not one per poll.
- 8 (a range read can overshoot the 4 MiB budget by one chunk) — **deferred**: `counted` (the spec's measure, asserted
  by T1 and printed by T11) stays ≤ 4 MiB; the overshoot is the chunk that discovers the length of the one line the
  budget refuses, and that line becomes the next window's first line.
- 9 (fixtures only valid UTF-8; no `feedCount === feed().length` assertion) — **fixed**: seeded random-byte fuzz over
  1–6-byte chunks, plus the dangling-lead and split-surrogate regressions.
