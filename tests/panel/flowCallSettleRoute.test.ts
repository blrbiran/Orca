import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FrozenSlot } from "../../src/control/agentSelection.js";
import { createExecutionDriver, type ExecutionDriverDeps } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { createFlowCallPort } from "../../src/flow/calls.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { singleCallPort } from "../control/fixtures/estimateHarness.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import { flowWorld } from "../flow/fixtures/flowWorld.js";
import { overSocket } from "./fixtures/socketPanel.js";

/**
 * Tester #348 review (controller ruling, session 4389b15f, 2026-11-18): the server's command routes never read the run
 * view schema, and must not. A flow call's run body is outside that schema by design (its `flowCall` identity, a
 * `flow-draft` purpose), so a route-level check against it refused the human-ruled settlement of a blocked flow call --
 * run-scoped recovery-retry with charge-remaining-grant, from the CLI or the run page -- and the call stayed blocked for
 * good. Here a real driver blocks a flow-draft call on unknown usage and the settlement travels the socket route.
 * Adapted from the reviewer's probe (.review-348/clone/tests/zreview/flowSettleRoute.test.ts).
 */
const TEMPLATE = { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nbudget: {tokensPerRun: 3000000}\nsteps:\n  - {id: outline, kind: draft, prompt: p.md}\n", assets: { "p.md": "Outline the article.\n" } };

describe("settling a blocked flow call over the command route (#348 review)", () => {
  it("run-scoped recovery-retry with charge-remaining-grant answers 200 and the run settles", async () => {
    const snapshot = profileSnapshot();
    const h = await webFixture(snapshot, [{ taskId: "a" }]);
    const slot = (h.deps.estimatorSlot as unknown as { slot: FrozenSlot }).slot;
    const binding = { profileId: "all", profileHash: h.frozen.profileHash };
    const w = await flowWorld({ one: TEMPLATE }, { harness: h, callPort: (store, now) => createFlowCallPort({ store, now }),
      confirmParent: async () => ({ call: { profile: binding, agentSlot: slot, maxOutputTokens: 8_000 }, children: null }) });
    const { groupId } = await w.start({ templateRef: "builtin/one" });
    const fake = singleCallPort({ outcome: "failed", tokens: null, errorCode: "omp-stalled" } as never, () => "unused");
    const deps: ExecutionDriverDeps = { store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
      roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => join(h.root, "repo"), ccloopBin: "/bin/false", agentsTablePath: join(h.root, "agents.json") };
    const driver = createExecutionDriver(deps);
    const service = new WebControlService(h.deps);
    const run = () => { const row = h.store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid DESC LIMIT 1").get(groupId)!; return { runId: String(row.id), ...JSON.parse(String(row.body)) }; };
    await w.advance();
    for (let i = 0; i < 30 && run().state !== "blocked"; i += 1) await driver.round();
    expect({ state: run().state, purpose: run().purpose, reason: run().drive?.blockedReason }).toEqual({ state: "blocked", purpose: "flow-draft", reason: "flow-call-usage-unknown:omp-stalled" });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "agent", client: "mcp:test" }; next(); });
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service }, "socket");
    const server = createServer(app), socketPath = join(h.root, "s.sock");
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
      // mutation: refuse a command naming a run the view schema cannot decode (the dropped #348 guard) -> 423, red
      const answer = await overSocket(socketPath, "POST", "/api/control/recovery/retry", { "x-orca-client": "mcp:test" },
        { commandId: "settle-flow", expectedRevision: revision, payload: { scope: "run", runId: run().runId, acknowledge: "charge-remaining-grant" } });
      expect(answer.status, answer.text).toBe(200);
      expect({ state: run().state, unknown: run().unknown }).toEqual({ state: "settled-restartable", unknown: { work: false, handoff: false } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
      await w.dispose();
    }
  }, 180_000);
});
