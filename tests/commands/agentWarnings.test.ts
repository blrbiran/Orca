// Tester #375: the MCP readiness warning an omp phase printed was only in a per-call stderr.log. ccloop now records it on
// the transcript entry, and Orca stores the listing on the run; `orca doctor` reads those stored listings (never a
// network probe, never the person's ~/.orca) and names the most recent warning so "why was this phase slow" is answerable.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentWarningsCheck } from "../../src/commands/doctor.js";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function storeWith(bodies: Array<{ id: string; body: unknown }>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "aw-")));
  roots.push(dir);
  const db = new DatabaseSync(join(dir, "control.sqlite"));
  db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO runs (id, body) VALUES (?, ?)");
  for (const { id, body } of bodies) insert.run(id, typeof body === "string" ? body : JSON.stringify(body));
  db.close();
  return dir;
}

const ctx = (stateDirFlag: string) => ({ env: process.env, stateDirFlag, checkout: CHECKOUT });
const runWith = (warnings: string[][]) => ({ transcripts: { sourceDir: "/r", entries: warnings.map((list, i) => ({ attempt: 1, phase: "plan", seq: i + 1, path: null, bytes: 0, final: true, truncatedAt: null, warnings: list })) } });

describe("orca doctor: stored agent launch warnings (#375)", () => {
  it("names the most recent MCP readiness warning and the run it came from", async () => {
    const warning = 'Warning: MCP server "rea" not ready after 2000ms; its tools are unavailable for this run.';
    const dir = storeWith([
      { id: "run-old", body: runWith([["Warning: older"]]) },
      { id: "run-new", body: runWith([[warning]]) },
    ]);
    const check = await agentWarningsCheck(ctx(dir));
    expect(check.level).toBe("warn");
    expect(check.subject).toBe("agent-warnings");
    expect(check.fact).toContain("rea");
    expect(check.fact).toContain("run-new");
    expect(check.fix).toContain("MCP");
  });

  it("is ok when no stored listing carries a warning", async () => {
    const dir = storeWith([{ id: "run-1", body: runWith([]) }]);
    expect(await agentWarningsCheck(ctx(dir))).toMatchObject({ level: "ok", subject: "agent-warnings" });
  });

  it("is ok when the control store does not exist yet", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "aw-none-")));
    roots.push(dir); mkdirSync(join(dir, "sub"), { recursive: true }); writeFileSync(join(dir, "unrelated"), "x");
    expect(await agentWarningsCheck(ctx(dir))).toMatchObject({ level: "ok", subject: "agent-warnings" });
  });

  it("an unreadable run body is skipped, not a crash", async () => {
    const dir = storeWith([{ id: "run-bad", body: "{not json" }, { id: "run-good", body: runWith([["Warning: x"]]) }]);
    expect(await agentWarningsCheck(ctx(dir))).toMatchObject({ level: "warn" });
  });
});
