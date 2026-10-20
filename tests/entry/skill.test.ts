import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";
import {
  confirmPayloadSchema, continueTaskPayloadSchema, emptyPayloadSchema, handoffStopPayloadSchema, importPlanPayloadSchema, proposalEditPayloadSchema,
  proposalSetAgentPayloadSchema, recoveryRetryPayloadSchema, retryTaskPayloadSchema, settleUnknownUsagePayloadSchema, reestimatePayloadSchema, requirementAnswerPayloadSchema, requirementConsensusPayloadSchema,
  requirementDraftAcceptPayloadSchema, requirementDraftFeedbackPayloadSchema, requirementOpenPayloadSchema, resumeFromHandoffPayloadSchema,
  setAgentPreferencesPayloadSchema, setLimitPayloadSchema, setTaskLabelsPayloadSchema, setTaskLoopPayloadSchema, setWorkspaceModePayloadSchema,
  setSpendCapPayloadSchema, clearSpendCapPayloadSchema, setUsageCalendarPayloadSchema, setIntegrationSchemePayloadSchema, setGroupIntegrationPayloadSchema, setIntegrationCheckPayloadSchema,
  verifySavedResultPayloadSchema, approvePendingDecisionPayloadSchema, rejectPendingDecisionPayloadSchema, ratifyFlaggedDecisionPayloadSchema, setOrchestrationSettingsPayloadSchema, groupDependencyPayloadSchema, correctionDebugOpenPayloadSchema,
  correctionRecordPayloadSchema, correctionClosePayloadSchema, correctionWithdrawPayloadSchema,
} from "../../src/control/webProtocol.js";

const skill = readFileSync("skills/orca-control/SKILL.md", "utf8");
const api = readFileSync("src/panel/controlApi.ts", "utf8");

const rows = [...skill.matchAll(/^\| `POST ([^`]+)` \| ([a-z-]+) \| `([^`]*)` \|/gm)].map((m) => ({ route: m[1]!, verb: m[2]!, payload: m[3]! }));
const panelRoutes = new Map([...api.matchAll(/path:\s*"\/api\/control\/([^"]+)",\s*verb:\s*"([^"]+)"/g)]
  .map((m) => [m[1]!.replace(/:([A-Za-z]+)/g, "<$1>"), m[2]!] as const));
const ownerOnlyUnlistedRoute = { route: "operator/apply-agent-update", verb: "apply-agent-update" } as const;
const documentedRoutes = new Map([...panelRoutes].filter(([route]) => route !== ownerOnlyUnlistedRoute.route));

// Spec §7.5: each route's raw payload schema (the one validator; the panel's refinements that need live state are not statically checkable).
const schemaByVerb: Record<string, ZodTypeAny> = {
  "import-plan": importPlanPayloadSchema, "proposal-edit": proposalEditPayloadSchema, estimate: reestimatePayloadSchema, confirm: confirmPayloadSchema,
  "set-limit": setLimitPayloadSchema, start: emptyPayloadSchema, "pause-dispatch": emptyPayloadSchema, "handoff-stop": handoffStopPayloadSchema,
  "resume-dispatch": emptyPayloadSchema, "resume-from-handoff": resumeFromHandoffPayloadSchema, "continue-task": continueTaskPayloadSchema,
  "recovery-retry": recoveryRetryPayloadSchema, "retry-task": retryTaskPayloadSchema, "settle-unknown-usage": settleUnknownUsagePayloadSchema, "set-workspace-mode": setWorkspaceModePayloadSchema, "set-agent-preferences": setAgentPreferencesPayloadSchema,
  "proposal-set-agent": proposalSetAgentPayloadSchema, "requirement-open": requirementOpenPayloadSchema, "requirement-answer": requirementAnswerPayloadSchema,
  "requirement-consensus": requirementConsensusPayloadSchema, "requirement-draft-feedback": requirementDraftFeedbackPayloadSchema,
  "requirement-draft-accept": requirementDraftAcceptPayloadSchema, "set-task-labels": setTaskLabelsPayloadSchema, "set-task-loop": setTaskLoopPayloadSchema,
  "set-spend-cap": setSpendCapPayloadSchema, "clear-spend-cap": clearSpendCapPayloadSchema, "set-usage-calendar": setUsageCalendarPayloadSchema,
  "set-integration-scheme": setIntegrationSchemePayloadSchema, "set-group-integration": setGroupIntegrationPayloadSchema,
  "set-integration-check": setIntegrationCheckPayloadSchema,
  "retry-integration": emptyPayloadSchema,
  "resolve-integration-conflict": emptyPayloadSchema,
  "archive-group": emptyPayloadSchema, "unarchive-group": emptyPayloadSchema,
  "verify-saved-result": verifySavedResultPayloadSchema,
  "approve-pending-decision": approvePendingDecisionPayloadSchema,
  "reject-pending-decision": rejectPendingDecisionPayloadSchema,
  "ratify-flagged-decision": ratifyFlaggedDecisionPayloadSchema,
  "set-orchestration-settings": setOrchestrationSettingsPayloadSchema,
  "add-group-dependency": groupDependencyPayloadSchema, "remove-group-dependency": groupDependencyPayloadSchema,
  "correction-debug-open": correctionDebugOpenPayloadSchema,
  "correction-record": correctionRecordPayloadSchema, "correction-close": correctionClosePayloadSchema, "correction-withdraw": correctionWithdrawPayloadSchema,
};

describe("the orca-control skill (spec §7, C18)", () => {
  it("has frontmatter naming it", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: orca-control$/m);
    expect(front).toMatch(/^description: .{20,}$/m);
  });

  it("lists exactly the documented panel mutation routes, including saved-result verification", () => {
    expect(panelRoutes.get(ownerOnlyUnlistedRoute.route)).toBe(ownerOnlyUnlistedRoute.verb);
    expect(VERB_ACCESS[ownerOnlyUnlistedRoute.verb]).toBe("human-only");
    expect(panelRoutes.get("groups/<groupId>/tasks/<taskId>/verify-saved-result")).toBe("verify-saved-result");
    expect(VERB_ACCESS["verify-saved-result"]).toBe("any");
    expect(rows.some((row) => row.route === ownerOnlyUnlistedRoute.route)).toBe(false);
    expect(rows.map((row) => row.route).sort()).toEqual([...documentedRoutes.keys()].sort());
  });

  it("names the verb of every route as the panel does", () => {
    expect(new Map(rows.map((row) => [row.route, row.verb]))).toEqual(documentedRoutes);
  });

  // Task 7 (deferred Task 2 minor): the requirement rows read as one run, not split by an integration row.
  it("keeps the requirement rows together", () => {
    const at = rows.flatMap((row, index) => (row.route.includes("requirement") ? [index] : []));
    expect(at.length).toBe(5);
    expect(at.at(-1)! - at[0]!).toBe(at.length - 1);
  });

  it("gives every route a payload example that its raw payload schema accepts", () => {
    expect(rows.length).toBe(documentedRoutes.size);
    for (const row of rows) {
      const schema = schemaByVerb[row.verb];
      expect(schema, `no schema mapped for ${row.verb}`).toBeDefined();
      const parsed = schema!.safeParse(JSON.parse(row.payload));
      expect(parsed.success, `${row.route}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it("teaches the rules, the exit codes and the error codes", () => {
    for (const phrase of [
      "--expected-revision", "--command-id", "panel-not-running", "control-verb-human-only", "control-field-human-only", "revision-conflict",
      "control-socket-timeout", "orca-cli-response-v1", "never start a panel", "@repository:", "@operator:",
      // Final review I1-I3: the transport code, the policy sentence, and where each revision and id comes from.
      "control-socket-error", "is a boundary at the panel's interfaces", "Where the expected revision comes from", ".summary.commandRevision",
      "`.revision` of `get repositories/<repoId>/workspace`", "`.revision` of `get operator/agent-preferences`", "`.repositories[].repoId`",
      "`.plans[].planId`", "`.operatorId`", "**Look up the retained result first**",
      "A lookup miss does not prove the command never ran.", "uses the **same** command id, route, payload and expected revision",
      // Accounts spec §8: the usage read, the owner-only cap verbs, and the two cap codes an agent meets.
      "get usage", "owner-only", "control-limit-over-cap-headroom", "spend-cap-reached",
      // Final review Minor 1: both verbs the agent ceiling can refuse (spec §6.3.2), not only import-plan.
      "`import-plan` or `requirement-draft-accept` whose group limit would exceed the spend-cap headroom",
      // Integration spec §3.4: the owner-only confirm of a non-keep group, and where the setter's revision comes from.
      "Confirming a group whose integration is not `keep` is owner-only (the `integrationHash` field is human-only).",
      "`.revision` of `get repositories/<repoId>/integration`",
      // Task 7: the integration read is listed with the other reads.
      "`repositories/<id>/workspace`, `repositories/<id>/integration`",
      // Issue fixes spec §4.2(2)-(3): which retry a failed run takes.
      "run-terminal-failed", "task-not-retryable",
      // Issue-fixes spec §6.3: what archiving does to every other command, and the guards an agent meets.
      "refuses every command but `unarchive-group` with `group-archived`", "archive-run-active", "archive-call-in-flight",
      "still `handoff-pending` or `handoff-unresolved`; `handoff-complete` and `handoff-partial` allow archive; a pause never blocks",
      // Control run decisions final review m1: the agent's read of a group's decisions (goal.md §1.2).
      "`groups/<id>/decisions`", "orca control get groups/<groupId>/decisions",
    ]) expect(skill).toContain(phrase);
    for (const code of ["`0`", "`1`", "`2`", "`3`"]) expect(skill).toContain(code);
  });

  // Start guard spec (2026-10-15) §3.2: an agent is told the server refuses a second start, by name.
  it("names group-execution-pending as the refusal of a second start, and no longer says the server accepts one", () => {
    expect(skill).toContain("`group-execution-pending`");
    expect(skill).not.toContain("the server still accepts a second start");
  });
});
