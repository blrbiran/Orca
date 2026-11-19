import { recordActivity } from "./activity.js";
import { readGroupAgentOverrides } from "./agentFreeze.js";
import type { AdmissionGate } from "./admissionGate.js";
import { refuseArchive } from "./archiveGroup.js";
import { sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand, updateRevision } from "./commandLedger.js";
import { dirWorkspaceOf } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { dependentsOf, prerequisitesOf } from "./groupEdges.js";
import { multiDirOf } from "./multiGroup.js";
import {
  hasRequirementBlock, insertClarifyingGroup, newDraft, queueRequirementCall, readDrafts, readRequirementGroup, readRounds, saveRequirementGroup, writeDraft, writeRound,
} from "./requirementRecords.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "./requirementSchemas.js";
import { commandSuccess } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandLookupV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type RequirementResplitCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-resplit" }>;
type Result = CommandLookupV1["body"];
export interface RequirementResplitDeps { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date }

/**
 * Tester #379 (spec 2026-11-19 resplit-as-new-group; human 「同意」, session 3ba26002): an accepted split found wrong before
 * confirm is split again as a NEW group -- never reopened in place (accept froze and queued the document's export,
 * imported the tasks and queued their estimate). One transaction: the clarified requirement (every clarify round, every
 * draft, the requirement block's clarification) is copied into a new clarifying group, the accepted draft copied as
 * `rejected` with the person's feedback, the next draft queued as a split call; the old group is archived with
 * archive-group's refusals and mark; each group names the other (`resplitOf` / `resplitAs`).
 */
export function applyRequirementResplit(deps: RequirementResplitDeps, command: RequirementResplitCommand): Result {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<Result>(deps.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const store = deps.store, oldId = command.target.groupId, { newGroupId, feedback } = command.payload;
        const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(oldId);
        if (!row) throw new ControlError("group-not-found");
        const oldBody = JSON.parse(String(row.body)) as Record<string, unknown>;
        // §3: only a split accepted and not confirmed (a confirmed group may start at any time; a started one has spend
        // and possibly landed work a copy would leave behind).
        if (!hasRequirementBlock(oldBody)) throw new ControlError("requirement-not-accepted", "no-requirement");
        const old = readRequirementGroup(store, oldId);
        const acceptedDraftNo = old.requirement.acceptedDraftNo;
        if (acceptedDraftNo === null) throw new ControlError("requirement-not-accepted", old.status);
        if (old.status !== "draft") throw new ControlError("proposal-confirmed", `resplit:${old.status}`);
        refuseArchive(store, oldId, oldBody);
        // #379 review (I1): group edges name groups, not requirements. Re-split, a dependent would wait for the archived
        // group forever (never done; add-group-dependency refuses that very edge, group-edge-prerequisite-archived) and the
        // new group would not wait for the old one's prerequisites. Refused by name; the person moves the edges (the CLI's
        // next lines) -- never silently re-pointed here.
        const prerequisites = prerequisitesOf(store, oldId), dependents = dependentsOf(store, oldId);
        if (prerequisites.length > 0 || dependents.length > 0) {
          throw new ControlError("requirement-resplit-group-edges", [prerequisites.length === 0 ? null : `prerequisites:${prerequisites.join(",")}`,
            dependents.length === 0 ? null : `dependents:${dependents.join(",")}`].filter((part) => part !== null).join(";"));
        }
        if (store.db.prepare("SELECT id FROM groups WHERE id=?").get(newGroupId)) throw new ControlError("group-already-exists");
        const now = (deps.now ?? (() => new Date()))(), at = now.toISOString();
        // §4: copied verbatim, or regenerated as requirement-open would; the limit is open's default (§4 "The limit").
        const multi = multiDirOf(oldBody), dir = dirWorkspaceOf(oldBody), estimator = readGroupAgentOverrides(oldBody).estimator;
        insertClarifyingGroup(store, {
          groupId: newGroupId, repoId: old.requirement.repoId, idea: old.requirement.idea, limit: { ...REQUIREMENT_LIMIT_DEFAULT },
          contentLanguage: old.requirement.contentLanguage, createdOn: at.slice(0, 10),
          requirementId: sha256Canonical({ groupId: newGroupId, commandId: command.commandId }).slice(0, 32),
          profile: old.requirement.profile, agentSlot: old.requirement.agentSlot, maxOutputTokens: old.requirement.maxOutputTokens,
          agentOverrides: estimator === undefined ? {} : { estimator },
          ...(dir === null ? {} : { dirWorkspace: dir }),
          ...(multi === null ? {} : { multiDir: { ...multi, landing: null } }),
        });
        // The new group starts at revision 1, as requirement-open leaves its group (open's ledger scope is the new group).
        updateRevision(store, newGroupId, 1);
        const fresh = readRequirementGroup(store, newGroupId);
        const { requirementId: _id, createdOn: _on, acceptedDraftNo: _no, document: _doc, export: _export, resplitAs: _as, ...clarified } = old.requirement;
        fresh.requirement = { ...fresh.requirement, ...clarified, resplitOf: { groupId: oldId, draftNo: acceptedDraftNo } };
        saveRequirementGroup(store, fresh);
        for (const round of readRounds(store, oldId)) writeRound(store, newGroupId, round);
        const drafts = readDrafts(store, oldId);
        for (const draft of drafts) writeDraft(store, newGroupId, draft.draftNo === acceptedDraftNo ? { ...draft, state: "rejected", feedback } : draft);
        const draftNo = drafts.at(-1)!.draftNo + 1;
        writeDraft(store, newGroupId, newDraft(draftNo, 0));
        const wakeId = queueRequirementCall(store, newGroupId, `resplit-${oldId}-${context.nextCommandRevision}`);
        // The new group's "drafting since" reads its latest drafting command, as after requirement feedback.
        recordActivity(store, { groupId: newGroupId, kind: "command", body: { verb: command.verb, actor: command.actorId, resplitOf: oldId } });
        // §5: archived as archive-group archives (the refusals above are its own), linked to the new group.
        const archived = readRequirementGroup(store, oldId);
        archived.requirement = { ...archived.requirement, resplitAs: { groupId: newGroupId, at } };
        archived.archived = { at: store.now(), actor: command.actorId };
        saveRequirementGroup(store, archived);
        recordActivity(store, { groupId: oldId, kind: "archived", body: { resplitAs: newGroupId } });
        return commandSuccess(context, { kind: "requirement-resplit", groupId: oldId, newGroupId, draftNo, wakeId });
      },
    }).body;
  } finally { release?.(); }
}
