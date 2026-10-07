// Accounts spec §5.3: GET /api/control/usage over the socket (an agent) and the Web (a member), against real ledger rows.
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";
import { sessionFor } from "./fixtures/auth.js";

useSocketPanels();

const A = Date.parse("2026-05-10T00:00:00Z"), B = Date.parse("2026-05-20T00:00:00Z");
type Row = { at: number; model: string | null; quality: "reported" | "unattributed" | "breakdown-mismatch" | "pre-ledger"; tokens: number; repo?: string | null };

function insertRows(state: string, rows: Row[]): void {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    const insert = db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const r of rows) {
      const pre = r.quality === "pre-ledger", reported = r.model !== null;
      insert.run(r.at, "g1", r.repo === undefined ? "x" : r.repo, null, pre ? "pre-ledger" : "run-work", r.model,
        reported ? r.tokens : null, reported ? 0 : null, reported ? 0 : null, reported ? 0 : null, r.tokens, pre ? "unattributed" : r.quality);
    }
  } finally { db.close(); }
}

const query = "scope=all&groupBy=model";
describe("GET /api/control/usage (spec §5.3)", () => {
  it("U1: sums reported and unattributed rows of the range, never a breakdown-mismatch row, per model; the headline reads outside the range", async () => {
    const w = await workspace(); const panel = await boot(w);
    const now = Date.now();
    insertRows(w.state, [
      { at: A + 1_000, model: "m-a", quality: "reported", tokens: 100 },
      { at: A + 2_000, model: "m-a", quality: "reported", tokens: 50 },
      { at: A + 3_000, model: "m-b", quality: "reported", tokens: 30 },
      { at: A + 4_000, model: null, quality: "unattributed", tokens: 7 },
      { at: A + 5_000, model: "m-b", quality: "breakdown-mismatch", tokens: 9_000 },
      { at: B + 1_000, model: "m-a", quality: "reported", tokens: 1_000 }, // outside the range
      { at: 0, model: null, quality: "pre-ledger", tokens: 400 }, // counts in the total only
      { at: now, model: "m-a", quality: "reported", tokens: 5 }, // in this week and month
    ]);
    const path = `/api/control/usage?${query}&from=${A}&to=${B}`;
    const socket = await overSocket(panel.socketPath!, "GET", path);
    expect(socket.status).toBe(200);
    const member = await (await sessionFor(panel, w.env, "member-user", "member")).fetch(path);
    expect(member.status).toBe(200);
    for (const view of [JSON.parse(socket.text), await member.json()]) {
      expect(view.schema).toBe("orca-usage-view-v1");
      expect(view.range.tokens).toBe(100 + 50 + 30 + 7);
      expect(view.range.byModel).toEqual([
        { model: "m-a", input: 150, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 150 },
        { model: "m-b", input: 30, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 30 },
        { model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 7 },
      ]);
      expect(view.range.groups).toEqual([{ key: "m-a", tokens: 150 }, { key: "m-b", tokens: 30 }, { key: "unattributed", tokens: 7 }]);
      expect(view.counts).toEqual({ unattributedRows: 1, breakdownMismatchRows: 1, unknownUsageRuns: 0 });
      // total: every non-mismatch row, the pre-ledger one included; week and month: only the row applied now.
      expect(view.headline.total).toBe(100 + 50 + 30 + 7 + 1_000 + 400 + 5);
      expect(view.headline.week).toBeGreaterThanOrEqual(5);
      expect(view.headline.week).toBeLessThan(400);
      expect(view.headline.month).toBeLessThan(400);
      expect(view.caps).toEqual([]);
      expect(view.spendRevision).toBe(0);
    }
  });

  it("U2: scope=repo:<id> counts that repository's rows only; groupBy=repo and day group them", async () => {
    const w = await workspace(); const panel = await boot(w);
    insertRows(w.state, [
      { at: A + 1_000, model: "m-a", quality: "reported", tokens: 10, repo: "x" },
      { at: A + 2_000, model: "m-a", quality: "reported", tokens: 20, repo: "y" },
      { at: A + 3_000, model: null, quality: "unattributed", tokens: 4, repo: null },
    ]);
    const get = async (q: string) => JSON.parse((await overSocket(panel.socketPath!, "GET", `/api/control/usage?${q}&from=${A}&to=${B}`)).text);
    expect((await get("scope=repo:y")).range.tokens).toBe(20);
    expect((await get("scope=all&groupBy=repo")).range.groups).toEqual([{ key: "unknown", tokens: 4 }, { key: "x", tokens: 10 }, { key: "y", tokens: 20 }]);
    const day = await get("scope=all&groupBy=day");
    expect(day.range.groups.length).toBe(1);
    expect(day.range.groups[0].tokens).toBe(34);
    expect(Number.isNaN(Date.parse(day.range.groups[0].key))).toBe(false);
  });

  it("U3: a bad query answers 400 usage-query-invalid", async () => {
    const w = await workspace(); const panel = await boot(w);
    const member = await sessionFor(panel, w.env, "member-user", "member");
    for (const q of ["scope=repo:x%20y", "scope=all&from=1.5", "from=1", "scope=all&from=5&to=5", "scope=all&groupBy=year", "scope=all&other=1", "scope=all&to=01", "scope=all&scope=all"]) {
      const socket = await overSocket(panel.socketPath!, "GET", `/api/control/usage?${q}`);
      expect([q, socket.status, JSON.parse(socket.text).error.code]).toEqual([q, 400, "usage-query-invalid"]);
      const web = await member.fetch(`/api/control/usage?${q}`);
      expect([q, web.status, (await web.json()).error.code]).toEqual([q, 400, "usage-query-invalid"]);
    }
  });
});
