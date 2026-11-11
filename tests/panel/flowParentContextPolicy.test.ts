// Tester follow-up F §1 (#195, human ruling 「要改」): a flow's hidden children are confirmed with no context hand-off
// threshold, as any group may be now. They used to take the worker profile's declared window (1,000,000 here), a number
// nothing acts on: nothing in production feeds Orca a context observation.
import { describe, expect, it } from "vitest";
import { createPanelFlow } from "../../src/panel/flowAssembly.js";
import { webFixture } from "../control/fixtures/web.js";

describe("the flow parent's confirmation of its children (#195)", () => {
  it("names no context hand-off threshold, though the worker profile declares a window", async () => {
    const h = await webFixture();
    try {
      const deps = h.deps as unknown as Parameters<typeof createPanelFlow>[0] & { profileRouter: Parameters<typeof createPanelFlow>[0]["router"]; trustedConfig: never; defaults: never };
      const flow = createPanelFlow({
        store: h.store, env: {}, router: deps.profileRouter, port: deps.port, admissionGate: deps.admissionGate,
        importDeps: { store: h.store, trustedConfig: deps.trustedConfig, profileRouter: deps.profileRouter, defaults: deps.defaults },
        confirm: async () => ({}), kick: () => {},
      });
      const fixtureDefaults = h.deps.defaults()!;
      expect(h.deps.profileRouter.resolve("task", fixtureDefaults.estimatorProfileId, fixtureDefaults.estimatorProfileHash).snapshot.profile.capabilities.contextWindowTokens).toBe(1_000_000);
      const confirmation = await flow.deps.confirmParent!({ flowRunId: "flow-1", groupId: "flow-parent", projectId: null, by: "human", operatorId: "human" });
      expect(confirmation.children).toMatchObject({ budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null } });
    } finally { await h.dispose(); }
  });
});
