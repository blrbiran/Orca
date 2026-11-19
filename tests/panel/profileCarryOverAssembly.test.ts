import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyProfileHash } from "../../src/control/profiles.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot } from "../control/fixtures/web.js";

// #381 (session 3ba26002, human rulings 4 and 6): the panel start records the carry-over before its router resolves
// anything, so a binding frozen under the legacy hash of the file as it was still resolves after the file's preflight
// and secrets are edited, and the secret change is said once on stderr. The control directory is under the scoped
// TMPDIR (Rule 17).
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function start(root: string, file: string) {
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const { rejection, ...control } = resolveControlOptions(["--by", "t", "--profile", file], { ORCA_CONTROL_DIR: join(root, "control") }, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const assembled = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-carry", env: {} });
  expect(assembled).not.toBe(null);
  return assembled!;
}

describe("panel start carries legacy profile bindings over (#381)", () => {
  it("resolves the earlier file's legacy hash after the preflight and a secret were edited, and notes the secret once", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-carry-")));
    roots.push(root);
    const file = join(root, "profile.json");
    const before: ExecutionProfileSnapshotV1 = profileSnapshot();
    before.resolved.secretValueHashes = [{ name: "/token", valueHash: "a".repeat(64) }];
    await writeFile(file, JSON.stringify(before), { mode: 0o600 });
    (await start(root, file)).close();

    const after = structuredClone(before);
    after.profile.estimatorPreflight = { maxOutputTokens: 32_000 };
    after.resolved.secretValueHashes = [{ name: "/token", valueHash: "b".repeat(64) }];
    await writeFile(file, JSON.stringify(after));
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    const runtime = await start(root, file);
    try {
      const resolved = runtime.router.resolve("budget-estimate", "all", legacyProfileHash(before));
      expect(resolved.snapshot.profile.estimatorPreflight).toEqual({ maxOutputTokens: 32_000 });
      expect(lines.filter((line) => line.includes("secret values changed"))).toEqual(["orca-control: profile all: secret values changed since the last start: /token\n"]);
      expect((await readdir(runtime.store.stateDir)).filter((name) => name.startsWith("control.sqlite.bak.")).length).toBe(2);
    } finally { runtime.close(); }
  });
});
