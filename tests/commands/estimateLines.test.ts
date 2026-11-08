// Issue #144(d)/#140 (dogfood run 3, session 86352010): `orca group import` and `orca group estimate` printed the result as
// one JSON line cut at 160 characters, so a blocked estimate's state and reason code ended up behind the "…". Their human
// output now also prints `estimate: <state>` and `reason: <code>` on their own lines; --json is unchanged. The two
// answers name the reason differently: the import result `estimateReasonCode` (planImport.ts), the estimate result
// `reasonCode` (webProtocol.ts estimate-created).
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const LONG = "x".repeat(150);
const success = (verb: string, groupId: string, result: unknown) => ({ schema: "orca-command-success-v1", commandId: "c", actorId: "human", verb,
  target: { kind: "group", groupId }, commandRevision: 1, projectionSeq: 1, effectivePayloadHash: "h", authorityCommandHash: "h", result });
const imported = (estimateState: string, estimateReasonCode: string | null) =>
  success("import-plan", "g-new", { kind: "imported", groupId: "g-new", estimateId: `estimate-${LONG}`, estimateState, estimateReasonCode });
const created = (estimateState: string, reasonCode: string | null) =>
  success("estimate", "g-alpha", { kind: "estimate-created", estimateId: `estimate-${LONG}`, estimateVersion: 2, estimateState, reasonCode, wakeId: null });

describe("import and estimate print the estimate state and reason on their own lines (#144(d))", () => {
  it("group import names a blocked estimate's state and reason in full", async () => {
    const body = imported("blocked-capability", "estimator-capability-unavailable");
    const w = await world({}, { "POST groups/import-plan": { status: 201, body } });
    const out = await cli(["group", "import", "plan-a", "--group", "g-new"], w.dir);
    expect(out.code).toBe(0);
    // mutation: read `reasonCode` from the import result (the field the estimate result uses) -> "reason: none", red
    // mutation: drop the appended lines -> neither line, red
    expect(out.stdout).toContain("\nestimate: blocked-capability\nreason: estimator-capability-unavailable\n");
    const json = await cli(["group", "import", "plan-a", "--group", "g-new", "--json"], w.dir);
    // The JSON is the panel's answer as before: one parseable document, its body unchanged.
    expect(JSON.parse(json.stdout)).toMatchObject({ schema: "orca-cli-response-v1", status: 201, body });
  });

  it("group import points to its agent and budget checks before confirmation (#164)", async () => {
    const w = await world({}, { "POST groups/import-plan": { status: 201, body: imported("none", null) } });
    const out = await cli(["group", "import", "plan-a", "--group", "g-new"], w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("orca proposal show g-new");
    expect(out.stdout).toContain("orca control get groups/g-new/agent-preview");
    // A machine consumer receives the panel answer unchanged.
    const json = await cli(["group", "import", "plan-a", "--group", "g-new", "--json"], w.dir);
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 201, body: imported("none", null) });
  });

  it("group estimate names its state and reason in full", async () => {
    const body = created("input-too-large", "estimate-input-too-large");
    const w = await world({}, { "POST groups/g-alpha/estimates": { status: 201, body } });
    const out = await cli(["group", "estimate", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    // mutation: read `estimateReasonCode` from the estimate result -> "reason: none", red
    expect(out.stdout).toContain("\nestimate: input-too-large\nreason: estimate-input-too-large\n");
    const json = await cli(["group", "estimate", "g-alpha", "--json"], w.dir);
    // The JSON is the panel's answer as before: one parseable document, its body unchanged.
    expect(JSON.parse(json.stdout)).toMatchObject({ schema: "orca-cli-response-v1", status: 201, body });
  });

  it("no reason prints as none, and an import with no estimate says none", async () => {
    const w = await world({}, { "POST groups/import-plan": { status: 201, body: imported("none", null) } });
    expect((await cli(["group", "import", "plan-a", "--group", "g-new"], w.dir)).stdout).toContain("\nestimate: none\nreason: none\n");
  });
});
