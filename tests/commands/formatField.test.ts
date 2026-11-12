// Tester #274: ccloop (from 1c54033) puts the field its strict execute shape refused into the run's failure-cause detail
// (`execution-format-invalid: commandOutputs: expected array, received string`). runDiagnosis names it (`formatField`), and
// `orca run show` and `orca run results` say it in words.
import { describe, expect, it } from "vitest";
import { refusedFormatField } from "../../src/control/formatRefusal.js";
import type { ControlStore } from "../../src/control/store.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const FIELD = "commandOutputs: expected array, received string";
const DETAIL = `execution-format-invalid: ${FIELD}`;

describe("the field a format failure refused (#274)", () => {
  it("is read from ccloop's failure-cause detail, and only from a format refusal's", () => {
    expect(refusedFormatField(DETAIL)).toBe(FIELD);
    expect(refusedFormatField(`execution-format-ambiguous-or-hidden: (top level): Unrecognized key(s) in object: 'x'`)).toBe("(top level): Unrecognized key(s) in object: 'x'");
    // mutation: match anywhere (no ^ anchor) -> red
    expect(refusedFormatField(`429 Too Many Requests; execution-format-invalid: ${FIELD}`)).toBeNull();
    expect(refusedFormatField("execution-format-invalid")).toBeNull();
    expect(refusedFormatField(null)).toBeNull();
  });

  it("is in the run's diagnosis, beside an unchanged decode cause", () => {
    const run = { groupId: "g", workItemId: "a", taskId: "a", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "x",
      phase: "work" as const, providerAttemptOrdinal: 1, failureCode: null, drive: { failureCause: { cause: "unknown", phase: "execute" as const, detail: DETAIL } } };
    // mutation: formatField not set by readRunDiagnosis -> red
    expect(readRunDiagnosis({} as ControlStore, run)).toMatchObject({ cause: "unknown", formatField: FIELD });
    expect(readRunDiagnosis({} as ControlStore, { ...run, drive: { failureCause: { cause: "unknown", phase: "execute", detail: "429" } } })).not.toHaveProperty("formatField");
  });

  const RUN = { runId: "run-1", taskId: "t1", state: "blocked", outcome: "failed", stopReason: `Error: codex-result-invalid: /r/call: ${FIELD}`,
    failureCause: { cause: "unknown", phase: "execute", retries: 0, detail: DETAIL }, diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 1, formatField: FIELD } };
  const GROUP = { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
    workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [RUN] };
  const LINE = `the agent's answer did not fit the execute format; refused: ${FIELD}`;

  it("run show says it in words", async () => {
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
      "GET groups/g-alpha": { status: 200, body: GROUP },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    // mutation: the formatField line left out of run show -> red
    expect(out.stdout.split("\n")).toContain(LINE);
  });

  it("run results says it in words above the attempts", async () => {
    const p = await fakePanel({
      "GET runs/run-1/results": { status: 200, body: { schema: "orca-run-results-v1", runId: "run-1", groupId: "g-alpha", taskId: "t1", availability: "available", currentAttempt: 1,
        source: { status: "available", reason: null }, attempts: [{ attempt: 1, current: true, execution: "unavailable", verification: "not-run", outputs: [] }] } },
      "GET runs/run-1/saved-result-eligibility": { status: 200, body: { status: "unavailable", reason: "execution-format-invalid" } },
      "GET groups/g-alpha": { status: 200, body: GROUP },
    });
    const out = await cli(["run", "results", "run-1"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    // mutation: compose does not read the group view -> red
    expect(lines[2]).toBe(LINE);
    expect(lines).toContain("attempt 1 (current): execution unavailable, verification not-run, outputs 0");
  });
});
