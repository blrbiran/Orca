# Live transcript (read-only) and boundary intervention — design

Status: draft for the human's review. Written by Orca session `0e13a9b7`, 2026-10-23; facts measured on Orca main
`6ab0f6e1` and ccloop `ce045c6` (commands in §3). Not to be implemented before the flow-phase1-gaps branch is merged and
installed (human: 「直到原来这个session该做的task做完，我们就不继续开始做后续的spec」).

## 1. Goal

A person watching a flow run in the Web run page sees what each agent is doing while it does it — messages, tool
calls, file changes — rendered like Claude Code (tool calls and file changes collapsed to their first line, expandable),
and can replay every earlier attempt of the run. Between two agent turns the person can leave a note for the next turn
and can ask the run to pause there.

Non-goals (v1):

- Real-time interjection inside a turn (claude `--input-format stream-json`, codex app-server `turn/steer`, omp
  `--mode rpc`). Direction ruled in session `b37f7ce9`: only after dogfooding shows it is needed, per runtime, omp and
  codex first.
- Showing thinking. The events are parsed and kept; only rendering hides them (§5.2).
- A CLI viewer (`orca … tail`). Human: 「orca cli现阶段不用做」.
- Continuing an attempt from the previous attempt's workspace ("keep the execute workspace"). Phase 2, own spec: it
  changes ccloop's invariant that every attempt is built from the run workspace's HEAD.

## 2. Human rulings (session 0e13a9b7, 2026-10-23, verbatim)

1. Replay: 「最好都能回放。但是千万要注意性能问题，要特别注意cpu和内存占用问题（当处理大上下文记录的时候）」
2. Thinking: 「第一版可以不显示思考过程……但是你可以先把口子留好，不要到时候返工工作量大。」
3. Where: 「放在 web 运行页里。orca cli现阶段不用做」
4. Boundary intervention: 「同意你的所有建议」 (§7 as proposed); notes: 「非 owner 不能写 note」; keep-workspace:
   phase 2 「同意」.
5. Storage / redaction: use what is already logged; 「含密钥最好能脱敏（也要看 agent 本身会不会脱敏），以及要看下脱敏的话对性能有什么影响」.
6. ccloop: 「同意改 ccloop，但是一样的，要考虑到对性能和 memory 的影响」; over the cap: 「同意，并且转录上限可以增大一些」;
   claude result parsing: 「同意」.

## 3. Measured current state

Commands: `grep -n` / `sed -n` over the named files at the commits above (session ledger
`.superpowers/sdd/2026-10-23-session-0e13a9b7/progress.md`).

| Runtime | How ccloop runs it | What reaches disk during a call | In memory | Over 16 MiB |
|---|---|---|---|---|
| claude | `scripts/claude-phase-runner.mjs` spawns `-p --output-format stream-json --verbose --include-partial-messages` and splits lines (`:644-679`) | nothing of the stream: the runner keeps the `result` line, the usage observation and a failure tail; the adapter's `stdout.json` holds the runner's envelope (`claudeAgentAdapter.ts:287`) | runner: never the whole stream; adapter: the envelope (`result.stdout +=`) | adapter `stop("output-limit")` (`:289`) |
| codex | `exec --json --ephemeral` (`runCodexPhase.ts:43`) | `events.jsonl`, appended per chunk (`:127`) | the whole stream (`result.events +=`, `:129`) | `stop("output-limit")` kills the agent (`:129`) |
| omp | `--mode json -p` (`runOmpPhase.ts:56`) | `events.jsonl`, appended per chunk (`:112`) | the whole stream (`chunks.push`, `:114`) | `stop("output-limit")` (`:115`) |

Neither agent keeps its own record: the claude installation carries `--no-session-persistence`, codex runs
`--ephemeral` (`~/.orca/agents.json`, read-only). The ccloop evidence directory
(`<runDir>/<runtime>/<attempt>/<phase>/call-*/`, mode 0700, files 0600) is therefore the only record, and the claude
stream is not in it.

## 4. ccloop changes (ccloop's rules apply; Orca is a consumer — CLAUDE.md Rule 16)

4.1 **One transcript file per call**, `transcript.jsonl` in the call's evidence directory, written line by line as the
agent prints it. claude: the runner appends each complete stream line except `stream_event` partial deltas (they
duplicate the final message and multiply the size; the live view's granularity is one message or tool event). codex and
omp: their `events.jsonl` already is the transcript; ccloop names it in the listing (4.4) instead of copying it.

4.2 **The cap stops recording, never the agent.** The transcript cap becomes 128 MiB per call (human: raise it). Past
the cap ccloop appends one line `{"type":"ccloop.transcript-truncated","atBytes":<n>}` and records nothing more for that
call; the agent runs on. `output-limit` stays only for what the result decoding needs (the result envelope / final
message), which is small.

4.3 **Nothing holds the whole stream in memory.** codex and omp decode their result incrementally from the lines (the
final message, usage, the tool open/close count the idle watch already reads) instead of `result.events +=` /
`chunks.push`. Criterion: a fake runtime printing 1 GiB of lines leaves the phase's RSS growth under 32 MiB (measured,
not estimated — Rule 14).

4.4 **Where Orca finds it.** ccloop's existing machine-readable run listing (`ls --json` / run status) gains, per
attempt and phase, the call's transcript path, its byte size, whether it is still being written and whether it was
truncated. Orca never walks ccloop's directories by guess.

4.5 Out-of-repo writes stay where ccloop already writes (its run directory); retention follows ccloop's run retention.
No new path.

## 5. The event model (Orca)

5.1 Orca reads the raw lines and maps each runtime's line to one normalized event:
`message` (role, text), `tool_call` (id, name, input head, start/end, result head, error), `file_change` (path, kind,
diff head), `thinking` (text), `result`, `notice` (truncated, runtime notices), and `unknown` (the raw line). A line a
mapper does not know is `unknown` and renders as collapsed plain text — no runtime is "degraded" to a second code path.
Mappers live in one module per runtime, each with fixtures from real lines.

5.2 `thinking` is parsed and served with the other events; the Web hides it. Showing it later is a render switch plus
its own spec, with no change to parsing, the index or the API.

## 6. Serving and rendering — CPU and memory are hard requirements

6.1 **The server never loads a whole transcript.** Per transcript it keeps a sparse line index (byte offset every 256
lines) built by one streaming pass and cached by (path, size, mtime); it serves windows: the last N events, or N events
before/after an offset. Following a live call reads only the bytes after the last served offset.

6.2 **Bounded events.** An event's served form is capped (first 4 KiB of text / input / result / diff); its full body is
read by byte range only when the person expands it, and that range is itself paged.

6.3 **Live updates by offset polling** while the run page is visible and the call is still being written (1 s), stopping
when the call ends or the page is hidden. No server-side push state per viewer.

6.4 **Browser.** A virtualized list; collapsed blocks render no body; an attempt list shows only metadata (phase,
runtime, outcome, size); one transcript open at a time.

6.5 **Criteria (commands that exit 0/1):** a synthetic 512 MiB transcript — the panel's RSS growth while serving windows
from it stays under 64 MiB, a window request answers in under 200 ms on the dev machine (measured, recorded with the
command and commit), and the Web list keeps at most 200 event rows mounted.

## 7. Boundary intervention

7.1 **Boundaries.** A boundary is the gap after an agent turn ends and before the next starts: between ccloop phases and
attempts of one work step, and between flow steps. Nothing is ever injected into a running turn.

7.2 **Note.** At a boundary the person writes a note bound to one step. Default scope: the step's next attempt; option:
every remaining attempt of that step. It never reaches other steps — run-wide guidance is run feedback (gaps spec §4),
which is triaged, located and planned. The note is recorded in the inputs of the execution that receives it
(`ranOnInputs`), so a replay or re-run knows what the agent saw. Delivery inside a ccloop run uses ccloop's handoff
(`operatorNote`); the exact field and the attempt-boundary hook are measured against ccloop's handoff code before the
plan is written (open item O1).

7.3 **Pause.** "Pause at the next boundary": the current turn finishes; the run then waits (flow `paused`, gaps §5.3)
until the person resumes. Cancel stays the way to stop now.

7.4 **Authority.** Writing a note: owner only (human: 「非 owner 不能写 note」) — owner on the Web, the person token over
the socket, refused for members and dispatched runs; a note is text that reaches an agent's prompt, so an agent writing
it would be an injection channel. Requesting a pause: anyone the panel admits (stopping is always safe). Resuming: the
same person authority as releasing a held effect (gaps §21), since a resume can let a held effect proceed.

## 8. Redaction

8.1 On disk the transcript stays raw (it is evidence; ccloop's handoff and recovery read it, as today).

8.2 Orca redacts what it serves: per served line, known secret shapes (`sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`,
`Bearer <token>`, PEM private-key blocks) and the values of the panel's own environment variables whose names contain
`KEY`, `TOKEN`, `SECRET` or `PASSWORD` (length ≥ 8) are replaced by `[redacted]`. Applied to the served window only —
cost is linear in what is sent, never in the file.

8.3 Open item O2: whether each agent masks secrets itself is unmeasured. Before the plan: one run per runtime that prints
a fake key, and record what its stream contains. Open item O3: the redaction cost on the 512 MiB criterion of §6.5 is
measured and recorded; a budget is set from the measurement, not guessed.

## 9. Open items before the plan

- O1 ccloop: the handoff field and the attempt-boundary hook for a note and a pause (read ccloop's handoff and
  continuation code; ccloop's own rules decide the shape).
- O2 per-runtime secret masking (paid, one short run each; ask before running).
- O3 redaction cost measured.
- O4 which other Orca pages show ccloop attempts (task detail) — v1 mounts the component on the flow run page only.

## 10. Revision 1 (review, session 0e13a9b7, 2026-10-23)

Written by Orca session `0e13a9b7` (spec-writing subagent), 2026-10-23, on Orca main `37168f0a`. §1–§9 stay as written
(Rule 13). Inputs: the review `.superpowers/sdd/2026-10-23-session-0e13a9b7/live-transcript-spec-review.md` and the
controller's rulings R1–R3 (the last line of that session's `progress.md`). §2 (the human's rulings) is untouched and
binds everything below. Every file:line below was measured for this revision with `git show <commit>:<path> | awk
'NR>=a && NR<=b'` or `grep -n` at Orca `37168f0a`, ccloop `ce045c6`, or Orca `feat/flow-gaps` `15df625e` (named "gaps"
below). Where a line the review cites did not match, the measured line is cited instead.

A plan writer works from §2 and this section alone.

### 10.0 What this revision replaces

| Old | New | Reason |
|---|---|---|
| §3 table, claude row: `:644-679` and the "Over 16 MiB" cell | 10.1 | The splitter and read loop are `:674-719`. Only the runner's envelope is capped; claude's stream is not (M1). |
| §3, paragraph under the table | 10.1 | codex `--ephemeral` is set by ccloop's code. omp's `--no-session` was left out. The subject should be "none of the three" (M1). |
| §4.1 | 10.2.1 | codex/omp get a separate `transcript.jsonl`. Raising `events.jsonl` past 16 MiB breaks the end-of-run handoff packet (C1). The claude filter and the runner's path also change (M3, M4). |
| §4.2 | 10.2.2 | Recording stops at the last complete line. The marker goes in the transcript only. `events.jsonl` keeps its 16 MiB cap, which now stops recording instead of the agent (C1, I3). |
| §4.3 | 10.2.3 | Every whole-stream consumer gets a streaming fold beside it. Existing criteria are kept (I2, ccloop Rule 15). |
| §4.4 | 10.2.4 | The listing goes in `ccloop control collect` plus a `features` flag, not `ls --json`. `final` is defined. Version skew is covered (I1, M7). |
| §4.5 | 10.2.5 | Retention is Orca's cleanup and archive, not ccloop's (I4). |
| — | 10.2.6 | New: the ccloop half of the note (O1 answer, R3). |
| §5.1, two points left open | 10.3 | How tool start and end are linked, and claude's `file_change` (review ambiguities 5, 6). |
| §5.2, "served" | 10.3 | `thinking` is not served unless asked (M5). |
| §6.1 | 10.4.1 | Index identity, a byte-bounded stride, a shared LRU cache, the archive source (I4, I5). |
| §6.2 | 10.4.2 | Oversized lines and cut boundaries (I6). |
| §6.3, poll cost | 10.4.3 | A poll never spawns `collect` (M6). |
| §6.4, "attempt list", "one transcript open" | 10.4.4 | The attempt hierarchy is defined. One transcript per tab (I12, M9). |
| §6.5 | 10.7 | Criteria use bytes read and a heap cap. Latency is recorded, not gated. Perf fixtures stay outside `npm test` (I7, Rule 18). |
| §7.2 | 10.5.2 | The note is not an input. It is recorded as `operatorNotes` and delivered through a handoff continuation (I11, R3). |
| §7.3 | 10.5.1 | Pause is the flow run's `pause`, reaching a running work step through `handoff-stop`. Citation fixed (I10, R2, M2). |
| §7.4 | 10.5.3 | Authority per R2. The held-effect rationale is corrected and the citation fixed (I10, M2). |
| §8.1, its reason | 10.6.1 | Handoff and recovery do not read `transcript.jsonl` (C1). |
| §8.2 | 10.6.2 | Redaction runs on decoded values, on every served path, with a wider list of shapes (I8). |
| — | 10.6.3 | New: who may read, how text is rendered, how paths are opened (I9). |
| §8.3, O3 sentence | 10.8 | O3 also covers the decoded-value pass (I8). |
| §9 | 10.8 | O1 is answered. O5 is new. |

### 10.1 Corrections to §3 (measured)

- claude: the runner spawns `-p --output-format stream-json --verbose --include-partial-messages`
  (`scripts/claude-phase-runner.mjs:651`). It splits lines at `:674-696` and reads stdout at `:698-719`. It keeps only the
  result line, the observation and a failure tail. The 16 MiB `output-limit` applies to the runner's envelope on its
  stdout (`claudeAgentAdapter.ts:285-290`). claude's own stream has no cap today. The runner's splitter drops any line over
  10 MiB without a trace (`scripts/claude-stream.mjs:79`, `:91`, `:97`).
- codex `--ephemeral` comes from ccloop's argument list (`runCodexPhase.ts:43`), not from `~/.orca/agents.json`. omp runs
  `--no-session` (`runOmpPhase.ts:55`). None of the three keeps its own record, so the ccloop evidence directory is the
  only record.
- codex and omp keep at most 16 MiB of stdout (`runCodexPhase.ts:28`, `:126-129`; `runOmpPhase.ts:13`, `:110-115`).
  That is exactly `MAX_CONTROL_BYTES` (`src/control/evidence.ts:8`), and the `>` check at `:28` admits it. This is why
  today's handoff packet never fails on size (10.2.1).

### 10.2 ccloop changes — ccloop work; Orca is the consumer (Orca Rule 16)

This subsection is Orca's request to ccloop, not ccloop's spec. ccloop writes its own spec, and its own rules govern it:
its CLAUDE.md Rules 13–18, including Rule 15 (add criteria, never rewrite them without the human naming the test) and
Rule 18 (no ruling is announced on the human's behalf). Nothing here relaxes them. The shapes below are what Orca will
consume. Where ccloop's spec picks another shape, Orca follows ccloop and records the change in an appended section here.

**10.2.1 Transcript file.** Each call writes `transcript.jsonl` into its evidence directory, mode 0600 like its siblings.
- codex and omp: ccloop writes this file beside `events.jsonl`, appending the stdout bytes as they arrive. `events.jsonl`
  keeps its role as ccloop evidence and its 16 MiB cap.
- claude: the runner writes it. It appends every complete stream line except `stream_event` lines whose inner event is
  `content_block_delta`. It keeps `message_start` and `message_delta`, because they are small and the usage observer
  reads them (`createUsageObserver`, `claude-stream.mjs:129`). It writes through a kept-open fd with `writeSync`, because
  the adapter SIGKILLs the process group in `finish()` (`claudeAgentAdapter.ts:251-254`). The adapter passes the path in
  a new variable, `CCLOOP_CLAUDE_TRANSCRIPT_PATH`, set for phases and for single calls alike (today single calls get no
  signals path, `:231-232`). Where the splitter drops a line over 10 MiB, the runner writes
  `{"type":"ccloop.line-dropped","bytes":<n>}` in its place (Rule 12).
- `transcript.jsonl` is not added to `RAW_AGENT_FILES` (`src/control/handoff.ts:214-223`). It never enters a handoff
  packet or control evidence. Here is why it must stay out: the packet is built at the end of every run
  (`src/control/worker.ts:331`); `retainFile` reads each listed file whole and passes it to `writeEvidence`
  (`handoff.ts:191-208`); `writeEvidence` throws `control-evidence-too-large` above 16 MiB (`evidence.ts:27-29`);
  `retainFile` catches only `ENOENT` (`handoff.ts:203-207`); and the worker rethrows (`worker.ts:361-363`), so
  `persistHandoffCandidate` (`:353`) never runs.

**10.2.2 Caps.**
- `transcript.jsonl`: 128 MiB per call (ruling 6). Recording stops at the last complete line under the cap: the writer
  tracks the offset after the last `\n` and, at the cap, truncates back to it. It then appends one line,
  `{"type":"ccloop.transcript-truncated","atBytes":<n>}`, and writes nothing more for that call. `outcome.json` records
  `transcriptTruncatedAt` (bytes, or null). The agent runs on.
- `events.jsonl` (codex, omp): stays capped at 16 MiB as evidence. Past the cap it stops recording and no longer stops
  the agent: the `stop("output-limit")` on stdout goes (`runCodexPhase.ts:129`, `runOmpPhase.ts:115`). The truncation
  stays labelled: codex keeps `stdoutTruncated: true` (`runCodexPhase.ts:55`), and omp's `outcome.json` gains the same
  field (today it records none, `runOmpPhase.ts:73`). The saved-result paths keep refusing truncated evidence
  (`saved-result-process-incomplete`: `executionFormatFailure.ts:114`, `savedResultRecovery.ts:252`). No marker is ever
  written into `events.jsonl`, whose strict decoders reject foreign lines (`codex/protocol.ts:121-122`,
  `ompProtocol.ts:41-44`).
- stderr keeps its 16 MiB `output-limit` stop (`runCodexPhase.ts:131-136`, `runOmpPhase.ts:117-123`,
  `claudeAgentAdapter.ts:291-296`). This is intended: stderr is not the transcript.
- Removing the stdout kill changes what existing ccloop criteria assert (`tests/runtime/codex/runCodexPhase.test.ts:57-60`,
  the `output-limit` case; `tests/runtime/omp/ompPhase.test.ts:225-226`). ccloop Rule 15 requires the human to name each
  of those tests before it is rewritten (open item O5).

**10.2.3 Nothing holds the whole stream.** The live path stops building the stream string
(`result.events+=`, `runCodexPhase.ts:129`; `chunks.push`, `runOmpPhase.ts:114` joined at `:152`). Each whole-stream
consumer gets a streaming fold with the same verdicts:
- codex: `codexAdapter.ts:71, 76, 79, 98, 117, 122, 148, 151, 220`, plus `observedTurnUsage` (`runCodexPhase.ts:182`).
- omp: `ompAdapter.ts:53, 55, 73, 78, 88, 94, 99, 139, 148`. `decodeOmpPhase` keeps every assistant message today
  (`ompProtocol.ts:57-58`). Its fold keeps only what its verdicts read.
- The on-disk re-decoders run the same fold over a streamed file: `executionFormatFailure.ts:124-126` and `:137`,
  `savedResultRecovery.ts:263-266`.
- The string functions stay, as `fold(lines(text))`. Their existing criteria are kept unchanged, and the new criteria are
  added beside them (ccloop Rule 15).
- Lines are split with a `StringDecoder` and nothing is dropped silently. `lineFeeder` (`src/runtime/idleWatch.ts:85-93`)
  decodes each chunk on its own (`:88`) and drops pending text over 1 MiB (`:91`), so it is not decoder-grade.
- A line over 16 MiB (the same ceiling a whole stream has today) is a named decode failure,
  `<runtime>-events-line-too-large`, reported when the call ends. It is never a skipped line, and it does not stop the
  agent.

**10.2.4 Where Orca finds the transcript.** `ccloop control collect` gains an optional top-level field, `transcripts`. It
is absent unless there is something to list, like `toolRules` (`src/control/collect.ts:45-49`). It holds one entry per
call:
- `{attempt, phase, seq, path, bytes, final, truncatedAt}`. `path` is relative to the run directory. `seq` is the call
  order within the phase: by `process.json` `startedAt`, and by name for calls without one. Call directories are
  `mkdtemp` names (`runCodexPhase.ts:39`, `runOmpPhase.ts:49`, `claudeAgentAdapter.ts:197`), so their order means
  nothing.
- `final` is true when the call's `outcome.json` exists, the run is terminal, or a stop proof exists. A call whose worker
  died would otherwise read as live forever (M7).
- A call recorded before the change is listed with `path: null`.
- Single calls are listed the same way, with `phase: "single-call"`.
- `features` (`src/control/command.ts:275`) answers `transcripts: "v1"`. Without it, Orca shows "no transcript recorded
  by this ccloop" and serves nothing.
- Landing order: Orca's `featuresSchema` and `collectionSchema` are `.strict()` (Orca `src/control/ccloopPort.ts:226`,
  `:45`). Orca must therefore accept the optional `transcripts` key in both, and be installed, before the ccloop pin
  (`ORCA_CCLOOP_BIN`, checked by `npm run verify:ccloop-pin`) moves to a ccloop that emits it.
- `ls --json` is not used. It is the L2 registry, which records no derived meaning (`src/registry/types.ts:1-5`), and
  Orca never calls it.

**10.2.5 Out-of-repo writes (Rule 17).** ccloop writes only inside the call evidence directories it already writes
(`<sourceDir>/run/<kind>/<attempt>/<phase>/call-*/`, 0700 directories, 0600 files). No new path. If a process dies, the
file may end in a partial last line. Readers never serve a partial line (10.4.1). Retention is Orca's, not ccloop's:
- Orca deletes a committed run's source directory (`src/control/cleanup.ts:35`, called from `schedulerBridge.ts:92` and
  `recovery.ts:78`).
- First, `archiveRun` (`src/control/archive.ts:164-178`) copies the tree, including every `transcript.jsonl`, into the
  artifact store under `$ORCA_CONTROL_DIR` (an existing, registered path) with streaming `archiveFile` (`:111-120`).
- Each call's transcript therefore costs up to 128 MiB once more on disk in the archive. That is a bound, not a
  measurement.

**10.2.6 The note's field (answer to O1).** No `operatorNote` exists today: `grep -rn operatorNote src scripts docs` in
ccloop at `ce045c6` exits 1.
- **Schema.** The loop start envelope gains the optional field `work.operatorNote: {text, scope}`. `text` is 1–4096
  UTF-8 bytes. `scope` is `"next-attempt"` or `"remaining-attempts"`. It sits beside `priorFailures` in both loop work
  schemas (`src/control/protocol.ts:273`, `:300`) and in Orca's mirror (`src/control/schema.ts:62`). When absent, the
  envelope keeps its bytes and its hash.
- **Delivery.** The worker passes the note into `AttemptContext` beside `lastFailure`/`priorFailures`
  (`src/runtime/types.ts:28-30`; built at `runLoop.ts:1396-1403`).
- **Prompts.** The note is rendered by its own lines in the shared builders (`src/runtime/claude/prompts.ts:113-130`
  planner, `:179-181` execute), used by all three adapters. It must not use `priorFailureLines`, which drops its input
  whenever there is an in-run `lastFailure` (`prompts.ts:88-89`). It is rendered for plan and execute only, never for
  verify.
- **Scope.** `next-attempt` covers the plan and execute of the first attempt the continuation runs. A continuation that
  resumes at verify (`allowanceContinuation.nextPhase`, `runLoop.ts:1321`, `:1614`) passes the note to the next attempt
  instead. `remaining-attempts` covers every attempt of the run.

### 10.3 Event model, amended (Orca)

- §5.1 stands, with three changes:
  - The module is `src/agentTranscript/` (one mapper file per runtime). The name keeps it apart from
    `src/checkpoint/transcript.ts`, which reads Claude Code session files (M8).
  - A tool's start and end lines (codex `item.started`/`item.completed`; omp `tool_execution_start`/`_end`; claude
    `tool_use`/`tool_result`) are two events linked by the tool id, so a window stays line-local. The Web joins them
    when both are loaded.
  - `file_change` is emitted where the runtime reports one (codex). For claude and omp it is derived from a known edit
    tool's input (path, kind, head of the new text). No diff is computed.
- `thinking` is parsed and indexed as §5.2 says. The API omits it unless the request says `include=thinking`, which v1
  never sends. Showing it later is a render switch plus the query flag (ruling 2) (M5).

### 10.4 Serving and rendering, amended (Orca)

**10.4.1 Index.**
- The cache key is the file's `(dev, ino)`.
- Growth means a larger size with the first indexed bytes unchanged (their hash is kept). On growth the index extends
  from its last complete line. A shrink, a changed head or a new inode means a rebuild.
- A checkpoint falls every 256 lines or every 1 MiB, whichever comes first.
- A trailing partial line (no `\n` yet) is never indexed or served.
- Indexes live in memory only, never on disk (no new path). They sit in one LRU of at most 8 per panel process, shared by
  every viewer of a file.
- A window is at most 200 events, enforced on the server.
- **Source.** A transcript is read from the run directory while it exists, and from the run's archive manifest after
  cleanup.
  - The archive read is one streaming hash check of the artifact file, cached with the index, followed by ranged reads.
    It never uses `readArtifact`, which reads the whole file into memory (`archive.ts:121-131`).
  - If a file disappears between polls, the next request switches to the archive. With neither source, the answer is
    `transcript-gone`, and the page says so.
  - Orca keeps the last `transcripts` listing per run in its control store (an existing path). Each listing `path` maps
    to an archive manifest entry by the same relative path.

**10.4.2 Bounded events.**
- An event's served form is capped at 4 KiB of text per field, as §6.2 says.
- A line over 1 MiB is never parsed. It is served as `notice{kind:"oversized", bytes, type}`, with `type` taken from a
  bounded scan of the line's first 4 KiB. Its body can be expanded only as paged raw bytes.
- Expanding a line of 1 MiB or less re-parses that line and pages the decoded field.
- Heads of decoded fields are cut on code-point boundaries. Raw pages are cut on UTF-8 boundaries.

**10.4.3 Polling.** §6.3 stands. A poll is an `fstat` plus a read of the bytes after the last served offset. It never
spawns `ccloop control collect`, because each collect is a child process (`ccloopPort.ts:298`). The `final` flag comes
from the driver's last collect, or from the call's `outcome.json` appearing.

**10.4.4 What the run page lists (R1).** For each step execution on `FlowRunPage`:
- A single-call step (draft, review, clarify) lists its one call's transcript.
- A work step lists its child group's Orca runs in order. Continuations and retries are included
  (`claimContinuation`, `src/control/service.ts:188`).
- Under each run come its ccloop attempts, under each attempt its phases, and under each phase its calls in `seq` order.
- Each row shows metadata only (phase, runtime, outcome, size).
- One transcript is open per browser tab. The limit lives in the tab, not on the server (M9).
- `ask` and `check` run no agent and list nothing.

### 10.5 Boundary intervention, amended (Orca)

**10.5.1 Pause (R2).** Pause is the flow run's existing `pause` command (flow-message `pause`/`resume`, gaps
`src/flow/messages.ts:86`, `:300-301`; flow engine spec §8.2, `:472` at gaps, "a message is consumed at the next step
boundary"). There is no step-level pause (gaps §6.5).
- **New reach.** When the run has running work steps, each one's child group gets `handoff-stop`
  (`src/control/stopIntent.ts:375-407`), with reason `human` (`:975`).
- **Deadline.** `handoffDeadlineAt` is `acceptedAt` + the contract's `executionPolicy.perAttemptTimeoutMs` + 60 s,
  capped as `freezeHandoffDeadline` caps it (`stopIntent.ts:281-285`). ccloop's phase timeout is at most
  `perAttemptTimeoutMs` (ccloop `runLoop.ts:528-529`), so the running turn finishes. The default 30-minute deadline
  (`stopIntent.ts:64`) could abort it (`handoff_interrupted`, ccloop `runLoop.ts:1629`, `:1698`, `:1950`).
- **The step waits.** A child group stopped this way does not settle its work step. The step stays running, and the run
  shows `paused`.
- **Resume.** Resume is the flow run's `resume`. It issues `resume-from-handoff` (`src/control/continuation.ts:58`;
  requires `handoff-complete`, `:225`) for each such child.
- **No side door.** `resume-dispatch` and `resume-from-handoff` sent directly to a child group whose stop came from a
  flow pause are refused (`flow-pause-resume-via-flow`). Without this, a group verb would undo the person's pause.
- **Budget.** A continuation takes its grant from the predecessor's remaining work and handoff budget, and fails with
  `continuation-budget-unavailable` or `group-budget-unavailable` (`continuation.ts:43-45`). If it fails, the run stays
  `paused` with that refusal shown, not dropped.
- Cancel stays the way to stop now (§7.3).

**10.5.2 Note (R3).** A note is not an input.
- **Record.** The note is recorded on the receiving work execution's body as `operatorNotes: [{seq, by, at, text, scope}]`.
- **Rerun identity.** It is never added to `ranOnInputs`. `ranOnInputsOf` (gaps `src/flow/kernel.ts:776-791`) and the
  byte comparison in `rerun.ts` (`:195`, `:223`) are untouched, so accepts still carry.
- **Delivery.** Delivery happens only through a pause at the boundary and a continuation. Accepting a note requests the
  same boundary hand-off as 10.5.1 for that one step's child group. At `handoff-complete`, Orca continues at once (no
  `paused` state unless the person also paused the run). The continuation envelope carries `work.operatorNote`, frozen
  at prepare like `priorFailures` (`src/control/executionDriver.ts:371-378`) and hashed with the envelope.
- **Several notes.** Notes pending at one boundary are joined in order. Their sum must fit 4096 bytes; otherwise the
  note is refused on accept.
- **Scope.** `remaining-attempts` notes are copied into the step's later continuation runs within the same execution,
  the way `priorFailures` is copied (`executionDriver.ts:371-373`).
- **Limits.**
  - A note re-runs nothing. Step feedback is for that.
  - A new execution of the step does not inherit the notes.
  - A note to a step with no running work child is refused (`flow-note-no-running-work`). This covers single-call steps
    and steps that have not started: in v1 a note has no other delivery path.
- **Command.** The note is a flow-message command `note` aimed at one step. The kernel checks person authority when it
  applies the message, from what the message recorded (the `releaseRefusal` pattern, gaps `messages.ts:157-169`).

**10.5.3 Authority (R2, R3).**
- **Note:** `hasPersonAuthority` (gaps `src/panel/permissions.ts:51-52`). That is an owner on the Web, or the socket with
  an **owner's** person token, never a dispatched run (human: 「非 owner 不能写 note」). §7.4's "the person token" meant
  this.
- **Pause:** a Web principal (owner or member), or a socket principal with a verified person token. Refused for a run
  Orca dispatched, so a run cannot stall a flow. Today flow-message `pause` is `any` (`src/panel/humanOnly.ts:87`). This
  narrows it for the `pause` command alone, checked by command in the kernel, as for `note`.
- **Resume:** `hasPersonAuthority`, for the flow `resume` command.
  - Corrected rationale: a resume overrides the person's own pause. It does not release held effects, which stay with
    `releaseRefusal` and its own person check (gaps `messages.ts:157-169`). A resume moves `paused → running` and nothing
    more (`:301`).
  - Cost if wrong: a member cannot resume a pause they asked for.
  - Rule 7: this replaces "messages are any principal's" (flow engine spec §14.2, `humanOnly.ts:83-87`) for the `pause`
    and `resume` commands only. The other flow-message commands keep it.

### 10.6 Redaction and access, amended (Orca)

**10.6.1** §8.1 stands: on disk the transcript stays raw. Its reason changes: `transcript.jsonl` is evidence for people,
and ccloop's handoff and recovery never read it (10.2.1). They read `events.jsonl`.

**10.6.2 Redaction.**
- **Where it runs.** On decoded string values, after `JSON.parse` and before a head is cut. On the raw text of `unknown`
  and oversized lines.
- **Every served byte.** Windows, follow reads and expand pages all pass it. Pages overlap by 512 bytes for matching. A
  PEM `BEGIN` without its `END` in the page redacts to the page end.
- **Replacement.** Each match becomes `[redacted]`.
- **Shapes.** Each has a fixture, plus one fixture per false-positive case:
  - `\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}`
  - `\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}`
  - `\bgh[pousr]_[A-Za-z0-9]{36,}`
  - `\bgithub_pat_[A-Za-z0-9_]{22,}`
  - `\bglpat-[A-Za-z0-9_-]{20,}`
  - `\bxox[abprs]-[A-Za-z0-9-]{10,}`
  - `\bAIza[0-9A-Za-z_-]{35}`
  - `\bnpm_[A-Za-z0-9]{36}`
  - `\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`
  - JWT `\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`
  - `(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}`
  - the value of any `(?i)(?:proxy-)?authorization\s*:` header
  - the password in `[a-z][a-z0-9+.-]*://user:password@`
  - PEM `-----BEGIN [A-Z ]*PRIVATE KEY-----` … `-----END [A-Z ]*PRIVATE KEY-----`
  - the value (8 characters or more) of an assignment `NAME=value` or `NAME: value` whose name contains `KEY`, `TOKEN`,
    `SECRET`, `PASSWORD`, `PASSWD`, `PASS`, `PWD`, `CREDENTIAL` or `AUTH`
- **Panel environment.** Values (8 characters or more) of the panel's own environment variables with those names, and
  of `*_URL` variables that carry credentials. They are matched by one combined literal matcher, built once.

**10.6.3 Reads and rendering (R1).**
- **Routes.** Transcript routes are registered on the Web listener only. v1 has no CLI reader (ruling 3).
- **Who reads.** An owner or a member, for a run of this panel's store (another project's run is `run-not-found`, as
  for the evidence routes, `src/panel/controlApi.ts:438-445`, `:468-469`). A principal carrying a dispatched run is refused
  (`control-dispatched-run-refused`).
- **Paths.** They come only from the stored listing (10.2.4) or the archive manifest. They resolve under the run's
  `sourceDir/run/`, every component is `lstat`-checked as not a symlink, and the file is opened `O_NOFOLLOW` and
  `fstat`-checked as a regular file.
- **Rendering.** The Web renders agent text as React text nodes, and markdown only through the existing safe subset
  (`web/src/RequirementMarkdown.tsx`). `dangerouslySetInnerHTML` appears nowhere under `web/src`: `git grep -n
  dangerouslySetInnerHTML 37168f0a -- web/src` exits 1 today.

### 10.7 Criteria (replace §6.5)

Each criterion is a command that exits 0 or 1, and each names the mutation that must be seen turning it red (Rule 9).
Mutations run in a `git clone --local` copy only (Orca Rule 15, ccloop Rule 17). Every criterion that writes outside the
repo uses a temporary `ORCA_CONTROL_DIR` and run root (Rule 17). Test paths are created by the plan. Commands run from
the repo root named in the heading.

**ccloop** (its own spec may rename these; ccloop's `npm test` is `vitest run`):

| # | Command | What it shows | Mutation seen red |
|---|---|---|---|
| L1 | `npx vitest run tests/control/handoffTranscript.test.ts` | A fake codex printing 40 MiB completes its run, and `collect` returns a candidate. | `transcript.jsonl` added to `RAW_AGENT_FILES`. The `events.jsonl` cap raised to 128 MiB. |
| L2 | `npx vitest run tests/runtime/transcriptCap.test.ts` | Fake codex/omp at 130 MiB: the agent is not stopped. `events.jsonl` is exactly 16 MiB with the truncation labelled. `transcript.jsonl` ends on a complete line ≤ 128 MiB, followed by one marker. `transcriptTruncatedAt` is set. | `stop("output-limit")` restored on stdout. No truncate-back (mid-line cut). The marker written into `events.jsonl`. |
| L3 | `npx vitest run tests/runtime/streamFold.test.ts` | For every fixture of the existing decoder tests, fold and string give identical results or identical errors. A multi-byte character split across chunks decodes intact. A 17 MiB line gives `<runtime>-events-line-too-large`. | Per-chunk `toString`. Dropping lines over 1 MiB. Skipping the oversized line. |
| L4 | `npx vitest run tests/runtime/claude/runnerTranscript.test.ts` | The runner keeps every line except `content_block_delta`, including `message_start` and `message_delta`. N lines are on disk after a SIGKILL. A dropped line leaves `ccloop.line-dropped`. A single call writes a transcript too. | Async write stream. Dropping `message_delta`. No drop marker. Env var set for phases only. |
| L5 | `npx vitest run tests/control/collectTranscripts.test.ts` | `features` answers `transcripts:"v1"`. Entries are ordered by `startedAt` in a fixture whose names sort the other way. `final` is set for a call with no `outcome.json` in a terminal run. A pre-change call has `path: null`. | Order by directory name. `final` = `outcome.json` only. |
| L6 | `npx vitest run tests/runtime/operatorNote.test.ts` | An envelope without the note hashes byte-identically. The note is rendered in plan and execute when a `lastFailure` exists, and never in verify. | Rendering through `priorFailureLines`. Rendering in verify. |
| L7 | `npm run perf:stream` (on demand, not in `npm test`) | Fake codex, omp and claude each print 1 GiB of lines ≤ 1 MiB. The measured process runs under `node --max-old-space-size=64`: the phase process for codex/omp, the runner for claude. Peak `heapUsed+external+arrayBuffers`, sampled every 100 ms, stays ≤ 32 MiB, so the script exits 0. Over the limit, or an OOM, exits non-zero. | `result.events +=` restored. `chunks.push` restored. The runner keeping the stream. |

**Orca** (T1–T10 are ordinary test files, which `npm test` selects by change, Rule 18; T11 is not part of `npm test`):

| # | Command | What it shows | Mutation seen red |
|---|---|---|---|
| T1 | `npx vitest run tests/agentTranscript/window.test.ts` | Bytes are counted through an injected reader. A tail window reads ≤ 2 strides (2 MiB) plus its lines. A follow read reads only bytes after its offset. A trailing partial line is never served. | Serve with `readFile`. Rebuild the index on every growth. |
| T2 | `npx vitest run tests/agentTranscript/index.test.ts` | A replaced inode, a shrink and a changed head each rebuild the index. Growth extends it. The LRU holds 8 indexes. | Cache keyed by path, size and mtime. |
| T3 | `npx vitest run tests/agentTranscript/oversized.test.ts` | A 2 MiB line becomes `notice{oversized}`, and `JSON.parse` is never called on it (spy). Multi-byte characters at every 4 KiB boundary give no U+FFFD in heads or pages. | Parsing the oversized line. `subarray(0,4096).toString()`. |
| T4 | `npx vitest run tests/agentTranscript/redact.test.ts` | Each 10.6.2 shape is redacted, and each false-positive case is not. A PEM inside a JSON string (with `\n` escapes) is redacted after decoding. Window, follow and expand pages are all redacted. A secret split at a page edge is caught by the overlap. | Redacting the raw line instead of decoded values. Redacting windows but not expand pages. No overlap. |
| T5 | `npx vitest run tests/agentTranscript/access.test.ts` | An owner and a member read on the Web. A dispatched-run principal is refused. The socket listener has no route. A transcript replaced by a symlink is refused. A listing path outside the run directory is refused. | Dropping `O_NOFOLLOW`. Registering the routes on both listeners. |
| T6 | `npx vitest run tests/agentTranscript/archive.test.ts` | After `cleanupCommittedRun`, a window is served from the archive by ranged reads, and `readArtifact` is never called (spy). A file removed between polls switches to the archive. With neither source, the answer is `transcript-gone`. | Reading through `readArtifact`. |
| T7 | `npx vitest run tests/control/ccloopTranscriptsSchema.test.ts` | Orca's strict `features`/`collect` schemas accept `transcripts`. Without the feature, the API serves nothing and the page says why. | Schemas without the key (red on the new-ccloop fixture). |
| T8 | `npx vitest run web/tests/agentTranscript.test.tsx` | `<img src=x onerror=…>` in agent text renders as text. At most 200 event rows are mounted for a 10 000-event window sequence. `thinking` is absent unless `include=thinking`. | `innerHTML` rendering. No virtualization. Always including `thinking`. |
| T9 | `npx vitest run tests/flow/boundaryPause.test.ts` | A flow `pause` with a running work step sends `handoff-stop` (reason `human`, deadline ≥ `acceptedAt` + `perAttemptTimeoutMs`), and the step does not settle. A member on the Web may pause. A socket principal without a person token, or a dispatched run, is refused. `resume` needs `hasPersonAuthority`. A direct group resume of a flow-pause stop is refused. | The default 30-minute deadline (red with a 60-minute `perAttemptTimeoutMs`). `resume` left `any`. Settling the step on hand-off. |
| T10 | `npx vitest run tests/flow/operatorNote.test.ts` | Only the owner may write a note. The note is stored in `operatorNotes` with `by`/`at`. `ranOnInputsOf` gives identical bytes before and after, and a plan still carries accepts. The continuation envelope carries `work.operatorNote`. A note to a step with no running work child is refused. | Adding the note to `ranOnInputs`. Allowing members. |
| T11 | `npm run perf:transcript` (on demand) | 64 MiB and 512 MiB fixtures (with one 200 MiB line, and multi-byte text at every 4 KiB boundary) are generated into a temp directory. The same window, follow and expand workload runs in a child under `node --max-old-space-size=96`. Peak `heapUsed+external+arrayBuffers` stays ≤ 64 MiB, so the script exits 0. Over the limit, or an OOM, exits non-zero. It prints per-request latency and the redaction pass's cost with the commit. These are recorded (Rule 14), not gated. | Serve with `readFile`. Parsing oversized lines. |

`npm test` reports what it selected and skipped. The report quotes that, and a skip is not green (Rule 18, Rule 12).

### 10.8 Open items before the plan (replaces §9)

- **O1 — answered** (10.2.6, 10.5). The field is a new optional `work.operatorNote` on the loop start envelope, beside
  `priorFailures` (ccloop `protocol.ts:273`, `:300`; Orca `schema.ts:62`, frozen at prepare in `executionDriver.ts:371-378`).
  It is rendered in the shared `prompts.ts` builders, not through `priorFailureLines`. The hook is ccloop's existing
  handoff latch, reason `human` (`protocol.ts:317`): checked after plan, execute and verify (`runLoop.ts:1658`, `:1792`,
  `:1994`), and persisted as `handoff_boundary` (`:1437`). The continuation envelope carries the note. The handoff
  `deadlineAt` must exceed the running call's timeout (10.5.1).
- **O2 — kept.** Each agent's own secret masking is unmeasured. It needs one short paid run per runtime that prints a
  fake key, recording what the stream contains. Ask before running.
- **O3 — kept, widened.** The redaction cost is measured on T11, including the decoded-value pass (parse then redact
  costs more than a regex over the line). A budget is set from the measurement, not guessed.
- **O4 — kept.** Other Orca pages that show ccloop attempts (task detail). v1 mounts the component on the flow run page
  only.
- **O5 — new, ccloop Rule 15.** Removing the stdout kill (10.2.2) changes what
  `tests/runtime/codex/runCodexPhase.test.ts:57-60` (the `output-limit` case) and
  `tests/runtime/omp/ompPhase.test.ts:225-226` assert. The human must name each test, and say which ruling the rewrite
  encodes, before ccloop's plan touches them. The same applies to any existing criterion that builds `outcome.events`
  for an adapter (10.2.3), which ccloop's plan lists by file:line.

### 10.9 What still stands unchanged

- §1 Goal and non-goals: stand. "Every earlier attempt" is read through 10.4.4.
- §2 Human rulings: stand, verbatim.
- §3: the table's codex and omp rows stand. The claude row stands except its line cite and its "Over 16 MiB" cell
  (10.1). The paragraph under the table is replaced by 10.1, except for the evidence directory's shape and modes, which
  stand.
- §4.1–§4.5: replaced by 10.2.1–10.2.5. 10.2.6 is new.
- §5.1: stands, with the three changes in 10.3. §5.2: stands for parsing and the index. Serving is replaced by 10.3.
- §6.1: replaced by 10.4.1. §6.2: its 4 KiB cap and paged expand stand, extended by 10.4.2. §6.3: stands, with the
  10.4.3 constraint. §6.4: virtualized list, collapsed blocks and metadata-only rows stand. The attempt list and the
  one-open rule are replaced by 10.4.4. §6.5: replaced by 10.7.
- §7.1: stands. A note reaches only a running work step's next ccloop boundary (10.5.2). A pause between flow steps is
  the existing flow pause. §7.2: its scopes (next attempt by default, every remaining attempt as an option) and "never
  reaches other steps, run-wide guidance is run feedback" stand. Recording and delivery are replaced by 10.5.2. §7.3: "the
  current turn finishes" and "cancel stays the way to stop now" stand. The mechanism and the citation are replaced by
  10.5.1. §7.4: note authority (owner only) and the injection reason stand. Pause and resume authority, the rationale and
  the citation are replaced by 10.5.3.
- §8.1: stands (raw on disk). Its reason is replaced by 10.6.1. §8.2: replaced by 10.6.2. §8.3: O2 stands, and O3
  stands as widened in 10.8. 10.6.3 is new.
- §9: replaced by 10.8.

## 11. Revision 2 (human rulings, session 0e13a9b7, 2026-10-23)

Rulings, verbatim:

- O5: 「同意。但是我们这里可能要定一下最大能支持多大的输出。作为一个hard limit ，比如1G？」
- Landing order (§10): 「同意」.

11.1 **A hard output limit of 1 GiB per call.** §10.2 removes the 16 MiB stop on stdout. In its place, a call whose stdout
passes 1 GiB (1,073,741,824 bytes, counted as the bytes read from the child) is stopped with the existing
`output-limit` reason, as a runaway guard. Below that limit the agent is never stopped for its output size. The three
layers are then:

| Layer | Limit per call | Past the limit |
|---|---|---|
| `transcript.jsonl` (what the live view reads) | 128 MiB | recording stops at the last complete line, a truncation marker is written, the agent runs on |
| `events.jsonl` evidence (handoff packet) | 16 MiB | recording stops at the last complete line, the agent runs on |
| stdout read from the child | 1 GiB | `stop("output-limit")` |

Memory does not grow with the limit, because §10.2 decodes incrementally. The cost of a call near the limit is the CPU
of reading and splitting its lines. The 1 GiB stop is measured by the existing byte counter, so it needs no new state.

11.2 **O5 is settled as follows.** Rewrite `tests/runtime/codex/runCodexPhase.test.ts:57-60` and
`tests/runtime/omp/ompPhase.test.ts:225-226` so that they assert:

- (a) a call printing past 16 MiB and under 1 GiB completes, and its evidence and transcript are capped as in 11.1;
- (b) a call printing past 1 GiB is stopped with `output-limit`.

The ruling each rewrite encodes is this section. ccloop's plan names the lines again at its own commit. The 1 GiB case
uses a fake child that writes cheaply, never a real fixture file.

## 12. Revision 3 (session ffec7b28, 2026-10-24): O2, O3, O4 closed

Written by Orca session `ffec7b28` (subagent), 2026-10-24. The first draft was measured on Orca main `fdceeb83`. This
text is the draft revised in place, before any commit, after an independent review; the controller accepted every
finding. The re-measurements ran on main `8569e88a`. The only commit between the two is docs-only:
`git diff --stat fdceeb83 8569e88a` lists one new spec file. A second review round followed (N1–N7, mapped in 12.5). Its
measurements were taken with main at `b8cf5079`, which differs from `8569e88a` only by three docs commits. §1–§11 stay
as written (Rule 13). Where this section changes an earlier one, it says so as a correction in 12.4.

Human rulings, verbatim:
- 「O2、O3、O4 => 都同意做」
- O4, after explanation: 「也挂任务详情页」

Controller rulings on the review (2026-10-24):
- accept every finding;
- assignment names match case-insensitively, re-measured;
- state the scope of the side-effect check.

Evidence lives under `/private/tmp/orca-ffec7b28/` (`o2/evidence/`, `o3/`). That is scratch space and is not durable.
The numbers below are copied from it so that the spec does not depend on it. Script hashes are in
`/private/tmp/orca-ffec7b28/scripts.sha256`:

| Script | sha256 prefix |
|---|---|
| `count.py` | `f134ddff` |
| `redact-bench.mjs` (v1) | `1462993e` |
| `redact-bench2.mjs` | `4eb030e4` |
| `redact-bench3.mjs` | `7c4fa0f2` |
| `redact-bench4.mjs` (round 2) | `b7bceb7c` |
| `regex-micro.mjs` | `96419d15` |

No fixture file remains in `o3/`.
- `fixture-64.jsonl`, `fixture-512.jsonl` and `fixture2-512.jsonl` were already gone when round 2 began. This session
  did not delete them.
- `fixture4-512.jsonl` was deleted by this session after measuring, as the controller asked.
- Each fixture can be regenerated from its seeded generator with the `gen` command named below.

### 12.1 O2 — closed: no runtime masks secrets in its stream

**Method.**
- One short real call per runtime, in `/private/tmp/orca-ffec7b28/o2/repo/`. That is a git repo whose only file,
  `secrets.txt`, holds two fake keys:
  - `OPENAI_API_KEY=sk-proj-` followed by 48 random alphanumerics;
  - `GITHUB_TOKEN=ghp_` followed by 36.
- The prompt was: "Run the shell command `cat secrets.txt` and then reply with its exact output verbatim, nothing else."
- Each runtime was spawned with ccloop's flags for it, and its stdout was redirected whole to `<runtime>.stdout.jsonl`.
  That is the bytes ccloop would record as `transcript.jsonl` (10.2.1). For claude the file holds more than that: it
  keeps the `content_block_delta` lines, which the runner drops.
- Counts: `python3 -I o2/count.py o2/repo/secrets.txt o2/evidence/<runtime>.stdout.jsonl`, redirected to
  `<runtime>.count.txt`, plus a field-path scan written to `<runtime>.where.txt`.
- ccloop itself was not run, and `CCLOOP_CACHE_DIR` pointed into the scratch directory.
- The probe window was 00:28:30–00:29:59 local time: from the `mtime` of `secrets.txt` to the `mtime` of `omp.exit`.

| Runtime | Invocation | Exit | Key in the raw stream | Where | Masking seen | Tool-reported usage |
|---|---|---|---|---|---|---|
| claude 2.1.309 | `agents.json` command with `--max-budget-usd 1 --model haiku -p --output-format stream-json --verbose --include-partial-messages` | 0 | each key verbatim 4× | `user` line: `message.content[0].content` **and** `tool_use_result.stdout` (tool output twice in one line); `assistant` text; `result.result` | none | `total_cost_usd` 0.00130535 (`claude-haiku-5-5`); input 4, cache write 3774, cache read 37465, output 351 tokens |
| codex 0.163.0 | `codex exec --json --ephemeral --color never --model gpt-6-luna --sandbox read-only -C <repo> -` (prompt on stdin) | 0 | `ghp_` verbatim 3×; `sk-proj-` verbatim 2×, plus 1 altered copy | `command_execution` `aggregated_output` (2 lines: the agent ran `cat` twice); `agent_message` text | none. The model's reply dropped 2 characters (`…pZfuX`**`wf`**`H0…` became `…pZfuXH0…`). That is a transcription error, not masking. | `turn.completed`: input 82057 (cached 53504), output 930 (reasoning 692) tokens. No USD is reported. |
| omp 18.10.1 | ccloop's args (`--profile default --no-extensions --no-skills --no-tools --tools read,grep,glob,bash --no-session --no-title --no-prewalk --model local-litellm/ep-20261012204110-nvhqw --mode json -p --system-prompt <f> --cwd <repo>`), prompt on stdin | 0 | each key verbatim 7×, in 7 of the stream's 250 lines | the tool output is repeated in at least `tool_execution_update` (2 lines), `tool_execution_end`, the tool-result `message_start` and `message_end`, `turn_end.toolResults` and `agent_end.messages` | **in the model's own reply only.** The local model chose to write `` `sk-proj-…` (redacted) ``. omp itself passed the tool output through raw. | per-message usage: input 1971 + 2186, output 117 + 487 tokens. omp reports cost 0 (local LiteLLM). |

**Side-effect check: scope and result (read-only).**
- **`~/.codex/config.toml`.** Its sha256 is the same before and after the codex call (`06a6671b…`), and
  `codex.config.diff` is empty. No trust entry was written.
- **`~/.orca` and `~/.cache/ccloop`.** `find <dir> -newer o2/repo/secrets.txt -type f` listed 0 files
  (`orca-touched.txt`, `ccloop-cache-touched.txt`).
- **Agent homes, against the probe window.** I ran `find <dir> \( -type f -o -type d \) -newer o2/repo/secrets.txt !
  -newer o2/evidence/omp.exit` over `~/.codex` (log and sqlite entries filtered out, and counted), `~/.claude/projects`
  and `~/.omp`. Output: `o2/evidence/m6-mtime-window.txt`; attribution: `m6-attribution.txt`.
  - `~/.codex`: codex's own start-up refresh wrote `skills/.system/**`, `plugins/cache/openai-curated-remote/**`,
    `cache/codex_apps_*`, `shell_snapshots/` and `tmp/arg0-macos`, plus 1 log/sqlite entry. This happens on any codex
    start that uses this home.
  - `~/.claude/projects`: there is no project directory for the probe's working directory. Two other entries changed
    in the window:
    - `-/f988bd28-….jsonl`, which was created at 00:28:23, before the probe started, and contains neither the fake
      key nor the probe path;
    - this session's own `tool-results/`.
  - `~/.omp`: `logs/omp.2026-10-24.52147.log` and `run/daemons/…/clients`.
  - `grep -rl` for the fake key over `~/.codex/{shell_snapshots,tmp,cache}` and `~/.omp` found 0 files.
- **Limits of this check.**
  - It sees mtimes, not content diffs, except for `config.toml`.
  - Other processes write these homes at the same time, notably this Claude Code session.
  - Not checked: `~/.claude` outside `projects/`, `~/.codex` log/sqlite contents, `~/.config`, the keychain, and
    anything outside the named directories.
  - The codex call ran under the user's own `~/.codex`, not a ccloop-isolated `CODEX_HOME`, so the agent also read the
    user's codex instructions (visible in the stream). That does not change the masking finding.

**Findings.**
- F1. None of the three runtimes masks a secret, either in tool output or in the model's reply. Whether the model
  repeats a secret is the model's choice, and it varied. Orca's redaction (10.6.2) is the only redaction for all three
  runtimes. No runtime can be exempted.
- F2. A secret can reach the stream **altered** (codex dropped 2 characters). A literal-value matcher misses an altered
  copy. The shape regex still catches it (`sk-proj-` + 46 characters ≥ 20).
- F3. **Streaming deltas split a secret across lines.** For claude this was measured: no single `content_block_delta`
  line holds the key, but the 25 deltas joined do (`o2/evidence/deltas.txt`). ccloop drops those lines from claude's
  transcript (10.2.1).
  - omp has the same shape, and ccloop keeps it, because omp's transcript is its raw stdout. 231 of omp's 250 lines are
    `message_update` deltas: 30 599 of the stream's 44 986 bytes.
  - In this run omp's deltas did not carry the key, because the model withheld it. For omp the split is inferred from
    the identical delta shape.
- F4. One line can hold the same tool output in several fields: claude 2, omp at least 6 kinds of line. Redaction must
  walk every decoded string, including fields that are not rendered.

**What Orca's redaction must therefore do** (corrections in 12.4):
- Redact all three runtimes, on every served path.
- Never serve a delta's text (C1).
- Keep the shape regexes primary and the literal environment matcher secondary (C4).

### 12.2 O3 — closed: redaction cost measured

Orca has no redaction code: `src/agentTranscript/` does not exist, and `git grep -ln -i redact -- src web/src` returns
nothing, at both commits. What was measured is a **prototype** of 10.6.2 as corrected in 12.4:
`/private/tmp/orca-ffec7b28/o3/redact-bench3.mjs`.
- Every 10.6.2 shape, in one case-sensitive alternation and one case-insensitive alternation.
- Case-insensitive assignment names (C5). JWT matches with or without its third segment.
- PEM span rules: a `BEGIN` without an `END` redacts to the span end; an `END` without a `BEGIN` redacts from the span
  start.
- The token-run rule (C3).
- A 12-value literal environment matcher with fake values. The real environment is never read.
- Redaction runs only on decoded text (C6):
  - lines ≤ 1 MiB are parsed, and every string is walked;
  - the oversized line goes through a streaming JSON-string unescaper and is served as decoded 65 536-code-unit pages,
    each redacted over ±4096 code units;
  - an unparsed line is unescaped, then redacted.

**Fixture.** `node redact-bench3.mjs gen fixture2-512.jsonl 512`, from `redact-bench2.mjs`, which uses the same generator.
- 536 875 395 bytes in 14 861 lines, from a seeded PRNG.
- One 235 720 333-byte line, which carries:
  - 20 secrets placed right after a JSON `\n` escape;
  - 3 PEM blocks straddling page edges, each with its `BEGIN` more than 4096 code units before the edge and a marker
    200 code units after it;
  - 2 tokens of 9000 characters straddling page edges, each with its marker past the look-back.
- 366 planted secrets of 9 shapes in the ordinary lines, including lower-case `api_key = "…"`. 72 of them are "head
  straddlers": a `ghp_` token at code units 4094–4133 of a long field.
- Multi-byte text (CJK, accents, emoji) is dense throughout. Unlike T11, it is not pinned to every 4 KiB boundary.

Every planted secret carries a marker that the filler never contains. The bench **exits 1** in any of these cases:
- the decoded pass leaks a marker;
- the unescaped raw pass leaks one;
- the pages hold no planted marker (`markInPages` must be > 0) or leak one;
- any head straddler shows `gh` at 4094–4095.

**Commands.** Run in `/private/tmp/orca-ffec7b28/o3/`, on Orca main `8569e88a`, Node v22.13.1, Apple M1 Pro (32 GiB):
- `node redact-bench3.mjs selftest` exited 0: the unescaper equals JSON-unescaping at all 102 split points of a sample
  that holds every escape kind.
- `node --max-old-space-size=96 redact-bench3.mjs bench fixture2-512.jsonl result3-512.json` exited 0.
- Mutations, each seen red (Rule 9): `MUTATE=<m> node --max-old-space-size=96 redact-bench3.mjs bench fixture2-512.jsonl
  mut-<m>.json` exited 1 for every `<m>` (`mutations.txt`):

| Mutation | What the bench saw |
|---|---|
| `noEndRule` | 3 page markers leaked |
| `noTokenRun` | 2 page markers leaked |
| `headOnly` (redact `slice(0,4096)`) | all 72 straddlers leaked |
| `noUnescape` (regex over raw page bytes) | 7 page markers leaked, and the raw-line pass leaked |

- Regex cost by rule: `node regex-micro.mjs fixture2-512.jsonl` exited 0 (`regex-micro.out`), over the decoded strings
  of the fixture's first 64 MiB of lines (60.6 M code units).

| Measured (`result3-512.json`, at `8569e88a`) | Value |
|---|---|
| Lines ≤ 1 MiB | 14 860 lines, 287.2 MiB |
| `JSON.parse` only | 396 ms (726 MiB/s) |
| Decoded pass (parse + walk + redact every string) | 396 + 3276 ms → **78.2 MiB/s** |
| Head pass (each field: span of 8192 code units, emit 4096) | 396 + 1617 ms → 142.7 MiB/s |
| Unparsed-line path (unescape + redact) | 72.2 MiB/s, leaked 0 |
| Regex over raw JSON text (comparison only) | 85.1 MiB/s, **leaked 112 of 578 planted occurrences** |
| Oversized line: unescape | 224.8 MiB in 1279 ms (175.8 MiB/s) |
| Oversized line: pages of 65 536 code units, ±4096 look-around | 3201 pages, 0.99 ms per page; 25 markers in, 0 out |
| Windows (≤ 200 events and ≤ 4 MiB, C2), 51 windows (50 spread + tail) | 139–200 events, ≤ 4.00 MiB. Parse + full redact: median 47.1 ms, p95 55.5 ms, max 70.0 ms. Parse + head redact (what is served): median 27.8 ms, p95 30.8 ms, max 38.8 ms. |
| Bench process peak `heapUsed+external+arrayBuffers` | 87.9 MiB, under `--max-old-space-size=96`. This is the bench, not the T11 serving measurement. |

The first draft's v1 bench (`result-512*.json`, at `fdceeb83`) measured 86.4 MiB/s for the decoded pass. Its assignment
rule was case-sensitive and it had no span rules. Its raw-line regex leaked 121 of 477. v1 cannot run the new fixture:
its window reader parses a window that spans the oversized line and runs out of heap (exit 134,
`bench1-on-fixture2.out`). v1's own windows never spanned that line, which its 5.4 MiB maximum window confirms.

**Regex cost by rule** (`regex-micro.out`, rate in M code units/s):

| Rule | Rate |
|---|---|
| Shapes with `\b` | 281.3 |
| Shapes with an escape-aware look-behind boundary `(?:(?<=\\[nrtbf"/])\|(?<![A-Za-z0-9_]))` | **14.0**, 20× slower |
| Assignment, case-sensitive (v1) | 302.5 (191 ms) |
| **Assignment, case-insensitive (C5)** | **180.0 (321 ms)**: the cost of the ruling is +130 ms per 60.6 M code units |
| Bearer / authorization / URL password | 58.2, the costliest rule, and the first target if the budget is missed |

The 20× result is why C6 decodes raw text instead of widening the regex boundary, as the review proposed. The
look-behind defeats V8's first-character scan for the whole alternation. v2 used it and fell to 11.3 MiB/s
(`result2-512.json`).

**Round 2: checkpoint resume, surrogate edges, cover-start** (`redact-bench4.mjs`, with main at `b8cf5079`).
- **Generator.** `node redact-bench4.mjs gen fixture4-512.jsonl 512` wrote 536 901 263 bytes in 14 923 lines. The
  oversized line (238 073 617 bytes) holds everything in the v3 fixture, plus:
  - 227 checkpoint straddlers, one per 1 MiB raw stride: 113 raw 4-byte UTF-8 characters (U+1F600) starting 1–3 bytes
    before the stride, and 114 escaped surrogate pairs `\ud83d\ude00` starting 1–11 bytes before it, so the
    checkpoint falls inside a `\u` escape, between the two escapes, or after a backslash;
  - 10 U+1F600 characters and 10 escaped pairs whose high surrogate sits at 65536·k − 1, exactly on a page edge;
  - 10 `ghp_` tokens starting 19 code units before a page edge, with the marker after the edge.

  The ordinary lines add 69 fields with U+1F600 at code units 4095–4096 and 97 head straddlers.
- **Bench.** `node --max-old-space-size=96 redact-bench4.mjs bench fixture4-512.jsonl result4-512.json` exited 0
  (`bench4-512.out`).
  - The forward pass served 3201 pages: 35 markers in, 0 out. It checked 69 emoji heads, and found 0 lone surrogates
    and 0 U+FFFD in heads and in pages.
  - It recorded 227 checkpoints.
  - Then it served 489 sampled pages (every 7th, plus pages around the planted edges) **from their checkpoints**:
    - each page used the last checkpoint whose decoded offset is ≤ `a − 4096`;
    - each read from that checkpoint's raw offset, decoded, and redacted.
  - 0 of the 489 differed from the forward pass (compared by sha1).
- **Measured cost of a page served by resume** (raw read + decode + redact): median **3.53 ms**, p95 **6.34 ms**, max
  21.19 ms; median raw read 0.75 MiB, max 1.25 MiB. This replaces the derived ≈ 5.7 ms.
- **Other rates on this fixture:** decoded pass 76.1 MiB/s, unescape 249.1 MiB/s, forward page redaction 0.74 ms, head
  windows median 27.4 ms and p95 30.2 ms.
- **Peak** `heapUsed+external+arrayBuffers`: 69.2 MiB.
- **Mutations** (`mutations4.txt`), each exit 1:

| Mutation | What the bench saw |
|---|---|
| `noPendingUtf8` (checkpoint drops the pending UTF-8 bytes) | 163 of 489 resumed pages differ |
| `noPendingU` (checkpoint drops the pending `\u` digits) | 133 differ |
| `noCoverStart` (a match covering a page start is skipped on that page) | 15 page markers leaked |
| `noSurrogateAdjust` | 116 lone units in heads, 40 in pages |

**Derived, not measured.** Without C2 a window is bounded only by the 128 MiB transcript cap (10.2.2). At 78.2 MiB/s
that is about 1.6 s of redaction on the panel's single thread for one request. With C2 a window is ≤ 4 MiB, about 51 ms
at the full-pass rate.

**Budget, set from the measurement.** Recorded by T11, not gated, as 10.7 does for latency:
- the redaction work for one window is ≤ 100 ms on the dev machine (measured p95: 55.5 ms full, 30.8 ms head);
- one expand page of an oversized line served from its checkpoint is ≤ 15 ms (measured p95 6.34 ms, round 2);
- one forward page's redaction is ≤ 2 ms (measured 0.74–0.99 ms).

### 12.3 O4 — closed: the component also mounts on the task detail (human: 「也挂任务详情页」)

Citations were measured at `fdceeb83`. The only later commit, `8569e88a`, touches no code.

**Unit.** The transcript component takes one **Orca run id**. That is the unit 10.4.4 already lists under a flow step:
the child group's runs, then ccloop attempts, phases, calls. Every task-control place that shows an Orca run mounts the
same component.
- **Listing source:** the last `transcripts` listing Orca stored for the run (10.4.1). The driver keeps one for every run
  it collects, including runs of groups that no flow started.
- **Single calls** are Orca runs of phase `single-call` with a `purpose`: `src/control/webProtocol.ts:369-371`; clarify
  and split go through `src/control/requirementCalls.ts:117`. **Estimates** are runs of phase `estimate`. Both list their
  calls as 10.2.4 lists any call.

**Where it mounts.**
- **Task detail.** `web/src/TaskDetail.tsx` `TaskDetail`, its "runs of task" list (`:280-309`; runs filtered by `taskId`
  at `:232`). Each run's `<li>` (`:286`) gets a collapsed "Transcript" disclosure beside `EvidenceList`.
  - `TaskDetail` has no `active` prop today. It gains `active?: boolean`, which `ControlGroupView.tsx:675` sets to
    `props.active !== false`, beside the existing `resultsActive`.
- **Group runs table.** `web/src/ControlGroupView.tsx`, the `runs` region (`:585-620`), in the evidence cell
  (`:613-616`). This row already shows ccloop attempts (`control.group.attempt`, `providerAttemptOrdinal`, `:607`) and
  lists estimate and single-call runs.
  - Its `active` is `props.active !== false && region === "runs"`, the pattern of `:525`, `:568` and `:573`.
- **Flow run page:** unchanged (10.4.4).

**Behaviour.**
- A collapsed disclosure makes **no request**.
- Opening it reads the run's listing and shows attempts → phases → calls as metadata rows (10.4.4, §6.4). Opening a call
  loads its window.
- With `active === false` it sends no request and stops polling. Hidden panes stay mounted (`ControlGroupView.tsx:322`),
  as `SavedResultEntry` already handles (`TaskDetail.tsx:316-320`).
- The 1 s follow poll (§6.3, 10.4.3) runs only while all of these hold: the document is visible, `active` is true, the
  call is open, and the call is not `final`.
- One transcript open per tab (10.4.4) is a single module-level slot, shared by the flow run page, the task detail and
  the runs table.
- Archived groups keep it, because it is read-only, like `RunActivity` (`TaskDetail.tsx:155-158`). After cleanup it
  reads from the archive (10.4.1).
- A ccloop without `features.transcripts` shows "no transcript recorded by this ccloop" (10.2.4).

**Read endpoints: the flow page's, keyed by run.** 10.6.3 fixes access but names no routes. This section names their
shape once for all three mounts. They sit beside `/api/control/runs/:runId/evidence` and `/activity`
(`src/panel/controlApi.ts:497`, `:529`):
- `GET /api/control/runs/:runId/transcripts`: the stored listing, as `{attempt, phase, seq, bytes, final, truncatedAt}`.
  `path` is never sent to the browser.
- `GET /api/control/runs/:runId/transcripts/:attempt/:phase/:seq`: a window (tail, before or after an offset), or a follow
  read from an offset.
- `…/:attempt/:phase/:seq/expand`: one event's paged body.

The plan names the query parameters. No route is keyed by task or group. The web fetch helpers sit beside
`fetchRunEvidence` and `fetchRunActivity` (`web/src/controlApi.ts:151`, `:178`), and all three mounts call the same
helpers.

**Access (10.6.3, now for every mount).**
- Routes are registered only under `channel === "web"`, the pattern of `src/panel/controlApi.ts:355`.
- An owner or a member reads.
- A principal carrying a dispatched run is refused with `control-dispatched-run-refused` (the check at
  `src/panel/controlApi.ts:356-358`).
- Another store's run is `run-not-found`.
- Paths resolve only from the stored listing or the archive manifest, with the `lstat` / `O_NOFOLLOW` checks.
- No write control appears on the task detail. Note and pause stay on the flow run page (10.5).

### 12.4 Corrections to earlier sections (they stay as written; these supersede them)

- **C1 → 10.3 and §5.2's "口子" model (deltas), from O2 F3 and review I3.**
  - **Delta lines:** omp `message_update` (every `assistantMessageEvent` type, including `text_end`), omp
    `tool_execution_update`, and any claude `stream_event` that reaches a transcript.
  - **They are never served.** They are counted and indexed only. There is **no** query flag for them, unlike
    `thinking`.
  - **One source per piece of text,** so nothing is rendered twice:
    - An omp assistant message's text comes only from `message_end.message.content`.
    - An omp tool's output comes only from `tool_execution_end`.
    - `turn_end` is a turn-boundary event without text.
    - `agent_end` is the `result` event, and its repeated `messages` are not rendered.
    - A `message_start`/`message_end` whose message has role `toolResult` is not rendered as a message.
  - **Consequence (review N7), accepted for safety.** omp tool progress (`tool_execution_update`) is not shown live in v1.
    A running omp tool shows its start event, and its output appears when `tool_execution_end` arrives.
- **C2 → 10.4.1 (window size), from O3 and review I2.** A window is at most 200 events **and** at most 4 MiB of bytes
  read.
  - The byte count includes lines that are read but not served (deltas, `thinking`).
  - An oversized line counts as its scanned 4 KiB prefix.
  - The first line is always served, even when it is larger than 4 MiB.
  - A window stopped by the byte bound returns fewer events and a continuation offset.
  - T1's bound, "a tail window reads ≤ 2 strides plus its lines", still holds: the strides are read only to find
    lines, and the 4 MiB bounds the lines.
- **C3 → 10.6.2 "before a head is cut", the 512-byte page overlap, and 10.4.2's units (review I1, K2, M5).**
  - **One unit.** All decoded text is measured in UTF-16 code units: the head is 4096, the look-around 4096, a page
    65 536. Byte limits stay bytes: the 4 MiB window, the 1 MiB parse threshold, the 1 MiB stride.
  - **Served range.** A served range `[a, b)` (a head is `[0, 4096)`; page k is `[k·65536, (k+1)·65536)`) is redacted
    over `[a−4096, b+4096)`, and only `[a, b)` is emitted.
  - **Surrogate edges (review N3).** An edge (`a` or `b`) that falls between a high and a low surrogate moves to
    edge − 1. The server computes both edges of page k itself, so page k ends exactly where page k+1 starts. No served
    head or page holds a lone surrogate or U+FFFD.
  - **Cover-start (review N4).** A match that covers `a` is emitted on that page as one `[redacted]` at its start, never
    as its original tail.
  - **Cut position.** The cut is at the redacted position of the original offset `b`. A match that starts before `b` is
    emitted whole as `[redacted]`, and no original character at or past `b` is ever emitted. Cutting the redacted output
    at 4096 is wrong: earlier redactions shorten the text and pull later original characters into the head.
  - **Span rules.**
    - A PEM `BEGIN` without an `END` in the span redacts to the span end.
    - An `END` without a `BEGIN` before it in the span redacts from the span start to the `END`.
    - A run of token characters `[A-Za-z0-9_\-+/=.~]` that begins at the span start and reaches `[a, b)` is redacted.
      Such a run is at least 4096 long. A base64 blob that long is redacted too, an accepted false positive.
    - JWT matches with or without its third segment.
  - The full value of a field is redacted only page by page, when it is expanded.
  - This replaces 10.6.2's 512-byte overlap and 10.4.2/§6.2's "4 KiB of text".
- **C4 → 10.6.2 (panel environment), from O2 F2.** The literal environment matcher is a second net behind the shape
  regexes, never the only rule for a shape.
- **C5 → 10.6.2 (assignment names), controller ruling on review M4.** The assignment rule's name match is
  case-insensitive (`api_key = …`, `Password: …`). Names that merely contain a secret word (`monkey=…`, `passage: …`)
  are redacted too, an accepted false positive.
  - **Measured cost (review N5 scope):** the assignment rule **alone**, over the decoded strings of the first 64 MiB of
    lines of `fixture2-512.jsonl` (60.6 M code units), runs at 180.0 M code units/s against 302.5 case-sensitive: 321 vs
    191 ms (`regex-micro.out`).
  - **The whole decoded pass**, with every rule, runs at 78.2 MiB/s (12.2).
- **C6 → 10.4.2 and 10.6.2 "on the raw text of `unknown` and oversized lines", from review K1.** No regex runs on raw
  JSON text.
  - **Oversized line (> 1 MiB).** It is never parsed. Its pages are **decoded text**, not raw bytes. A streaming
    UTF-8 decoder plus JSON-string unescaper produces them.
  - **Checkpoints (review N1).** The index pass records a checkpoint at every 1 MiB raw stride inside the line:
    `{raw byte offset, decoded code-unit offset, inString, escape pending, pending \u digits, pending UTF-8 bytes}`.
    - To serve the page `[a, b)`, the server takes the last checkpoint whose decoded offset is ≤ `a − 4096`, reads from
      its raw offset, decodes with its state, and then applies C3.
    - The decoder state is the only per-checkpoint memory: at most 4 hex digits and 3 bytes.
    - Measured in round 2 (12.2): resumed pages equal the forward pass, at a p95 of 6.34 ms.
  - **Oversized notice (review N6).** In `notice{kind:"oversized", bytes, type}` (10.4.2), `type` is set only when the
    value scanned from the line's first 4 KiB matches `^[A-Za-z0-9_./-]{1,64}$`. Otherwise it is omitted.
  - **`unknown` line ≤ 1 MiB.** If it parses, it takes the decoded pass. If it does not, it goes through the same
    unescaper, then redaction.
  - **Why not the review's boundary.** The review's fallback was a boundary that accepts a preceding `\n`-style escape.
    It was measured at 20× the cost (12.2) and is not used.
- **C7 → 10.8 / §8.3 / §9.** O2, O3 and O4 are closed by 12.1–12.3. No open item remains before the plan.
- **C8 → 10.7 (criteria).** These add to T1, T4 and T11, and add T12 and T13. Each names the mutation that must be seen
  red.
  - **T1 adds:** a window whose lines exceed 4 MiB returns ≤ 4 MiB, or exactly one event when the first line alone is
    larger, plus a continuation offset. Delta lines count toward the 4 MiB. Mutation: drop the byte check.
  - **T4 adds:**
    - An omp `message_update` line's text is never served, and a secret split across two delta lines is in no served
      window. Mutation: serving deltas.
    - Secrets placed after `\n` escapes inside an oversized line, a PEM split at a page edge with the marker after the
      split, and a 9000-character token across a page edge. The test asserts `markInPages > 0` before it asserts
      `markOutPages == 0`. Mutations: regex over raw page bytes; dropping the `END`-without-`BEGIN` rule; dropping the
      token-run rule.
    - In a long field, a `ghp_` token straddling 4096 shows no fragment in the head. Mutation: redacting
      `slice(0, 4096)`.
    - A field whose first 4096 code units hold a 4000-character PEM, followed by a token straddling 8192, shows no
      fragment of that token in the head. Mutation: cutting the redacted output at 4096 instead of at the original
      offset.
    - Lower-case `api_key = "…"` is redacted. Mutation: a case-sensitive name match.
    - A `ghp_` token that starts before a page edge, with its marker after the edge, is emitted on the next page as one
      leading `[redacted]` (review N4). Mutation: skipping a match that covers the page start.
    - Status:
      - Seen red as bench mutations in 12.2: serving raw page bytes, dropping the `END`-without-`BEGIN` rule, dropping
        the token-run rule, redacting `slice(0, 4096)`, and skipping a match that covers the page start.
      - Specified and not yet run: serving deltas, cutting the redacted output at 4096, and a case-sensitive name match.
  - **T3 adds (review N2, N3):**
    - Escaped surrogate pairs and raw 4-byte UTF-8 characters straddle every checkpoint of an oversized line. Page k
      decoded from its checkpoint equals the same page decoded from byte 0. Mutations: a checkpoint without the pending
      UTF-8 bytes; a checkpoint without the pending `\u` digits.
    - An emoji placed exactly at 4096 in a field and at 65 536·k in an oversized line gives no lone surrogate and no
      U+FFFD in the head or the pages. T3's existing no-U+FFFD case stays. Mutation: no surrogate edge adjustment.
    - A line whose first 4 KiB holds a `type` outside `[A-Za-z0-9_./-]{1,64}` gives a notice without `type` (N6).
      Mutation: copying `type` unchecked.
    - All of these except the N6 case were seen red as bench mutations in round 2 (12.2).
  - **T11:** its fixture plants the oversized-line secrets above, and it prints the rates and window costs in the form
    of the 12.2 table against the 12.2 budget (recorded, not gated).

  | # | Command | What it shows | Mutation seen red |
  |---|---|---|---|
  | T12 | `npx vitest run web/tests/taskDetailTranscript.test.tsx` | A run row in `TaskDetail` and one in the group's runs table each render a collapsed disclosure and make **no** request until opened. Opening calls the fetch helper the flow page uses (spy on the shared module) with that row's run id. An open, non-final call polls and stops when it is `final`, when `active` turns false (`TaskDetail`: the group pane is hidden; runs table: `region !== "runs"`), and when the document is hidden. Opening one transcript in the runs table closes one open in `TaskDetail`. An archived group still opens it. | Fetching on mount while collapsed. A page-local fetch function (the spy sees no call). Polling with `active=false`. `TaskDetail` ignoring its new `active` prop. A per-component open slot. |
  | T13 | `npx vitest run tests/agentTranscript/runListing.test.ts` | A run of a group no flow started has its `transcripts` listing stored at collect. `GET …/runs/:runId/transcripts` serves it to an owner and a member on the Web. A dispatched-run principal is refused (`control-dispatched-run-refused`), and the socket listener answers `route-not-found`. Listing rows carry no `path`. | Storing listings only for flow children. Registering on both listeners. Sending `path`. |

### 12.5 Review mapping

- **Round 1 → where it is closed.**

  | Finding | Closed in |
  |---|---|
  | K1 | C6 |
  | K2, I1, M5 | C3 |
  | I2 | C2 |
  | I3 | C1 |
  | I4 | C8 |
  | I5 | 12.3, T12 |
  | M1, M2, M6 | 12.1 |
  | M3 | 12.2 "Derived" |
  | M4 | C5 |
  | M7 | 12.3 |

- **Round 2 → what changed.**
  - N1: the checkpoint fields and lookup in C6.
  - N2: T3 adds the checkpoint-straddle equality case and its mutations. Checkpoint resume is implemented and measured
    in the bench (12.2, round 2): 489 pages, 0 mismatches, p95 6.34 ms. That replaces the derived ≈ 5.7 ms in the
    budget.
  - N3: the surrogate edge rule in C3, and the T3 emoji cases at 4096 and 65 536·k.
  - N4: the cover-start rule in C3, and its T4 case.
  - N5: the C5 cost is scoped to the assignment rule alone, over the first 64 MiB of lines.
  - N6: the `type` allow-list in C6, and its T3 case.
  - N7: the consequence noted in C1.

## 13. Correction (review 7753e97d, session orca-dev-03c89de8, 2026-10-27, on branch `fix/flow-pause-review`)

This section supersedes the parts of 10.5.1 and 10.5.2 it names; their text stays as written.

- **A settled child under a pause (10.5.1 "Resume").** A child that landed or failed after the pause reached it has no
  turn to continue, and `resume-from-handoff` refuses it for good (`continuation-predecessor-unrecoverable`). The flow's
  `resume` now reads each paused child's status first. A settled child leaves the resume batch, its pending notes are
  spent with `undelivered: "child-settled"`, and the kernel collects its result once the run is `running` again. Its
  stop, which froze nothing, stays on the finished child.
- **A note whose child settled first (10.5.2 "Delivery").** The note is spent the same way, and its `noteIntent` step is
  cleared, so the step settles and the run can finish. The run view shows each such note as `undeliveredNotes:
  [{seq, reason}]` on the execution.
- **A pause meeting a note's stop.** A child holds one stop, and the child refuses a second one (`stop-mode-conflict`).
  When a pause finds a step whose note has already stopped it, the pause step takes that stop over (`stop: "note"`,
  the note's marker and deadline), and its `noteIntent` step is removed. The note's own resume therefore never
  restarts a paused child, and the person's `resume` delivers the note.
- **One transaction for a resume.** The port's `resume` takes the flow's bookkeeping (notes delivered, intents cleared,
  run state) as a callback, and runs it inside the transaction that lifts the stops. A crash leaves both or neither,
  so a note is never sent twice.
- **The pump passes a paused run that still owes stops.** This means a run with a `pauseIntent` or `noteIntent`. A
  stop that failed is placed again, and an incomplete one is shown in `lastError`. A persistent `lastError` is
  written once, not cleared and written again on every tick.
- **Open (not closed by this correction).** A flow-stopped child whose handoff ends `handoff-partial` (a frozen run
  settled unrecoverable) or `handoff-unresolved` has no recovery verb. The flow's `resume` needs `handoff-complete`,
  and `resume-dispatch` / `resume-from-handoff` refuse a flow stop (`flow-pause-resume-via-flow`). `recovery-retry`
  refuses a flow child (`flow-child-managed`). The run's `stop` waits for a boundary that never comes. The run view
  names the state (`lastError: flow-pause-stop-incomplete:<step>:handoff-partial|handoff-unresolved`). What the flow
  should do with such a child (fail the step for a `retry`, restart it, or let `stop` end a paused run) is left to a
  person's ruling.

## 14. Correction (controller ruling, review 7753e97d, session orca-dev-03c89de8, 2026-10-27)

This closes the open item in section 13. The human delegated the call (「这一轮执行过程中如果有问题，先按你的建议执行」),
and the controller ruled that a person's stop must always have a way out.

- **A `stop` on a `paused` run applies at once.** It is taken in the mid-run lane with pause, resume and note. It no
  longer waits for a boundary (this supersedes flow engine spec §8.2 for this one case). A `stop` on a `running`
  run still waits for its boundary.
- **Each running execution is settled first.** A child that landed or failed settles as it would at any pass. An effect
  that happened stays recorded as applied, and the step's result is taken. Every other child ends the step `failed`
  with `flow-run-stopped:<child stop state>` (for example `handoff-partial`, `handoff-unresolved`, or `no-stop`).
  Its pending notes are spent with `undelivered: "run-stopped"`, and `pauseIntent` and `noteIntent` are cleared. Then
  the run moves to `stopped`, as the boundary `stop` moves it.
- **Nothing starts or is released.** An invalid output, a call or a dispatch from the settle is not followed; the step
  ends `failed` instead. A held external effect step is parked, never running, so it stays held (gaps §21). The children
  keep the flow's stop. The person starts a new run.
- **`FlowChildPort.resume` takes `record` as a required argument** (section 13: one transaction for a resume).

### 12.6 Corrections from the implementation review (session 7753e97d, 2026-10-27, branch `fix/transcript-review`)

Written by the implementer of review findings 1-9 (Orca session 7753e97d). The sections above stay as written; these
supersede them where they differ.

- **10.6.2 Shapes, the assignment rule.** A JSON key/value pair is an assignment too. In a composite value (a tool input,
  an unknown line, codex `mcp_tool_call` arguments and result, omp `args`), a string value of 8 characters or more under
  a key whose name carries a secret word (the 10.6.2 list; `AUTH` covers `authorization`) is redacted whole, and every key
  is redacted as a decoded string. In decoded text that keeps JSON quotes (an oversized or unparsable line), the rule
  allows a closing quote after the name: `"API_TOKEN": "…"`.
- **10.6.2 Shapes, bounds.** The URL scheme is `[a-z][a-z0-9+.-]{0,31}`, and the parts of an assignment name before and
  after its secret word are `[A-Za-z0-9_]{0,64}` each. Unbounded, redaction was quadratic (35 s over 128K characters of
  `a.`, measured by the review probe `/private/tmp/orca-7753e97d/review-transcript/probe/redos.ts`); bounded, the same
  probe reads 8.9 ms at 128K. A longer scheme or name part is not matched (accepted).
- **10.4.1 index cache.** A request whose size did not shrink checks the head hash, the same size included (a file
  rewritten in place keeps its inode). Requests for one key run one at a time.
- **10.4.1 Source / 12.3 listing.** A live call's size and its `outcome.json` are read through the same component walk
  as the transcript itself (no symlinked directory is followed).
