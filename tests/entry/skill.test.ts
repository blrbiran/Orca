import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  confirmPayloadSchema, continueTaskPayloadSchema, emptyPayloadSchema, handoffStopPayloadSchema, importPlanPayloadSchema, proposalEditPayloadSchema,
  proposalSetAgentPayloadSchema, recoveryRetryPayloadSchema, reestimatePayloadSchema, requirementAnswerPayloadSchema, requirementConsensusPayloadSchema,
  requirementDraftAcceptPayloadSchema, requirementDraftFeedbackPayloadSchema, requirementOpenPayloadSchema, resumeFromHandoffPayloadSchema,
  setAgentPreferencesPayloadSchema, setLimitPayloadSchema, setTaskLabelsPayloadSchema, setTaskLoopPayloadSchema, setWorkspaceModePayloadSchema,
} from "../../src/control/webProtocol.js";

const skill = readFileSync("skills/orca-control/SKILL.md", "utf8");
const api = readFileSync("src/panel/controlApi.ts", "utf8");

const rows = [...skill.matchAll(/^\| `POST ([^`]+)` \| ([a-z-]+) \| `([^`]*)` \|/gm)].map((m) => ({ route: m[1]!, verb: m[2]!, payload: m[3]! }));

// Spec §7.5: each route's raw payload schema (the one validator; the panel's refinements that need live state are not statically checkable).
const schemaByVerb: Record<string, ZodTypeAny> = {
  "import-plan": importPlanPayloadSchema, "proposal-edit": proposalEditPayloadSchema, estimate: reestimatePayloadSchema, confirm: confirmPayloadSchema,
  "set-limit": setLimitPayloadSchema, start: emptyPayloadSchema, "pause-dispatch": emptyPayloadSchema, "handoff-stop": handoffStopPayloadSchema,
  "resume-dispatch": emptyPayloadSchema, "resume-from-handoff": resumeFromHandoffPayloadSchema, "continue-task": continueTaskPayloadSchema,
  "recovery-retry": recoveryRetryPayloadSchema, "set-workspace-mode": setWorkspaceModePayloadSchema, "set-agent-preferences": setAgentPreferencesPayloadSchema,
  "proposal-set-agent": proposalSetAgentPayloadSchema, "requirement-open": requirementOpenPayloadSchema, "requirement-answer": requirementAnswerPayloadSchema,
  "requirement-consensus": requirementConsensusPayloadSchema, "requirement-draft-feedback": requirementDraftFeedbackPayloadSchema,
  "requirement-draft-accept": requirementDraftAcceptPayloadSchema, "set-task-labels": setTaskLabelsPayloadSchema, "set-task-loop": setTaskLoopPayloadSchema,
};

describe("the orca-control skill (spec §7, C18)", () => {
  it("has frontmatter naming it", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: orca-control$/m);
    expect(front).toMatch(/^description: .{20,}$/m);
  });

  it("lists exactly the panel's mutation routes, so the table cannot drift", () => {
    const routes = new Set([...api.matchAll(/path: "\/api\/control\/([^"]+)"/g)].map((m) => m[1]!.replace(/:([A-Za-z]+)/g, "<$1>")));
    // 22 routes carry the 23 verbs: `shutdown` has no route (the panel's own lifecycle).
    expect(routes.size).toBe(22);
    expect(rows.map((row) => row.route).sort()).toEqual([...routes].sort());
  });

  it("names the verb of every route as the panel does", () => {
    const verbs = new Map([...api.matchAll(/path: "\/api\/control\/([^"]+)",?\s+verb: "([^"]+)"/g)].map((m) => [m[1]!.replace(/:([A-Za-z]+)/g, "<$1>"), m[2]!]));
    expect(verbs.size).toBe(22);
    expect(new Map(rows.map((row) => [row.route, row.verb]))).toEqual(verbs);
  });

  it("gives every route a payload example that its raw payload schema accepts", () => {
    expect(rows.length).toBe(22);
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
      "control-socket-error", "not a security boundary", "Where the expected revision comes from", ".summary.commandRevision",
      "`.revision` of `get repositories/<repoId>/workspace`", "`.revision` of `get operator/agent-preferences`", "`.repositories[].repoId`",
      "`.plans[].planId`", "`.operatorId`", "same `--command-id`",
    ]) expect(skill).toContain(phrase);
    for (const code of ["`0`", "`1`", "`2`", "`3`"]) expect(skill).toContain(code);
  });
});
