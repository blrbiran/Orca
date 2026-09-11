import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the web workspace (spec §2 / §1.2)", () => {
  it("registers web/ in the root workspaces array, so npm ci installs it in one command", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    // The literal array, not "is web reachable somehow": external review M3
    // rejected the elastic phrasing "an independent workspace" precisely
    // because it stayed true no matter what the file said.
    expect(root.workspaces).toEqual(["web"]);
  });

  it("keeps the os floor off the web workspace, because it does not transit", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    const web = JSON.parse(await readFile(join(repoRoot, "web", "package.json"), "utf8"));
    expect(root.os).toEqual(["darwin", "linux"]);
    // spec §9 item 2: npm does not propagate `os` into a workspace, so
    // claiming the floor here would be a claim nothing enforces.
    expect(web.os).toBeUndefined();
  });

  it("gives web/ no lockfile of its own — the root holds the only one", async () => {
    // Two lockfiles is the shape spec §1.2 measured that neither reference
    // repository has, and the whole "installs twice" cost chain the first
    // draft invented was built on top of it.
    await expect(readFile(join(repoRoot, "web", "package-lock.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(repoRoot, "package-lock.json"), "utf8")).resolves.toBeTypeOf("string");
  });

  it("runs the workspace check as part of verify, or a web-side type error ships unseen", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    expect(root.scripts.verify).toContain("npm run --ws check");
    const web = JSON.parse(await readFile(join(repoRoot, "web", "package.json"), "utf8"));
    expect(web.scripts.check).toBeTypeOf("string");
  });

  it("declares express as a runtime dependency, not a dev one", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    // The panel is shipped code; express in devDependencies would make
    // `npm ci --omit=dev` produce a binary that cannot start.
    expect(root.dependencies.express).toBeTypeOf("string");
    expect(root.devDependencies?.express).toBeUndefined();
  });
});
