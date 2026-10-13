# OMP syncskill injection (second OMP increment)

Session `808feb6a`, 2026-10-13. Builds on `2026-10-12-oh-my-pi-agent-integration-design.md`, whose §1 deferred
"omp skill injection" and "a bounded single-call estimator". The human asked this session to carry on the deferred OMP
work and to decide open questions itself, reporting the decisions for review at the end. This increment does skill
injection only; §4 records why the single-call estimator is still not offered.

## 1. Goal

A task whose loop plan declares a syncskill profile can run on an `omp` installation. Today Orca refuses it with
`skills-unsupported-agent` at confirm, set-task-loop and run start (A2), and ccloop's `accept` would refuse any skill
directory field for omp.

## 2. Design

**Envelope.** ccloop protocol 3 and protocol 4 loop work gain a third optional field, `ompSkillsDir`: the canonical
absolute per-run snapshot `skills` directory, the same directory Orca already hands Codex (`<snapshot>/skills`). The
three skill fields are mutually exclusive. Absent, an envelope parses and hashes exactly as before. Path validation is
the Codex field's: absolute always, canonical existing directory only at `accept`.

**Accept.** `accept` refuses `ompSkillsDir` for any kind but `omp` with the existing `skills-unsupported-agent`, before
anything is persisted (same place and order as the two existing checks).

**Runtime: no OMP skill discovery.** Every OMP phase keeps `--no-skills` and `--no-extensions`. OMP's own discovery reads
many sources (user and project `.omp`, `.claude`, `.agents`, plugin roots); turning it on would load whatever skills the
operator's machine holds and make a run irreproducible, and OMP 18.10.1 has no CLI switch that limits discovery to one
directory. Instead ccloop presents the snapshot the way OMP itself presents skills (a name/description list, read on
demand): before spawning a phase it enumerates the snapshot and appends a `<skills>` block to that phase's private system
prompt file. Each entry gives the skill directory name, its single-line `description:` frontmatter value when there is one
(newlines folded, at most 1024 characters; otherwise a note to read the file), and the absolute path of its `SKILL.md`.
The prompt tells the model to read a matching skill's `SKILL.md` with the read tool before acting on it. OMP's read tool
resolves absolute paths, and the phase tool allowlists already include `read` in every phase, so no tool list changes.

**Snapshot checks, before spawn (fail loud).** The root must be absolute, canonical, a directory and outside the
worktree. Each child other than a regular `syncskill-lock.json` must be a canonical directory holding a regular
`SKILL.md`. Any violation fails the phase as `omp-skills-source-invalid:<detail>` with `neverStarted` true; no provider
request is made. ccloop does not write into the snapshot; Orca already makes it read-only and removes it with the
workspace, so OMP needs no cleanup step (unlike Codex's worktree links).

**Evidence.** The phase's `system-prompt.md` evidence file already holds the full prompt, so the injected list is
recorded with every call.

**Orca.** `assertSkillsAgent` and the driver's A2 check accept `omp`; the driver hands an omp run
`ompSkillsDir: <snapshot>/skills`; the envelope types and schema carry the field; the refusal text names the three kinds.

## 3. Boundaries

- The model is told, not forced, to read skills; the same holds for claude and codex skills.
- Skills reach plan, execute and verify alike, as they do for the other kinds.
- Until ccloop is published and Orca repinned, Orca only reaches this through a local ccloop build (`ORCA_CCLOOP_BIN`).

## 4. Single-call estimator: still not offered (decision, for human review)

ccloop's contract for `singleCallExecution: "v1"` (registry.ts, spec 2026-09-27 §4.4) is one structured call with every
tool off **and an output-token cap**. Read of OMP 18.10.1 and pi-ai sources on this machine, 2026-10-13:

- the CLI has no per-invocation output-token flag (`omp --help`); `--max-time` bounds time, not tokens;
- the only cap is a model's catalog `maxTokens` (`omp models --json`), which lives in the operator's `models.yml`, and
  providers send it conditionally (`pi-ai/src/providers/openai-shared.ts` `resolveOpenAIOutputTokenParam` sends a cap
  only when the caller passes `maxTokens` or the provider compat sets `alwaysSendMaxTokens`, and never when the model sets
  `omitMaxOutputTokens`);
- OMP retries a turn on transient provider errors (`openai-completions.ts` `mapStopReason` words gateway errors so "the
  turn [is] auto-retried"), so even a per-request cap would not bound a call.

So an OMP single call cannot honour `maxOutputTokens`, which is exactly why Codex answers `null` too. `omp` keeps
answering `null`; estimates, clarify and split stay blocked for an omp selection with the existing
`single-call-unavailable` reason. Reopening this needs either an OMP flag that caps one invocation or a decision to accept
an unbounded single call, which would change the §4.4 contract and Orca's budget reasoning.
