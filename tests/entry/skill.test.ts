import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  confirmPayloadSchema, continueTaskPayloadSchema, emptyPayloadSchema, handoffStopPayloadSchema, importPlanPayloadSchema, proposalEditPayloadSchema,
  proposalSetAgentPayloadSchema, recoveryRetryPayloadSchema, retryTaskPayloadSchema, reestimatePayloadSchema, requirementAnswerPayloadSchema, requirementConsensusPayloadSchema,
  requirementDraftAcceptPayloadSchema, requirementDraftFeedbackPayloadSchema, requirementOpenPayloadSchema, resumeFromHandoffPayloadSchema,
  setAgentPreferencesPayloadSchema, setLimitPayloadSchema, setTaskLabelsPayloadSchema, setTaskLoopPayloadSchema, setWorkspaceModePayloadSchema,
  setSpendCapPayloadSchema, clearSpendCapPayloadSchema, setUsageCalendarPayloadSchema, setIntegrationSchemePayloadSchema, setGroupIntegrationPayloadSchema,
} from "../../src/control/webProtocol.js";

const skill = readFileSync("skills/orca-control/SKILL.md", "utf8");
const api = readFileSync("src/panel/controlApi.ts", "utf8");

const rows = [...skill.matchAll(/^\| `POST ([^`]+)` \| ([a-z-]+) \| `([^`]*)` \|/gm)].map((m) => ({ route: m[1]!, verb: m[2]!, payload: m[3]! }));

// Spec §7.5: each route's raw payload schema (the one validator; the panel's refinements that need live state are not statically checkable).
const schemaByVerb: Record<string, ZodTypeAny> = {
  "import-plan": importPlanPayloadSchema, "proposal-edit": proposalEditPayloadSchema, estimate: reestimatePayloadSchema, confirm: confirmPayloadSchema,
  "set-limit": setLimitPayloadSchema, start: emptyPayloadSchema, "pause-dispatch": emptyPayloadSchema, "handoff-stop": handoffStopPayloadSchema,
  "resume-dispatch": emptyPayloadSchema, "resume-from-handoff": resumeFromHandoffPayloadSchema, "continue-task": continueTaskPayloadSchema,
  "recovery-retry": recoveryRetryPayloadSchema, "retry-task": retryTaskPayloadSchema, "set-workspace-mode": setWorkspaceModePayloadSchema, "set-agent-preferences": setAgentPreferencesPayloadSchema,
  "proposal-set-agent": proposalSetAgentPayloadSchema, "requirement-open": requirementOpenPayloadSchema, "requirement-answer": requirementAnswerPayloadSchema,
  "requirement-consensus": requirementConsensusPayloadSchema, "requirement-draft-feedback": requirementDraftFeedbackPayloadSchema,
  "requirement-draft-accept": requirementDraftAcceptPayloadSchema, "set-task-labels": setTaskLabelsPayloadSchema, "set-task-loop": setTaskLoopPayloadSchema,
  "set-spend-cap": setSpendCapPayloadSchema, "clear-spend-cap": clearSpendCapPayloadSchema, "set-usage-calendar": setUsageCalendarPayloadSchema,
  "set-integration-scheme": setIntegrationSchemePayloadSchema, "set-group-integration": setGroupIntegrationPayloadSchema,
  "retry-integration": emptyPayloadSchema,
  "resolve-integration-conflict": emptyPayloadSchema,
  "archive-group": emptyPayloadSchema, "unarchive-group": emptyPayloadSchema,
};

describe("the orca-control skill (spec §7, C18)", () => {
  it("has frontmatter naming it", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: orca-control$/m);
    expect(front).toMatch(/^description: .{20,}$/m);
  });

  it("lists exactly the panel's mutation routes, so the table cannot drift", () => {
    const routes = new Set([...api.matchAll(/path: "\/api\/control\/([^"]+)"/g)].map((m) => m[1]!.replace(/:([A-Za-z]+)/g, "<$1>")));
    // 32 routes carry the 33 verbs: `shutdown` has no route (the panel's own lifecycle). Integration spec §3.4 added
    // `repositories/<repoId>/integration` (set-integration-scheme), `groups/<groupId>/integration` (set-group-integration)
    // and `groups/<groupId>/integration/retry` (retry-integration); §7 added `groups/<groupId>/integration/resolve`
    // (resolve-integration-conflict). Issue fixes spec §4.2(2) added `groups/<groupId>/retry-task` (retry-task).
    // Issue-fixes spec §6.3 added groups/<groupId>/archive and groups/<groupId>/unarchive.
    expect(routes.size).toBe(32);
    expect(rows.map((row) => row.route).sort()).toEqual([...routes].sort());
  });

  it("names the verb of every route as the panel does", () => {
    const verbs = new Map([...api.matchAll(/path: "\/api\/control\/([^"]+)",?\s+verb: "([^"]+)"/g)].map((m) => [m[1]!.replace(/:([A-Za-z]+)/g, "<$1>"), m[2]!]));
    expect(verbs.size).toBe(32);
    expect(new Map(rows.map((row) => [row.route, row.verb]))).toEqual(verbs);
  });

  // Task 7 (deferred Task 2 minor): the requirement rows read as one run, not split by an integration row.
  it("keeps the requirement rows together", () => {
    const at = rows.flatMap((row, index) => (row.route.includes("requirement") ? [index] : []));
    expect(at.length).toBe(5);
    expect(at.at(-1)! - at[0]!).toBe(at.length - 1);
  });

  it("gives every route a payload example that its raw payload schema accepts", () => {
    expect(rows.length).toBe(32);
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
      "`.plans[].planId`", "`.operatorId`", "same `--command-id`",
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
    ]) expect(skill).toContain(phrase);
    for (const code of ["`0`", "`1`", "`2`", "`3`"]) expect(skill).toContain(code);
  });
});
