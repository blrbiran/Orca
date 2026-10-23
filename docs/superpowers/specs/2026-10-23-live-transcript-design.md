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
