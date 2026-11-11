// Tester follow-up E §9 (D21): `orca project add <name> --path <dir> | --dirs <id,id>` posts the Web form's body to the
// socket's projects route (the panel's criteria, tests/panel/projectAdd.test.ts, pin who it accepts). Over MCP and under the
// dispatched-run marker it is refused here, before anything is sent, as `orca auth login` is.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const ADDED = { status: 201, body: { project: { projectKey: "web", name: "Web", path: "/repos/web", controlRepoId: null } } };
const posts = (panel: Awaited<ReturnType<typeof fakePanel>>) => panel.requests.filter((r) => r.method === "POST").map((r) => [r.path, JSON.parse(r.text)]);

describe("orca project add (tester follow-up E §9, D21)", () => {
  it("posts {name, path} with a relative --path resolved from cwd, and prints the added row", async () => {
    const panel = await fakePanel({ "POST projects": ADDED });
    const out = await cli(["project", "add", "Web", "--path", "web"], panel.dir, { cwd: "/repos" });
    expect([out.code, out.stdout, out.stderr]).toEqual([0, "added project web (repo): /repos/web\n", ""]);
    expect(posts(panel)).toEqual([["projects", { name: "Web", path: "/repos/web" }]]);
  });

  it("posts {name, dirs} from a comma-separated --dirs, in order", async () => {
    const panel = await fakePanel({ "POST projects": { status: 201, body: { project: { projectKey: "shop", kind: "multi", path: "/repos/web", dirs: [{ projectKey: "web" }, { projectKey: "api" }] } } } });
    const out = await cli(["project", "add", "Shop", "--dirs", "web, api"], panel.dir);
    expect([out.code, out.stdout]).toEqual([0, "added project shop (multi): members web, api\n"]);
    expect(posts(panel)).toEqual([["projects", { name: "Shop", dirs: ["web", "api"] }]]);
  });

  it("a panel refusal is the panel's answer: exit 2, its code named", async () => {
    const panel = await fakePanel({ "POST projects": { status: 403, body: { error: { code: "control-person-token-required", message: "wants a person", retryable: false } } } });
    const out = await cli(["project", "add", "Web", "--path", "/repos/web"], panel.dir);
    expect([out.code, out.stderr]).toEqual([2, "orca: control-person-token-required: wants a person\n"]);
  });

  it("refuses neither or both of --path and --dirs, over MCP, and under the dispatched-run marker, sending nothing", async () => {
    const panel = await fakePanel({ "POST projects": ADDED });
    const neither = await cli(["project", "add", "Web"], panel.dir);
    const both = await cli(["project", "add", "Web", "--path", "/repos/web", "--dirs", "a"], panel.dir);
    // mutation: drop the MCP refusal -> exit 0, the POST is sent, red
    const mcp = await cli(["project", "add", "Web", "--path", "/repos/web", "--json"], panel.dir, { client: "mcp:claude" });
    // mutation: drop the marker refusal -> exit 0 (the fake accepts), the POST is sent, red
    const marked = await cli(["project", "add", "Web", "--path", "/repos/web"], panel.dir, { env: { ORCA_DISPATCHED_RUN: "run-1", ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json" } });
    expect([neither.code, neither.stderr]).toEqual([1, "orca: control-cli-argument-invalid: give exactly one of --path <dir> and --dirs <id,id>\n"]);
    expect([both.code, both.stderr]).toEqual([1, "orca: control-cli-argument-invalid: give exactly one of --path <dir> and --dirs <id,id>\n"]);
    expect([mcp.code, mcp.json().body.error.code]).toEqual([1, "project-add-not-over-mcp"]);
    expect([marked.code, marked.stderr]).toEqual([1, "orca: control-dispatched-run-refused: orca project add is not done by a run Orca dispatched; a person registers a project, from the Web UI or an attended session\n"]);
    expect(posts(panel)).toEqual([]);
  });
});
