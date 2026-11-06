# Evidence-backed recovery of an exhausted or format-failed attempt (#158, #163, #183)

Status: design only, 2026-11-07, Orca `9fee12ca` + ccloop `6b9792c` (pinned `c0ddc71`). This is the separate
source-evidence work that terminal closure (#169) deliberately does not pretend to do. Nothing below waives ccloop's
saved-result authority rules; an attempt becomes recoverable only when a trusted producer captures, before cleanup, the
facts a later verifier needs.

## Why closure is not recovery

Orca's `close-run` releases a proved terminal failure's unused reservation. It keeps `drive.outcome`, the report and the
attempt identity, but it grants no authority to treat the failed execute as success. Today ccloop's saved-result source
validator accepts a Codex legacy `failed` execution whose original stream uniquely decodes and whose published attempt
ref and complete archive verify. An `exhausted` run has a terminal report and may have a correct attempt commit, but it
has no capsule proving that execute completed, decoded and stopped before verification. An OMP format failure has a
diagnostic (`execute-format-failure.json`) and no `ExecutionResult`; its final cannot be reinterpreted as success. A
diff, a ref or a task-result display manifest is not that proof.

## Producer: a named source kind, captured at the only trustworthy moment

ccloop writes, before workspace cleanup and only when all of these hold, an immutable
`ccloop-execution-complete-before-verification-v1` capsule:

- the provider process finished normally (exit 0, no signal, no timeout, no output truncation, no tool-rule violation);
- exactly one plan and one execute call, one unique terminal execute object, and the shared strict decoder produced an
  `ExecutionResult`;
- the execute phase's usage events are durable and reconciled, or explicitly recorded as unknown with a lower bound;
- `verifierEntered:false` is a recorded fact (not inferred from a missing `verify.json`);
- the published attempt ref, base and commit identity are known, and the attempt tree is captured with the same
  completeness rules as the existing capsule (tracked, modes, deletions, protected inputs);
- the run's terminal outcome is `exhausted` **because of a budget gate after execute**, not because execute itself timed
  out or was aborted.

The capsule binds run/attempt/contract/envelope/decoder version, report and stop proof, usage high water, the attempt
commit and its base. It is content-addressed and is referenced from collect as optional evidence. It never rewrites the
original `exhausted` outcome.

Refused inputs: execute timeout with no adapter result, aborted process, non-zero exit, partial stream, duplicate
execution objects, budget exhaustion inside execute before a result exists, and any provider whose decoder cannot produce
a strict `ExecutionResult` (current OMP bad finals stay unavailable).

## Consumer: one new authority kind, the existing gates

Orca may offer `verify-saved-result` from an exhausted source only when ccloop answers the new authority kind and the
existing admission passes unchanged: current task membership, exact envelope/config/contract, known accounting with a
valid settlement receipt, fresh funded verification, verifier entry fence, candidate-modification guards, and the
original failure kept visible. The source keeps `analytical outcome=exhausted`; only the new run is a verification run.
No Orca-side reinterpretation of ccloop bytes, no state-only migration, and no `legacy-ref-missing` exemption.

OMP format failures remain unavailable until a provider-specific producer can prove a unique strict result. If the
final is genuinely decodable, the normal adapter would already have accepted it; otherwise a new trusted result-forming
action (another model output or an explicit human ruling) is required, not an inference from the diff.

## Orca-side visibility now

Until the producer exists, `run eligibility` should name the real reason instead of the generic stale answer:
`exhausted` when the source ended exhausted, and the provider's format-failure reason when the adapter recorded one.
`recovery list` points to `task retry --work` (or `close-run` when no retry is funded). This is honest reporting, not
recovery.

## Acceptance

- Producer unit and integration criteria cover every refusal above and one positive capture.
- A paired Orca/ccloop test starts from an exhausted run, verifies **zero** plan/execute provider calls in the recovery
  run, runs the real checks and verifier once, and preserves the original failure.
- Mutations independently delete: the verifier-entry fence, the unique-decode requirement, the sealed process proof, the
  usage/report identity checks and the funded-grant check. Each is seen RED.
- Legacy and OMP format-failure sources keep their current precise refusals; no test fixture is retagged to manufacture
  authority.
