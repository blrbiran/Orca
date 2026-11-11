// Tester follow-up F §1 (#195, human ruling 「要改」): nothing in production feeds Orca a context observation, so a context
// hand-off threshold does nothing; confirm no longer requires one. The fixture's worker profile declares a 1,000,000-token
// window -- the case that used to refuse a null threshold as execution-policy-unrepresentable -- and a null threshold now
// confirms through the Web API and through the control socket the CLI uses (`x-orca-client: cli`), frozen as null.
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bindControlSocket, buildControlSocketApp } from "../../src/panel/controlSocket.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { command, createHarness, get, GROUP, json, revision, view } from "./fixtures/controlPanel.js";
import { overSocket } from "./fixtures/socketPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture } = createOverviewFixtures(h);

async function nullThresholdConfirm(panel: Awaited<ReturnType<typeof panelFixture>>["panel"], commandId: string) {
  const group = await view(panel);
  const config = await json(await get(panel, "/api/control/config"));
  const profile = (config.profiles as Array<{ profileHash: string; capabilities?: { contextWindowTokens?: unknown } }>)[0]!;
  return {
    commandId, expectedRevision: await revision(panel), payload: {
      planHash: group.plan.planHash, proposalVersion: group.proposal.proposalVersion, budgetMode: "soft",
      profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: profile.profileHash, worker: profile.profileHash, handoff: profile.profileHash, goalReview: profile.profileHash },
      contextPolicy: { handoffAtContextTokens: null }, selectionsHash: await panel.selectionsHash(),
    },
  };
}

describe("confirm accepts a null context hand-off threshold under a declared worker window (#195)", () => {
  it("over the Web API", async () => {
    const { panel } = await panelFixture();
    const response = await command(panel, `/api/control/groups/${GROUP}/confirm`, await nullThresholdConfirm(panel, "confirm-web-null"));
    expect([response.status, (response.body as { result?: { kind?: string } }).result?.kind]).toEqual([200, "confirmed"]);
    expect((await view(panel)).proposal).toMatchObject({ state: "confirmed", contextPolicy: { handoffAtContextTokens: null } });
  }, 30_000);

  it("over the control socket the CLI sends through", async () => {
    const { panel } = await panelFixture();
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), "s")));
    const bound = await bindControlSocket(buildControlSocketApp({ store: panel.store, epoch: panel.epoch, config: undefined as never, service: panel.service }), join(stateDir, "control.sock"));
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
    try {
      const socket = await overSocket(join(stateDir, "control.sock"), "POST", `/api/control/groups/${GROUP}/confirm`, { "x-orca-client": "cli" }, await nullThresholdConfirm(panel, "confirm-cli-null"));
      expect([socket.status, JSON.parse(socket.text).result?.kind]).toEqual([200, "confirmed"]);
      expect((await view(panel)).proposal).toMatchObject({ state: "confirmed", contextPolicy: { handoffAtContextTokens: null } });
    } finally { await bound.close(); }
  }, 30_000);
});
