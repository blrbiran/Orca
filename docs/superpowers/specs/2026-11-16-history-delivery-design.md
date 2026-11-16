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
