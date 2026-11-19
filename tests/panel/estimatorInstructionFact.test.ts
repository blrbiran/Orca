// Tester #381: `group confirm` warned once that the group's estimator profile used an older estimate instruction; nothing
// kept it. The brief and the full group view now carry the fact from the group's own newest estimate request (the
// instruction its estimates were made with): `estimatorInstruction: { used, newest }`, absent under the newest.
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { NEWEST_ESTIMATE_INSTRUCTION } from "../../src/control/estimateInstructionAge.js";
import type { ControlStore } from "../../src/control/store.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { estimatorInstructionOf } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

/**
 * #379-381 review (M5): one more estimate row after the import's, a copy of it under the next estimate_version -- made with
 * `instructionVersion`, or (null) one with no request at all (a blocked-capability row, as an unconfigured estimator leaves).
 */
function seedEstimate(store: ControlStore, instructionVersion: string | null): void {
  const first = store.db.prepare("SELECT id,estimate_version,body FROM estimates WHERE group_id='g' ORDER BY estimate_version DESC").get()!;
  const version = Number(first.estimate_version) + 1, estimateId = `seeded-${version}`;
  const body = JSON.parse(String(first.body)) as Record<string, unknown> & { request: Record<string, unknown> | null };
  const { retriedAs: _retriedAs, origin: _origin, ...rest } = body;
  const record = instructionVersion === null
    ? { ...rest, estimateId, estimateVersion: version, state: "blocked-capability", profile: null, request: null, requestHash: null, output: null, outputHash: null,
      estimatorSlot: null, reasonCode: "agent-selection-rejected:estimator:control-estimator-unconfigured" }
    : ((request) => ({ ...rest, estimateId, estimateVersion: version, state: "failed", output: null, outputHash: null, request, requestHash: sha256Canonical(request) }))({ ...body.request!, instructionVersion });
  store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES('g',?,?,?,?)").run(estimateId, version, record.state, canonicalBytes(record).toString("utf8"));
}

/**
 * Ruling (session 3ba26002, human #381): the import's estimate is made with Orca's newest instruction whatever the profile
 * names, so a group estimated under an older one (before #381) is made by rewriting its first estimate's recorded request
 * to that instruction. (Was: the fixture profile's instructionVersion chose it.) What the criteria encode is unchanged.
 */
function recordFirstEstimateAs(store: ControlStore, instructionVersion: string): void {
  const first = store.db.prepare("SELECT id,body FROM estimates WHERE group_id='g' ORDER BY estimate_version ASC").get()!;
  const body = JSON.parse(String(first.body)) as Record<string, unknown> & { request: Record<string, unknown> };
  const request = { ...body.request, instructionVersion };
  store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?").run(canonicalBytes({ ...body, request, requestHash: sha256Canonical(request) }).toString("utf8"), first.id);
}

async function reads(instructionVersion: string, seeded: Array<string | null> = []): Promise<{ brief: Record<string, unknown>; show: Record<string, unknown> }> {
  const h = await webFixture(profileSnapshot());
  recordFirstEstimateAs(h.store, instructionVersion);
  for (const version of seeded) seedEstimate(h.store, version);
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const get = async (path: string) => { const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g${path}`); expect(response.status).toBe(200); return await response.json() as Record<string, unknown>; };
    return { brief: await get("/brief"), show: await get("") };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); }
}

describe("the group's estimate instruction stays on its brief and view (#381)", () => {
  it("names instruction 1 against the newest on both reads, and nothing under the newest", async () => {
    const old = await reads("1");
    // mutation: drop the key from the brief route -> red
    expect(old.brief.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
    // mutation: drop the key from the group view route -> red
    expect(old.show.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
    // mutation: report every instruction (not only an older one) -> present here, red
    const newest = await reads(String(NEWEST_ESTIMATE_INSTRUCTION));
    expect(newest.brief).not.toHaveProperty("estimatorInstruction");
    expect(newest.show).not.toHaveProperty("estimatorInstruction");
  });
});

// #379-381 review (M5, M6): the fact is the group's NEWEST estimate request's -- an estimate made after a profile change
// under the newest instruction clears it, a newer one under an old instruction sets it, and a newer row with no request
// (nothing was asked) is passed over. A done group carries none.
describe("which estimate the fact reads (#379-381 review)", () => {
  const NEWEST = String(NEWEST_ESTIMATE_INSTRUCTION);
  it("an older estimate then one under the newest: absent", async () => {
    // mutation: ORDER BY estimate_version ASC in estimatorInstructionOf -> the import's instruction-1 estimate, red
    const { brief, show } = await reads("1", [NEWEST]);
    expect(brief).not.toHaveProperty("estimatorInstruction");
    expect(show).not.toHaveProperty("estimatorInstruction");
  });

  it("an estimate under the newest then an older one: present", async () => {
    const { brief, show } = await reads(NEWEST, ["1"]);
    expect(brief.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
    expect(show.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
  });

  it("a newer estimate row with no request is passed over", async () => {
    // mutation: drop the null-request skip -> the request-less row is read (and throws: no note), red
    const { brief } = await reads("1", [null]);
    expect(brief.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
  });

  it("a done group carries none", async () => {
    const h = await webFixture(profileSnapshot());
    try {
      recordFirstEstimateAs(h.store, "1");
      expect(estimatorInstructionOf(h.store, "g", "draft")).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
      // mutation: drop the done check -> present, red
      expect(estimatorInstructionOf(h.store, "g", "done")).toBeNull();
    } finally { await h.dispose(); }
  });
});
