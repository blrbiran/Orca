# Independent targeted verifier-start specification review

Owner: `/root/spec_review`, 2026-10-10 Asia/Shanghai.
Observed Orca HEAD: `7007a67e8a2ea741251dfe9f1dde11e31dc646b8` (read with `rtk proxy /usr/bin/git rev-parse HEAD`). The reviewed §8.5 includes the appended timing/freshness paragraph in the working tree; HEAD is provenance, not a claim that every reviewed line is committed.
Reviewed §8.5 text SHA-256: `ca3d49f8e759032bbfbea04e33a96d46b11c247fec1ebe83c2f181a671016d68` (Python SHA-256 of newline-joined `splitlines()[112:]`, without a trailing newline).

## Verdict

**Ready. Open findings: 0 P1, 0 P2.**

This verdict covers only `docs/superpowers/specs/2026-10-10-task-results-design.md` §8.5, lines 113–121, against the binding lifecycle, metadata-isolation and no-extra-call requirements in §8.1–§8.3. It does not repeat the whole-spec review or certify implementation. The original review and ready re-review remain unchanged.

## Assessment

- **Actual start authority:** Line 117 places the immutable observation at actual `runVerification` entry after core preconditions/owner check. Line 115 explicitly rejects using an earlier progress label or execution-finished event as start evidence. The strict three-field started object has a literal schema discriminator, positive safe attempt and literal in-progress status; it proves entry only, never pass/reject.
- **Exact manifest compatibility:** The new evidence uses existing stage `verification` and `verificationRef`, retaining the original execution/output snapshot. Completed verification still refers to the actual VerificationResult JSON. Started and completed observations are distinct and ordered; the design does not add manifest fields or new stage values. The surrounding manifest supplies run/generation/owner identity and its attempt must bind the evidence attempt under existing validation rules.
- **Immutable lifecycle:** Lines 117–121 fit §8.3 successor observations. A normal success may produce execution, started and completed records without recapturing output bytes. Completion can supersede started for the same attempt; records from other attempts/runs do not upgrade the current attempt.
- **Nonfatal timing and budget:** Line 119 preserves existing provider/usage/attempt/budget semantics. The final line 121 makes the important mechanism explicit: start recording cannot gate provider invocation or add awaited metadata I/O to measured verification/budget time. Queued work remains fenced, every promise is observed, and ordering resolves before completed publication or cleanup. The contract therefore does not authorize awaiting a fallible metadata writer before starting actual verification or letting a queued rejection escape into core execution.
- **Honest missing/terminal states:** With an actual started record and no completed evidence, terminal/interrupted verification is unavailable, not pass/reject. Missing start on active/unknown work proves neither not-run nor failure; line 121 requires unavailable until an authorized structured fact establishes state. Stopped-before-verifier is not-run only with the actual lifecycle fact. This closes the false-negative gap between absent optional evidence and proved non-execution.
- **No new calls or authority:** Line 117 explicitly prohibits another Agent invocation. Existing optional read/index transport and admitted-evidence ownership remain binding; consumers cannot invent started facts from progress labels, unstructured logs, missing files or report claims.

## Implementation evidence still required

The existing live-paused and handoff-before-verify criteria must distinguish actual entry from a guard that stops before entry. Delayed/rejected start persistence must preserve invocation count and existing measurement/budget semantics; observed promise completion and owner fencing must prevent late started publication from displacing completed evidence or writing after cleanup. Missing-start and terminal-started-without-completed cases must render the defined unavailable/not-run distinction using real authorized facts.

These are implementation acceptance obligations already required by the effective contract, not new specification findings. No source probes, implementation edits, tests, provider calls, subagents or runtime/publication actions were performed. Only the requested specification text and Git HEAD metadata were read, and this report was written.

The no-backfill, fixed-pin, paired-build versus publication and production-runtime boundaries remain unchanged. This targeted Ready verdict authorizes neither a claim of installed report production on ab824d1 nor a service switch.
