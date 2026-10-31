// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunViewV1 } from "../src/controlTypes.js";
import { shownWorkStatus } from "../src/runFacts.js";
import { UsageSettlement } from "../src/UsageSettlement.js";

afterEach(cleanup);

// Tester #117: a retried task whose new run blocked read "running" inside a red box. The colour was right, the word was not.
describe("the word a blocked work item shows", () => {
  it("says blocked when the current run is blocked, whatever the stored status", () => {
    expect(shownWorkStatus({ status: "active", category: "blocked" })).toBe("blocked");
  });
  it("keeps held, which means waiting for a person to continue", () => {
    expect(shownWorkStatus({ status: "held", category: "blocked" })).toBe("held");
  });
  it("leaves an item that is not blocked as stored", () => {
    expect(shownWorkStatus({ status: "active", category: "running" })).toBe("active");
    expect(shownWorkStatus({ status: "ready" })).toBe("ready");
  });
});

// Tester #116: an omp timeout read as "unknown" although 533,486 tokens had been observed. The floor is shown, never charged.
describe("the settlement of a run with an observed usage floor", () => {
  const preview = { generation: 1, highWater: 2, remaining: { work: { tokens: 5, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, allowed: true, refusalReason: null, acknowledge: "charge-remaining-grant" };
  const run = (over: Partial<RunViewV1>) => ({ runId: "r", taskId: "a", unknownUsageSettlement: preview, ...over }) as unknown as RunViewV1;

  it("says how much was seen at least", () => {
    render(<UsageSettlement run={run({ usageLowerBound: 533_486 })} roles={["owner"]} archived={false} groupId="g" revision={1} onCommand={() => undefined} />);
    expect(screen.getByText(/At least 533,486 tokens were observed/)).toBeTruthy();
  });
  it("says nothing of a floor when there is none", () => {
    render(<UsageSettlement run={run({})} roles={["owner"]} archived={false} groupId="g" revision={1} onCommand={() => undefined} />);
    expect(screen.queryByText(/were observed/)).toBeNull();
  });
});
