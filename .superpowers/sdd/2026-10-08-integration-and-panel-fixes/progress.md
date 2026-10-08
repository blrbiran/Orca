# Integration schemes and panel fixes — progress ledger

Session eaee0f2c (2026-10-08). Branch `feat/integration-schemes`, stacked on `deps/usage-by-model-pin`
(subjects `chore(deps): repin ccloop to report usage per model`, `fix(auth): end every session of the user on a password change, this one too`).
Spec: `docs/superpowers/specs/2026-10-08-integration-and-panel-fixes-design.md`. Plan: `docs/superpowers/plans/2026-10-08-integration-and-panel-fixes.md`.
Authority: the human authorized the whole round on 2026-10-08 ("先按你的建议执行（不要再找我）… 最后阶段报给我审核"),
including subagent review of the spec and subagent-driven execution. Append only.

## Human decisions (conversation, 2026-10-08)
- H1–H6 as in spec §2.
- Password change: a successful change ends every session of the user, this one too; a wrong password ends none and only
  counts toward the per-name throttle (kept). Implemented on `deps/usage-by-model-pin` (subject above).

## Spec review (independent subagent, 2026-10-08)
2 Critical (C1 squash/rebase resolution shape; C2 run-shaped reconciliation), 13 Important, 15 Minor.
Ruling: R1–R8 in spec §12; every other finding adopted. Spec revised in subject `docs(spec): revise the integration design after an independent review`.

## Tasks
