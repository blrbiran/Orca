# History-specific delivery design (Orca issue #328)

Status: design boundary, 2026-11-16. The feedback's reported run and source branches are historical; no production group is modified by this document.

## User-visible failure

A requirement asked for eleven ordered, real merges of named source branches into `main` and a `MERGE-NOTES.md`. An agent reported completion after materializing the desired tree in its workspace, but the requested merge parentage was not on `main`. Mid-group `main` remaining unchanged is expected for a group-trigger scheme. Final tree equality alone cannot prove a Git-history deliverable.

## Current boundary

Orca lands each attempt as a two-parent commit on `orca/<group>`, then a group-trigger local merge makes one target merge of that branch. A task-trigger scheme makes more target merges but their second parents are group tips, not necessarily the named source tips. `squash` deliberately loses merge ancestry. `workspaceMode=worktree` and `clone` alter where the agent works; neither alone proves the requested parentage impossible. A task marked done means its work landed into the group branch, not that group-trigger delivery reached `main`.

## Product decision for literal history requirements

Interpret 'merge each named branch into main' literally: each named source tip must appear as a direct second parent of a merge on the target's first-parent history, in the requested order. Resolve source tips when each source task lands, because tasks may create them after confirmation. Freeze the names, order, target ref and acceptance rule at confirmation; never infer them later from prose or a generated summary. A task may be work-done while integration is pending, but the group must not be `done`, and dependents must not be released, until the target history and required artifact are verified. Ordinary tree-only requirements keep existing behavior.

## Proposed contract and admission

Add a versioned, optional `integration.historyExpectation` to the confirmed group: `targetRef`, ordered distinct `sourceRefs` tied to task IDs, `directSecondParent:true`, and optional `artifactPaths` (e.g. `MERGE-NOTES.md`). The preview must state that today's group-tip merge cannot satisfy the literal source-parent rule. Refuse confirmation with an actionable reason if the chosen delivery/trigger/method cannot provide the requested history; never quietly downgrade to a tree-only or group-tip merge. Only a new explicit delivery strategy that imports and verifies source commits may admit this contract. A copied tree or agent-reported SHA is not an authority.

## Acceptance and recovery

After every accepted task, verify a source ref tip belongs to the declared repository and is a commit; bind its SHA to the attempt and group version. The integration driver must create or verify the target merge using those exact tips, with a compare-and-swap target update and immutable evidence. Final acceptance checks each ordered merge's two parents along the target first-parent chain, checks the final artifact in the actual target tree, and binds both group tip and target tip to the acceptance record. A target move invalidates that record and requires reconciliation. Unresolved pending decisions affecting the history must surface as a group problem and block history acceptance; unrelated review decisions may remain pending by policy.

## Why a small preflight-only fix is insufficient

No structured history expectation exists in current split output or integration scheme. Rejecting every `worktree` + local delivery would break valid tree-only work while still failing to identify a literal history request in free text. An opt-in flag with no execution and acceptance implementation would be a dead end. Implement this as its own cross-layer project after its contract and driver tests are specified; meanwhile Orca must not claim that a tree-only group's `done` proves named source merges.

## Tests to own the implementation

- A group-trigger `merge` and a `squash` scheme with a direct-source-parent expectation are rejected before paid work; existing tree-only groups still confirm.
- A task-trigger group merge with a group tip as second parent fails the literal-history gate even if its final file tree matches.
- A direct merge of the exact frozen source tip passes; reordered tips, wrong parent, lost source ref, changed target tip, or missing `MERGE-NOTES.md` fail without marking the group done.
- A pending history decision is visible in Web and CLI; `done` and dependent starts remain blocked until the history evidence is verified.

## Correction 1 — source branch scope and split version (2026-11-17)

Version 1 requires each named source ref to exist in the registered repository when its mapped task lands. Orca binds that ref's commit SHA then, and a later ref move never silently changes the bound commit. An absent ref blocks the delivery with a named recovery path. A task agent's attempt worktree cannot be treated as a branch producer: the current ccloop contract owns Git publication, and its OMP execute prompt explicitly forbids `git branch` and `git commit`. Supporting run-created named branches requires a separate producer contract and validation; it is not implied by this version. The reported eleven-branch case used existing source branches.

Single-repository split instruction version 6 may propose the structured expectation; version 5's instruction and JSON schema remain byte-identical for already-frozen calls. The proposal is visible before confirmation and becomes active only when the integration scheme hash is explicitly approved. History source tasks declare dependency edges in the requested merge order even if their file write sets are disjoint. An ordinary split or a group without a history expectation keeps the prior tree-only integration path.

## Correction 2 — source-object retention (2026-11-17)

When the driver observes an existing source ref before landing its mapped task, Orca writes one private retention ref `refs/orca/history/<sha256(groupId,taskId,runId)>` in the registered target repository, pointing at the observed commit. This happens before moving the group branch and is an Orca controller write, not an agent operation. A missing source writes no ref and blocks step D; a crash after pinning can leave the retention ref even if the task never lands, and a different commit at that pin name blocks rather than replacing it. The run drive record stages the observation before the group-branch CAS, and the group's integration record copies it with the landing so crash replay uses the pinned commit. Tests redirect the repository to an isolated fixture. Cleanup of unused retention refs is a later explicit policy; no age-based deletion is part of version 1.

## Correction 3 — no-change and reviewed task completion (2026-11-17)

A mapped source task can finish without a file change when its authored checks or agent verifier decide the goal, or a later goal judge or person explicitly accepts no change. In those paths Orca observes and pins the registered source ref before the task is marked done, stores the group tip after the run's own ledger-only commit, and binds the source with `noChange:true` in the same transaction as the no-change completion. That tip is provenance for the completed task, not a claim that its worktree authored a merge. An owner-accepted completed attempt takes the same source observation before its group-branch CAS and binds it with the acceptance. A missing source is a named refusal; no form of result or judge text can invent the commit SHA. History acceptance still requires an actual target merge with the source SHA as its direct second parent.

## Correction 4 — reopened source and later group tips (2026-11-17)

Retention refs are per run, so a legitimate re-run can observe a newer source tip without overwriting the earlier run's pinned object. Reopening a completed no-change source task withdraws its active binding in the same transaction as the task's accepted proof, keeps the old binding and withdrawal in `historyWithdrawnBindings`, and lets the next run bind afresh; integration and final acceptance use only active bindings. Once a named-source target merge has been published, reopening that source requires an explicit history reconciliation rather than silently replacing an already delivered parent. An already landed E-block has its original group-branch landing bound during D; if a later sibling advanced the group tip, operator acceptance reuses the original landing SHA rather than presenting the later tip as a new source landing. All of these operations preserve historical evidence and never force a target ref backward.

## Correction 5 — atomic target publication (2026-11-17)

Orca constructs all ordered named-source merge commits in the registered repository's Git object store, followed by one optional single-parent commit carrying the group tree's remaining files. No target ref is moved until this complete chain and the artifact tree are checked. One write-ahead record binds the frozen source SHAs, source merge SHAs, group tip, target base and final commit; one compare-and-swap publishes the final commit. Crash recovery verifies that same chain from the target ref before settling, never publishes a partial prefix. A target that moved before the CAS causes a bounded recomputation from its new tip; a target that moved after publication invalidates history acceptance and requires reconciliation. A conflicting source or group-tree application blocks with the exact source/path and leaves the target ref untouched; the operator can make the target conflict-free and retry without rebinding frozen sources. Ordinary local merge/squash uses its existing path. This is an implementation choice over the earlier per-source publication proposal: it gives the requested direct parent chain with fewer externally visible half states.

## Correction 6 — Git object authority and pending retention (2026-11-17)

A source SHA identical to the current target tip cannot become a distinct second parent: Git removes duplicate parents. Orca blocks that case by name before publication. A source already reachable as a different ancestor can still be named as a real second parent. Constructing merge trees, choosing merge bases, creating commits, and verifying trees and raw parent headers all ignore Git replacement objects (`--no-replace-objects`), so an operator's `refs/replace/*` cannot substitute another source tree while the commit records the frozen SHA. If publication completed but a pending history record is corrupt or a target moved, the controller retains that pending evidence and blocks; `retry-integration` cannot clear it and accidentally append the chain again. An explicit reconciliation must verify the target before advancing.

## Correction 7 — done requires a current proof (2026-11-17)

The controller records a canonical history acceptance evidence object only after re-reading the actual target first-parent chain, exact parents, source bindings, artifact blobs and absence of unresolved decisions. `prerequisiteDone` and the done pass do not treat tree-only group acceptance or a system verdict as proof. Before each done pass the controller re-observes the target and group branch: a target or group tip that moved removes the proof and returns a previously done group to `review`, so its dependents stop being released; an append-only target advance can be explicitly reconciled by recording a new target on the frozen chain, while any rewrite of a published source merge or a divergent target requires human repair. When a source task is reopened before publication, its binding is archived with the withdrawal and replaced by the next run's binding; after publication, reopening is refused until the history is explicitly reconciled.
