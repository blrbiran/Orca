import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

/**
 * Assembly plan Task 4b (rulings R6 and R7). A panel that cannot run work still serves every read,
 * so it has to say why the commands will refuse. These judge that it says so from the config's own
 * fields, and stays quiet when those fields say the panel is fine.
 */

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
  handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
} as const;

const config = (over: Partial<ControlConfigV1> = {}): ControlConfigV1 => ({
  schema: "orca-control-config-v1",
  epoch: "epoch-a",
  repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{
    profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"],
    contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability,
    observedAt: "2026-09-22T00:00:00.000Z", probeFailureCode: null,
  }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" },
  executionPort: "configured",
  errorCatalog: [{ code: "control-port-unconfigured", status: 422 }],
  ...over,
});

const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

const render = (over: Partial<ControlConfigV1> = {}): string => renderToStaticMarkup(
  <ControlPanel
    config={config(over)} summary={summary} recovery={recovery}
    groups={{} as Record<string, GroupViewV1>} selected={null}
    drafts={{}} uncertain={[]} refusal={null} refetchRequired={false}
    onSelect={vi.fn()} onCommand={vi.fn()} onDraft={vi.fn()}
  />,
);

describe("the panel says when it has no execution port", () => {
  it("shows it, and names the two variables that fix it", () => {
    const html = render({ executionPort: "unconfigured" });
    expect(html).toContain("no execution port configured");
    expect(html).toContain("ORCA_CCLOOP_BIN");
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the second variable is the
    // agents table now (spec §6.6), and the retired name must not be offered as a fix.
    expect(html).toContain("ORCA_AGENTS_TABLE");
    expect(html).not.toContain("ORCA_CCLOOP_ADAPTER_CONFIG");
  });

  it("stays quiet when a port is configured, so the notice means something when it appears", () => {
    expect(render()).not.toContain("no execution port configured");
  });

  it("does not take the answer from a profile's probe failure", () => {
    // Spec §9.3. Every profile here reports a probe failure while the process does have a port.
    // A render that derived the notice from probeFailureCode would show it, and this is red.
    const html = render({
      profiles: [{ ...config().profiles[0]!, probeFailureCode: "control-capability-probe-failed", observed: { ...capability, handoffControl: "unavailable" } }],
    });
    expect(html).not.toContain("no execution port configured");
  });

  it("still shows the reads, because those are what a person needs after a crash", () => {
    const html = render({ executionPort: "unconfigured" });
    expect(html).toContain("Task control");
    expect(html).toContain("epoch-a");
  });
});

describe("the panel says when no estimator was configured", () => {
  it("refuses to offer a plan import, and says which flags are missing", () => {
    const html = render({ defaults: null });
    expect(html).toContain("No estimator profile is configured");
    expect(html).toContain("--estimator-profile");
    expect(html).not.toContain("Import plan</button>");
  });

  it("offers the import when an estimator is configured", () => {
    const html = render();
    expect(html).toContain("Import plan</button>");
    expect(html).not.toContain("No estimator profile is configured");
  });
});
