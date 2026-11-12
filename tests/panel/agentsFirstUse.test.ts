import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedEmptyAgentsTable } from "../../src/agents/command.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { createHarness, get, json } from "./fixtures/controlPanel.js";

// Handoff §4.0 item 5 (seat G1, 2026-11-12): "every action can be done in the Web UI". On a first-use machine there is
// no installation table, so ccloop refused the agents view and the protected preview, and the only way out was the CLI
// `orca agent init`. Now the agents view answers "no installations" while nothing is at the table's path, and the
// owner's detection (the existing owner-only preview, then apply) first seeds an empty table to preview against.
// Rule 17: every table here is under a temporary directory; the ccloop is a stand-in that probes no real agent.
const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const tempRoot = async (): Promise<string> => { const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agents-first-use-"))); roots.push(root); return root; };

/** A stand-in ccloop: `features` offers installation updates; `agent-installation-preview` refuses a missing table, as ccloop does. */
async function fakeCcloop(root: string): Promise<string> {
  const binary = join(root, "ccloop");
  await writeFile(binary, `#!${process.execPath}
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const [, , , method, , table] = process.argv;
if (method === "features") { process.stdout.write(JSON.stringify({ protocol: 1, agentInstallationUpdate: "v1" })); process.exit(0); }
if (method === "agent-installation-preview") {
  let bytes;
  try { bytes = readFileSync(table); } catch { process.stderr.write("agents-table-invalid: ENOENT"); process.exit(2); }
  process.stdout.write(JSON.stringify({ schema: "orca-agent-detection-preview-v1", previewId: "preview-1", baseTableHash: createHash("sha256").update(bytes).digest("hex"),
    observedAt: "2026-11-12T00:00:00.000Z", installed: [], changes: [] }));
  process.exit(0);
}
process.stderr.write("control-command-invalid"); process.exit(2);
`, { mode: 0o700 });
  return binary;
}

const EMPTY_TABLE = `${JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {} }, null, 2)}\n`;

describe("first-use agent installation from the Web", () => {
  it("the owner's detection seeds an empty table (0700 directory, 0600 file) and previews against it", async () => {
    const root = await tempRoot();
    const table = join(root, "home", ".orca", "agents.json");
    const port = createCcloopExecutionPort({ binary: await fakeCcloop(root), agentsTablePath: table, timeoutMs: 10_000 });
    expect(port.agentsTableAbsent!()).toBe(true);
    const preview = await port.previewAgentInstallations!();
    expect(await readFile(table, "utf8")).toBe(EMPTY_TABLE);
    // The preview was taken over the seeded bytes, so an apply's base hash is the table's own.
    expect(preview.baseTableHash).toBe(createHash("sha256").update(EMPTY_TABLE).digest("hex"));
    expect((await lstat(table)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(root, "home", ".orca"))).mode & 0o777).toBe(0o700);
    expect((await lstat(join(root, "home"))).mode & 0o777).toBe(0o700);
    expect((await readdir(join(root, "home", ".orca"))).sort()).toEqual(["agents.json"]);
    expect(port.agentsTableAbsent!()).toBe(false);
  });

  it("never replaces an existing table, nor changes its mode", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "orca"), { mode: 0o700 });
    const table = join(root, "orca", "agents.json");
    const owned = `{"schema":"ccloop-agents-table-v1","installations":{"mine":{}}}\n`;
    await writeFile(table, owned, { mode: 0o640 });
    expect(await seedEmptyAgentsTable(table)).toBe(false);
    expect(await readFile(table, "utf8")).toBe(owned);
    expect((await lstat(table)).mode & 0o777).toBe(0o640);
    expect((await readdir(join(root, "orca"))).sort()).toEqual(["agents.json"]);
  });

  it("the agents view answers no installations while nothing is at the table's path, so the Agents page renders", async () => {
    const h = createHarness();
    const panel = await h.boot("first-use", await h.workspace(), { agentUpdatePort: { agentsTableAbsent: () => true } as never });
    try {
      // The fixture port would list its codex installation; with no table there is none to list.
      expect(await json(await get(panel, "/api/control/agents"))).toEqual({ schema: "orca-agents-view-v1", installations: [] });
    } finally { await panel.close(); await h.dispose(); }
  });
});
