// Tester #287 (follow-up J): `orca status` said "pinned and installed" from the lockfile alone while node_modules/ccloop/dist
// had been built from another commit. ccloop 9c83b38 writes dist/build-info.json {commit, builtAt}; the check compares it
// with the pin. Why it matters: a stale dist runs old ccloop code under a pin that claims the new one.
// - missing file: a warning (a dist built before build-info cannot be verified);
// - commit null: a warning (unverifiable); another commit: a failure naming both; the pin's commit: ok.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ccloopPinCheck } from "../../src/commands/status.js";

const PIN = "9c83b3898bbc72338c14eec5580d12c04294b273", OTHER = "26b3127aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function checkout(buildInfo: unknown | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "orca-build-info-")); roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { ccloop: `github:example/ccloop#${PIN}` } }));
  mkdirSync(join(root, "node_modules", "ccloop", "dist"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { "node_modules/ccloop": { resolved: `git+ssh://git@github.com/example/ccloop.git#${PIN}` } } }));
  if (buildInfo !== undefined) writeFileSync(join(root, "node_modules", "ccloop", "dist", "build-info.json"), JSON.stringify(buildInfo));
  return root;
}
const check = (root: string) => ccloopPinCheck({ env: {}, checkout: root });

describe("orca status checks the ccloop build against the pin (#287)", () => {
  it("is ok only when dist/build-info.json names the pinned commit", async () => {
    expect(await check(checkout({ commit: PIN, builtAt: "2026-11-13T14:03:57.298Z" }))).toMatchObject({ level: "ok", subject: "ccloop" });
  });
  it("fails naming both commits when the dist was built from another one", async () => {
    // mutation (no build-info comparison) -> red here: ok.
    const result = await check(checkout({ commit: OTHER, builtAt: "2026-11-01T00:00:00.000Z" }));
    expect(result).toMatchObject({ level: "fail", subject: "ccloop", fix: "npm install" });
    expect(result.fact).toContain(PIN.slice(0, 7));
    expect(result.fact).toContain(OTHER.slice(0, 7));
  });
  it("warns that a dist with no build-info, or with commit null, cannot be verified", async () => {
    // mutation (missing file treated as ok) -> red here.
    const missing = await check(checkout(undefined));
    expect(missing).toMatchObject({ level: "warn", subject: "ccloop" });
    expect(missing.fact).toContain("built before build-info; cannot verify");
    // mutation (commit null treated as ok or as a mismatch) -> red here.
    const unknown = await check(checkout({ commit: null, builtAt: "2026-11-13T14:03:57.298Z" }));
    expect(unknown).toMatchObject({ level: "warn", subject: "ccloop" });
    expect(unknown.fact).toContain("cannot verify");
  });
});
