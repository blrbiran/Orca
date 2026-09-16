import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Ruling R17's triage, made mechanical. The five advisories `npm audit`
 * reports (3 moderate / 1 high / 1 critical, all measured 2026-09-16) are the
 * vitest / vite / esbuild chain, and every one of them is reachable only
 * through a test runner or a dev server this repository never starts in
 * production: the panel serves a built `web/dist` over `node:http`.
 *
 * That argument is only worth anything while the chain stays out of what a
 * production install pulls, which is what this names. `npm audit` itself is
 * not the criterion -- it needs the network, and `npm run verify` must not.
 */
const AUDITED_CHAIN = ["vite", "vitest", "vite-node", "@vitest/mocker", "esbuild"];

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
type Lock = { packages: Record<string, { dev?: boolean }> };

/** Every audited package a `npm ci --omit=dev` install would still bring in. */
function shippedAuditedPackages(manifests: Manifest[], lock: Lock): string[] {
  const shipped = new Set<string>();
  for (const m of manifests) {
    for (const name of Object.keys(m.dependencies ?? {})) {
      if (AUDITED_CHAIN.includes(name)) shipped.add(name);
    }
  }
  // A lock entry is keyed by its install path: "node_modules/vite",
  // "web/node_modules/esbuild", "node_modules/vite/node_modules/esbuild". The
  // name is whatever follows the LAST "node_modules/", so a nested copy is
  // read as the package it is, not as its parent.
  for (const [path, entry] of Object.entries(lock.packages)) {
    const marker = path.lastIndexOf("node_modules/");
    if (marker === -1) continue;
    const name = path.slice(marker + "node_modules/".length);
    if (AUDITED_CHAIN.includes(name) && entry.dev !== true) shipped.add(name);
  }
  return [...shipped].sort();
}

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

  // The must-catch sample. Without it, `shippedAuditedPackages` could return
  // [] for every input and the criterion below would stay green forever --
  // which is the shape a scanner fails in, not a shape anyone notices.
  it("names an audited package that a production install WOULD pull in, by either route", () => {
    const shipped = shippedAuditedPackages(
      [{ dependencies: { vitest: "^2.0.5" }, devDependencies: { typescript: "^5.5.4" } }],
      { packages: { "node_modules/esbuild": {}, "node_modules/vite": { dev: true } } },
    );
    // esbuild by a lock entry that is not dev-only, vitest by a manifest that
    // declares it a runtime dependency; vite is dev-only and must NOT appear.
    expect(shipped).toEqual(["esbuild", "vitest"]);
  });

  it("keeps the audited vite/vitest chain dev-only, so `npm ci --omit=dev` ships none of it (ruling R17)", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as Manifest;
    const web = JSON.parse(await readFile(join(repoRoot, "web", "package.json"), "utf8")) as Manifest;
    const lock = JSON.parse(await readFile(join(repoRoot, "package-lock.json"), "utf8")) as Lock;
    expect(shippedAuditedPackages([root, web], lock)).toEqual([]);
  });

  it("declares express as a runtime dependency, not a dev one", async () => {
    const root = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    // The panel is shipped code; express in devDependencies would make
    // `npm ci --omit=dev` produce a binary that cannot start.
    expect(root.dependencies.express).toBeTypeOf("string");
    expect(root.devDependencies?.express).toBeUndefined();
  });
});
