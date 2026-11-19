# Re-split an accepted requirement as a new group (tester #379)

**Written by:** a subagent (Claude Opus 5.5) of Orca session `3ba26002`, 2026-11-19, against `main` at `b3fd67a5`
(`/usr/bin/git -C /Users/biran/code/skills/orca/Orca rev-parse --short main`). Built on `feat/resplit-379`.
**Ruling:** the human's 「同意」 (session `3ba26002`, 2026-11-19) to the controller's proposal: "split the same clarified
requirement again as a NEW group; archive the old group automatically; do not touch the in-place rollback".
**Sources:** `orca_archived_files/issue-20261023.md` "Issue 379"; spec 2026-10-02 requirement-to-split, Correction
"tester #379, #380" item 2 (why an accepted split is not reopened in place).

## 1. Problem and scope

After `requirement accept` and before `group confirm`, the person sees the split is wrong (the tester's two independent
modules came out serialised). Every draft edit is refused `requirement-already-accepted:draft-edits-closed:<n>`, and
reopening the accepted group is unsafe (accept froze and queued the document's export, imported the tasks and queued
their estimate). The only routes left were the plan library (repository projects only) or a new requirement -- which
throws away the clarification the person already paid for.

In scope: one command that copies the clarified requirement into a **new** clarifying group whose first step is a new
split call, and archives the old group, in one transaction. Out of scope: reopening in place; a Web control (§8).

## 2. The command

```
orca requirement resplit <group> --feedback "<what was wrong with the split>" [--group <new>]
```

Control verb `requirement-resplit`, route `POST /api/control/groups/:groupId/requirement/resplit`, target the old group,
payload `{ newGroupId, feedback }` (the CLI fills `newGroupId` from `--group`, else `g-<8 hex>` as `requirement open`
does). `feedback` is required, bounded as `requirement-draft-feedback`'s: without it the new split call sees the same
document and the same overview as the accepted one and has no reason to differ, so it would be a paid call for the same
split. Result `{ kind: "requirement-resplit", groupId, newGroupId, draftNo, wakeId }`. Any principal (as the other
requirement verbs).

## 3. Which old groups qualify (conservative)

Only a requirement group whose split was accepted and whose proposal is **not confirmed** (`requirement.acceptedDraftNo`
set and group `status: "draft"`). Refusals, each changing nothing:

| state | code | next |
| --- | --- | --- |
| still clarifying, or no requirement block | `requirement-not-accepted` (new, 422) | a draft under review takes `orca requirement feedback` |
| confirmed (any status but `draft`) | `proposal-confirmed` (existing), detail `resplit:<status>` | archive it and open a new requirement |
| anything archive refuses (estimate running, active run, stop settling, integration resolving, flow child) | archive's own code | as archive names it |
| new id taken | `group-already-exists` | another `--group` |
| old group archived / closed | `group-archived` / `group-closed` (ledger gate) | -- |

Why not also "confirmed but never started": confirm freezes the execution snapshot and may arm a start (the auto-start
pass, orchestration `mode: run`); "never started" is a predicate the driver can falsify between the person's read and
the command, and a started group has spend and possibly landed work that a copy would silently leave behind. The
tester's issue and the ruling both name "before confirm". Widening later is additive.

## 4. Copied vs regenerated

**Copied verbatim** (everything the clarify phase produced and the split read):
- every clarify round row (`requirement_rounds`, step `clarify`, execution 1), revisions included, with their call
  history (the call records name runs of the old group; they are history, no usage is recomputed from them);
- every draft row; the accepted draft is copied as `rejected` with the person's `feedback`, so the new split prompt's
  revision block carries that draft's tasks and the feedback (the same path `requirement feedback` takes);
- from the requirement block: `repoId`, `idea`, `contentLanguage`, `slug`, `title`, `profile`, `agentSlot`,
  `maxOutputTokens`, `consensus`, `classOverride`, `roundsGranted`, `consensusWithdrawn`;
- from the group body: the `estimator` agent override, `dirWorkspace`, `multiDir` (with `landing` back to `null`:
  delivery is frozen again at the new group's accept).

**The limit** is not copied: after accept the old group's `limit` is the plan group's (the import raised it), not the
requirement's, and the requirement's own limit is not kept anywhere. The new group gets `REQUIREMENT_LIMIT_DEFAULT`, what
`requirement open` gives without `--limit`; `orca group set-limit <new>` changes it while it clarifies.

**Regenerated:** `requirementId` (from the new group id and the command id, as open derives it), `createdOn` (today),
`acceptedDraftNo`/`document` (null), `export` (`not-due`), the clarifying ledger (nothing used), the token policy (as
`insertClarifyingGroup` writes it for the default limit). The next draft (`n + 1`, `drafting`) and its split call wake. This is one model
call, paid by the new group.

**Not copied:** the old group's spend (stays booked on the archived group), its plan, tasks, proposal, estimates, frozen
document and export. If the old export already ran, its document stays committed; the new group's accept exports its
own (the path takes a numeric suffix when the name is taken).

**Agent slot:** the frozen slot is copied unchanged (no probe, so the command is synchronous); `orca requirement set-agent
<new>` changes it on the new clarifying group.

**Project kinds:** repository, folder (`dirWorkspace`) and multi-directory (`multiDir`) groups all qualify; the frozen
folder/member list is copied (a vault is keyed by folder, not by group). The project is not re-checked, as accept does not.

## 5. Archive and the link both ways

In the same transaction the old group is checked with archive-group's refusals and then marked exactly as archive-group
marks it (`archived: { at, actor }`, an `archived` activity row). The old requirement block gains
`resplitAs: { groupId, at }`; the new one `resplitOf: { groupId, draftNo }`. `requirement show` carries both (the view's
`requirement` object). The new group gets a `command` activity row for `requirement-resplit` so its "drafting since"
reads as it does after `requirement feedback`. Unarchiving the old group later works as any unarchive (#370); it is still
a draft group, and the person archives one of the two.

## 6. The refusal that sent people elsewhere

`requirement feedback`, `apply-parallel`, `add-implied-path`, `narrow-path` and `drop-path` on an accepted group keep
their refusal (`requirement-already-accepted:draft-edits-closed:<n>`); their CLI hint and `next` now name
`orca requirement resplit <group> --feedback "<what was wrong>"` for every project kind (it replaces the plan-library and
open-and-archive routes, which remain possible but are no longer the advice).

## 7. Rule 17

No write outside the control store: the command is one store transaction. The new group's split call later goes through
the existing pump, single-call port and ledger. No new out-of-repo path.

## 8. Not built

A Web entry point: the Requirements panel would need a button with a feedback box on an accepted-not-confirmed
requirement, its en/zh strings and the panel-text scan; not cheap enough for this change. The CLI and the control API
route serve both people and agents.

## 9. Criteria (commands)

- `npx vitest run tests/control/requirementResplit.test.ts` -- copy, archive, link, the new split call's prompt, the
  new draft accepted end to end; each refusal changes nothing; dir and multi frozen fields carried.
- `npx vitest run tests/commands/requirementResplitCli.test.ts` -- the CLI payload and the refusals' `next` naming resplit.
- `npx vitest run tests/entry/skill.test.ts tests/commands/drift.test.ts tests/panel/requirementRoutes.test.ts` -- verb
  schema, generated docs and the route.

## Correction 1 (review of `afee7245`; a review subagent (Claude Opus 5.5) of Orca session `3ba26002`, 2026-11-19; the text above is kept as written)

The CLI flag is `--text`, not `--feedback` (controller ruling, Rule 11): the sibling `orca requirement feedback <group>
--text <text>` names the same "what was wrong" text that way. The payload key stays `feedback`, as that sibling's payload
(`requirement-draft-feedback`'s `{ draftNo, feedback }`) names it. So §2's command reads
`orca requirement resplit <group> --text "<what was wrong with the split>" [--group <new>]`, and §6's `next` line
`orca requirement resplit <group> --text "<what was wrong>"`.

## Correction 2 (same review; the text above is kept as written)

§3 gains a refusal. Group edges (`group_edges`, kanban spec §3.3) name groups, not requirements, and the re-split
archives the old group: a group that waits for it would wait forever (an archived group that is not done is never done;
`add-group-dependency` refuses exactly that edge, `group-edge-prerequisite-archived`), and the new group would not wait
for the old group's prerequisites. So an old group with any edge, either way, is refused
`requirement-resplit-group-edges` (409, detail `prerequisites:<ids>` and/or `dependents:<ids>`, `;`-joined), changing
nothing. The CLI's `next` lines remove each edge, re-split with `--group <new>`, and add each edge on the new group; the
hint says to pause a confirmed dependent first, since removing its edge lets it start. Edges are not re-pointed inside the
command: a re-pointed edge would skip add-group-dependency's own checks (stack ambiguity is computed against the new
group's delivery, which a clarifying group does not have yet).
