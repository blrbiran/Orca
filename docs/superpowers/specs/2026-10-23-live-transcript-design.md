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
