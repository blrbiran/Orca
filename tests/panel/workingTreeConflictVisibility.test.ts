import { afterAll, describe, expect, it } from "vitest";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { integrationView, readControlRecovery } from "../../src/panel/controlViews.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { createHarness, GROUP } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture } = createOverviewFixtures(h);

/**
 * Tester #434, the visibility half: a `working-tree` delivery the checkout refused (paths the person had edited) was named
 * only inside the integration record, so `group brief` showed `state=done landed=true` with one unrelated acceptance
 * warning, and `orca recovery list` said `blockers: (none)`. Nothing told the person that a delivery they had asked for was
 * still owed. `recovery list` names it now, with the command that retries it.
 */
const REFUSED = { ...newGroupIntegration({ delivery: "working-tree" })!, frozen: true, state: "blocked" as const,
  reason: "integration-working-tree-conflict:src/upper.js,src/upper.test.js" };

describe("a refused working-tree delivery is visible (#434)", () => {
  it("recovery list names it, with the command that retries it", async () => {
    const { panel } = await panelFixture();
    const body = (): Record<string, unknown> => JSON.parse(String(panel.store.db.prepare("SELECT body FROM groups WHERE id=?").get(GROUP)!.body)) as Record<string, unknown>;
    panel.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body(), integration: REFUSED }), GROUP);
    // mutation: drop integrationBlocked of a blocked working-tree record -> the row is absent, red
    const recovery = readControlRecovery(panel.store, "epoch");
    const row = (recovery as { integrationBlocked?: Array<{ groupId: string; reason: string; next: string }> }).integrationBlocked?.find((entry) => entry.groupId === GROUP);
    expect(row).toBeDefined();
    expect(row!.reason).toMatch(/^integration-working-tree-conflict/);
    expect(row!.next).toContain(`orca group retry-integration ${GROUP}`);
  });

  it("a delivered or idle working-tree record adds no row", async () => {
    const { panel } = await panelFixture();
    const body = (): Record<string, unknown> => JSON.parse(String(panel.store.db.prepare("SELECT body FROM groups WHERE id=?").get(GROUP)!.body)) as Record<string, unknown>;
    panel.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body(), integration: { ...REFUSED, state: "idle", lastIntegrated: "b".repeat(40), reason: null } }), GROUP);
    const recovery = readControlRecovery(panel.store, "epoch");
    expect((recovery as { integrationBlocked?: unknown[] }).integrationBlocked ?? []).toEqual([]);
  });

  it("the group's own delivery read keeps the refusal, which the brief prints", async () => {
    const { panel } = await panelFixture();
    const body = (): Record<string, unknown> => JSON.parse(String(panel.store.db.prepare("SELECT body FROM groups WHERE id=?").get(GROUP)!.body)) as Record<string, unknown>;
    panel.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body(), integration: REFUSED }), GROUP);
    const view = integrationView(panel.store, GROUP, body());
    expect(view.integration).toMatchObject({ state: "blocked", reason: expect.stringMatching(/^integration-working-tree-conflict/) });
  });
});
// The brief's own warning list (tester #434): `state=done landed=true` beside a refused working-tree write read as
// delivered. The brief names the refusal in `warnings`, the same list the acceptance warning rides on.
import { createServer } from "node:http";
import express from "express";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

describe("group brief warns about a refused delivery (#434)", () => {
  it("names delivery-blocked beside the acceptance warning", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
    const server = createServer((() => { const app = express(); app.use(express.json());
      registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    try {
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, integration: REFUSED }));
      const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/brief`);
      const brief = await response.json() as { warnings?: string[] };
      expect(response.status).toBe(200);
      // mutation: drop refusedDeliveryWarning from the brief's list -> no delivery-blocked warning, red
      expect(brief.warnings ?? []).toContain("delivery-blocked:working-tree:integration-working-tree-conflict");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await h.dispose();
    }
  });
});
