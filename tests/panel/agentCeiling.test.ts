import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../src/control/planImport.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { AgentCeilingRefusal, readSpendCapBlock } from "../../src/control/spendCaps.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { registerControlMutationRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";
import { webFixture } from "../control/fixtures/web.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { VALID_SPLIT } from "../control/fixtures/requirementOutputs.js";
import { openTestStore } from "../control/fixtures/store.js";

const setCap = (store: ControlStore, tokens: number, scope = "all") =>
  store.db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES (?,'total',?,1,'user:u1') ON CONFLICT(scope,period) DO UPDATE SET tokens=excluded.tokens").run(scope, tokens);
const AGENT = { client: "cli", principal: "agent:cli" };

/** webFixture's import call (tests/control/fixtures/web.ts), for another group of the same plan. */
async function importer(h: Awaited<ReturnType<typeof webFixture>>) {
  return async (commandId: string, groupId: string) => {
    const command: ImportCommand = { schema: "orca-raw-command-v1", commandId, expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", planId: "plan" } };
    const prepared = await prepareEstimatorSlot({ store: h.store, profileRouter: h.deps.profileRouter }, command, h.frozen);
    return () => importControlPlan({ ...h.deps, estimatorSlot: prepared.outcome, estimatorObservation: () => prepared.observation }, command);
  };
}
const groupLimitTokens = (store: ControlStore, groupId: string): number =>
  (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as { ledger: { groupLimit: { tokens: number } } }).ledger.groupLimit.tokens;

describe("the agent ceiling (spec §6.3.2, D4, D10)", () => {
  it("an agent's new unlimited import is admitted while its finite estimate claim remains capped",async()=>{
    const h=await webFixture();try{
      const prepare=await importer(h);setCap(h.store,1);
      const receipt=withCommandContext("agent-import",AGENT,await prepare("agent-import","g2"));
      expect(receipt).toMatchObject({result:{kind:"imported",groupId:"g2"}});expect(groupLimitTokens(h.store,"g2")).toBeNull();
      const estimateId=(receipt as {result:{estimateId:string}}).result.estimateId;
      expect(await new WebControlService(h.deps).claimEstimate("g2",estimateId)).toBeNull();
      expect(readSpendCapBlock(h.store,"g2")).toMatchObject({code:"spend-cap-reached",scope:"all",period:"total",capTokens:1});
      expect(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g2'").all()).toEqual([]);
      expect(withCommandContext("user-import",{client:"web",principal:"user:u1"},await prepare("user-import","g3"))).toMatchObject({result:{kind:"imported",groupId:"g3"}});
    }finally{await h.dispose();}
  });
  it("an agent's new unlimited import still cannot claim beyond its repository cap",async()=>{
    const h=await webFixture();try{
      const prepare=await importer(h);setCap(h.store,1,"repo:repo");
      const receipt=withCommandContext("agent-import",AGENT,await prepare("agent-import","g2"));
      expect(receipt).toMatchObject({result:{kind:"imported",groupId:"g2"}});
      expect(await new WebControlService(h.deps).claimEstimate("g2",(receipt as {result:{estimateId:string}}).result.estimateId)).toBeNull();
      expect(readSpendCapBlock(h.store,"g2")).toMatchObject({code:"spend-cap-reached",scope:"repo:repo",period:"total",capTokens:1});
      expect(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g2'").all()).toEqual([]);
    }finally{await h.dispose();}
  });

  it("the route answers 403 control-limit-over-cap-headroom", async () => {
    const h = await openTestStore();
    const app = express();
    app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "agent", client: "cli" }; res.locals.orcaClient = "cli"; next(); });
    app.use(express.json({ verify: verifyControlJsonBody }));
    const cap = { scope: "all" as const, period: "week" as const, tokens: 10, updatedAt: 0, updatedBy: "user:u1", used: 4, committed: 1, headroom: 5, from: 0, to: 1 };
    // CLI v2 plan Task 9 made the route read service.deps (the owner's --by for §16 attribution); the stub carries an empty
    // one (Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)).
    const service = { deps: {}, importPlan: async () => { throw new AgentCeilingRefusal(cap, 9); } } as unknown as WebControlService;
    registerControlMutationRoutes(app, h.store, service, "socket");
    const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/import-plan`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "agent-import", expectedRevision: 0, payload: { groupId: "g2", repoId: "repo", planId: "plan" } }) });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: { code: string; message: string; retryable: boolean } };
      expect(body.error).toMatchObject({ code: "control-limit-over-cap-headroom", retryable: false });
      expect(body.error.message).toContain("9 tokens");
      expect(body.error.message).toContain("all week cap's headroom of 5");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); }
  });

  it("requirement-draft-accept from an agent is held to the same ceiling", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" }); try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      setCap(x.store, 1);
      const draftHash = readDraft(x.store, "r", 1).draftHash!;
      const accept = async (context: { client: string; principal: string }) => {
        const command = x.command("requirement-draft-accept", { draftNo: 1, draftHash }) as { commandId: string };
        return { commandId: command.commandId, run: () => withCommandContext(command.commandId, context, () => x.service.acceptRequirementDraft(command as never)) };
      };
      const refused = await accept(AGENT);
      let refusal: unknown = null;
      try { await refused.run(); } catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(AgentCeilingRefusal);
      expect(readDraft(x.store, "r", 1).state).toBe("awaiting-review");
      expect(x.group()).toMatchObject({ status: "clarifying" });
      expect(x.store.db.prepare("SELECT id FROM commands WHERE id=?").get(refused.commandId)).toBe(undefined);
      // D4: the ceiling compares the fresh limit, without the clarifying spend the group carries over; at exactly the
      // headroom that limit leaves, the agent's accept goes through.
      const ledgerUsed = Number(x.store.db.prepare("SELECT sum(tokens) AS n FROM usage_ledger").get()!.n);
      setCap(x.store, ledgerUsed + (refusal as AgentCeilingRefusal).limitTokens);
      expect(await (await accept(AGENT)).run()).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      const ledger = (JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as { ledger: { groupLimit: { tokens: number }; used: { tokens: number } } }).ledger;
      expect(ledger.used.tokens).toBeGreaterThan(0);
      expect((refusal as AgentCeilingRefusal).limitTokens).toBe(ledger.groupLimit.tokens - ledger.used.tokens);
    } finally { await x.dispose(); }
  });
});
