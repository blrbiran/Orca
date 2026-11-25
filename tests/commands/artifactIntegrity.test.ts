// Tester #469 (spec 2026-11-24-artifact-integrity-design.md, revision step 2): `orca doctor` counts the artifact rows whose
// data file is gone, so a person learns it before a view has to show a run's evidence as missing. Read-only: the store is
// a temporary one (never the person's ~/.orca, Rule 17), opened read-only; nothing is repaired.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { artifactIntegrityCheck } from "../../src/commands/doctor.js";

const CHECKOUT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const ctx = (stateDirFlag: string) => ({ env: process.env, stateDirFlag, checkout: CHECKOUT });

/** A store with these artifact ids, each with its data file unless `gone` says how it lost it, and report rows naming some. */
function storeWith(ids: Record<string, "present" | "directory" | "data">, reports: string[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ai-")));
  roots.push(dir);
  const db = new DatabaseSync(join(dir, "control.sqlite"));
  db.exec("CREATE TABLE artifacts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL)");
  for (const [id, state] of Object.entries(ids)) {
    db.prepare("INSERT INTO artifacts VALUES (?,?,?)").run(id, "a".repeat(64), "{}");
    if (state === "directory") continue;
    mkdirSync(join(dir, "artifacts", id), { recursive: true });
    if (state === "present") writeFileSync(join(dir, "artifacts", id, "data"), "x");
  }
  for (const id of reports) db.prepare("INSERT INTO outbox VALUES (?,?,?,0)").run(`report:run-${id}`, "report", JSON.stringify({ source: { artifactId: id, hash: "a".repeat(64) } }));
  db.close();
  return dir;
}
const snapshot = (dir: string) => readdirSync(dir, { recursive: true }).sort().map((name) => `${name}:${statSync(join(dir, String(name))).mtimeMs}`);

describe("orca doctor: artifact integrity (#469)", () => {
  // RED on main: no such check (the import fails). Mutation: count only a removed directory (stat the id's directory, not
  // its data file) -> the "data" row is not counted, 2 instead of 3, red.
  it("counts rows whose data file is gone -- directory removed or only data -- and the run reports among them", async () => {
    const dir = storeWith({ "keep-1": "present", "keep-2": "present", "gone-dir": "directory", "gone-data": "data", "gone-other": "directory" }, ["gone-dir", "keep-1"]);
    const before = snapshot(dir);
    const check = await artifactIntegrityCheck(ctx(dir));
    expect(check).toMatchObject({ level: "warn", subject: "artifact-integrity" });
    expect(check.fact).toContain("5 artifact rows: 3 without their data file (1 of them a run's report)");
    for (const id of ["gone-data", "gone-dir", "gone-other"]) expect(check.fact).toContain(id);
    expect(check.fact).not.toContain("keep-1");
    expect(check.fix).toContain("orca group archive <group>");
    // Read-only: nothing under the state directory changed.
    expect(snapshot(dir)).toEqual(before);
  });

  it("is ok when every row has its data file, and when there is no store", async () => {
    expect(await artifactIntegrityCheck(ctx(storeWith({ "keep-1": "present" }, ["keep-1"])))).toMatchObject({ level: "ok", subject: "artifact-integrity" });
    const empty = realpathSync(mkdtempSync(join(tmpdir(), "ai-none-")));
    roots.push(empty);
    expect(await artifactIntegrityCheck(ctx(empty))).toMatchObject({ level: "ok", subject: "artifact-integrity" });
  });
});
