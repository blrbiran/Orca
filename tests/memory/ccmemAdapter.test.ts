import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryError } from "../../src/memory/adapter.js";
import { createCcmemAdapter } from "../../src/memory/ccmem.js";
import { type FakeCcmem, PROJECT_KEY, fakeCcmem, memoryRepo } from "./helpers.js";

/**
 * Spec §3. The adapter is the only place Orca starts ccmem, so each of its promises is pinned on what the fake was
 * actually called with, not on what the adapter returns: the exact argv (a wrong --scope makes ccmem export every
 * project), the cwd (ccmem computes the project key from it), the env (only the one the panel was given, so a
 * criterion's relocation holds), and that a missing or relative ORCA_CCMEM_BIN starts nothing at all.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });
async function world(mode?: string) {
  const fake = await fakeCcmem({ mode });
  const repo = await memoryRepo();
  cleanups.push(fake.cleanup, () => rm(repo, { recursive: true, force: true }));
  return { fake, scope: { projectKey: "panel-key", repoPath: repo } };
}
const adapterFor = (fake: FakeCcmem, over: { ccmemBin?: string | null; timeoutMs?: number; maxBufferBytes?: number } = {}) =>
  createCcmemAdapter({ ccmemBin: fake.bin, env: fake.env, ...over });
async function refusal(p: Promise<unknown>): Promise<MemoryError> {
  return p.then(
    () => { throw new Error("expected a refusal, got a value"); },
    (err: unknown) => { if (err instanceof MemoryError) return err; throw err; },
  );
}

describe("the ccmem adapter's calls (spec §3.1-§3.3)", () => {
  it("runs export --json --scope global, then --scope project, and nothing else (M1)", async () => {
    const { fake, scope } = await world();
    const page = await adapterFor(fake).search(scope, { query: "", limit: 50 });
    expect(fake.calls().map((c) => c.argv)).toEqual([["export", "--json", "--scope", "global"], ["export", "--json", "--scope", "project"]]);
    expect(page.records.map((r) => r.ref).sort()).toEqual(["1", "2", "3", "4"]);
    expect(page.records.some((r) => r.content.includes("another project"))).toBe(false);
  });

  it("starts ccmem in the repository, so ccmem computes the project key itself (M2)", async () => {
    const { fake, scope } = await world();
    await adapterFor(fake).search(scope, { query: "", limit: 50 });
    expect(fake.calls().map((c) => c.cwd)).toEqual([scope.repoPath, scope.repoPath]);
  });

  it("hands ccmem the env it was given, not this process's (M3)", async () => {
    const { fake, scope } = await world();
    expect(process.env.CCMEM_DATA_ROOT).not.toBe(fake.env.CCMEM_DATA_ROOT); // relocateCcmem.ts set a different one
    process.env.ORCA_T4_SENTINEL = "leak"; // nothing of this process's env may be added either
    try { await adapterFor(fake).search(scope, { query: "", limit: 50 }); } finally { delete process.env.ORCA_T4_SENTINEL; }
    expect(fake.calls()).toHaveLength(2);
    for (const call of fake.calls()) expect(call.env).toEqual({ CCMEM_DATA_ROOT: fake.env.CCMEM_DATA_ROOT, HOME: fake.env.HOME, ORCA_T4_SENTINEL: null });
  });

  it("keeps ccmem's own project key on project rows", async () => {
    const { fake, scope } = await world();
    const page = await adapterFor(fake).search(scope, { query: "project three", limit: 50 });
    expect(page.records).toMatchObject([{ ref: "3", scope: "project", projectKey: PROJECT_KEY }]);
  });
});

describe("get (spec §2.2)", () => {
  it("reads a global and a project ref, and not one that only another project can see (M10)", async () => {
    const { fake, scope } = await world();
    const adapter = adapterFor(fake);
    expect((await adapter.get(scope, "1"))?.content).toBe("global one");
    expect((await adapter.get(scope, "4"))?.content).toBe("project four");
    expect(await adapter.get(scope, "99")).toBeNull();
  });
});

describe("failures (spec §3.3)", () => {
  it("names the exit code, the scope and ccmem's stderr (M5)", async () => {
    const { fake, scope } = await world("exit:3");
    const err = await refusal(adapterFor(fake).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-failed:3");
    expect(err.message).toContain("--scope global");
    expect(err.message).toContain("failing on purpose");
    expect(fake.calls()).toHaveLength(1); // the first failure ends the request: no half result
  });

  it("maps a signal death to ccmem-failed:<signal>", async () => {
    const { fake, scope } = await world("kill:SIGKILL");
    expect((await refusal(adapterFor(fake).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-failed:SIGKILL");
  });

  it("names a spawn errno it has no code of its own for, with Node's message, and starts nothing (C1)", async () => {
    // A cwd that is a regular file: Node throws ENOTDIR from execFile itself (v22.13.1), deterministically.
    const { fake, scope } = await world();
    const file = join(scope.repoPath, "not-a-directory");
    await writeFile(file, "");
    const err = await refusal(adapterFor(fake).search({ ...scope, repoPath: file }, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-failed:ENOTDIR");
    expect(err.message).toContain("--scope global");
    expect(err.message).toContain("spawn ENOTDIR"); // Node's own message, since ccmem wrote no stderr
    expect(fake.calls()).toEqual([]);
  });

  it("names an errno libuv has no name for by its errno name, so the wire code has no spaces", async () => {
    // An executable with no #! and no binary format: Node throws code "Unknown system error -8", errno -8 (v22.13.1, macOS).
    const { fake, scope } = await world();
    const bin = join(fake.dir, "not-a-program");
    await writeFile(bin, "not a program\n", { mode: 0o755 });
    const err = await refusal(adapterFor(fake, { ccmemBin: bin }).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-failed:ENOEXEC");
    expect(err.message).toContain("Unknown system error -8"); // Node's own message is kept
  });

  it("gives up at the timeout, promptly (M6)", async () => {
    const { fake, scope } = await world("sleep");
    const started = Date.now();
    const err = await refusal(adapterFor(fake, { timeoutMs: 200 }).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("refuses output past the cap (M7)", async () => {
    const { fake, scope } = await world("huge");
    expect((await refusal(adapterFor(fake, { maxBufferBytes: 64 * 1024 }).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-output-too-large");
  });

  it.each(["garbage", "extra-field", "bad-enum", "bad-tags", "wrong-scope"])("refuses %s output as ccmem-output-invalid (M8)", async (mode) => {
    const { fake, scope } = await world(mode);
    const err = await refusal(adapterFor(fake).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-output-invalid");
    expect(err.message).toContain("--scope global");
  });
});

describe("finding ccmem (spec §3.4, §10 D5)", () => {
  it("starts nothing when ORCA_CCMEM_BIN is unset", async () => {
    const { fake, scope } = await world();
    const adapter = adapterFor(fake, { ccmemBin: null });
    expect(await adapter.health()).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    expect((await refusal(adapter.search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
    expect(fake.calls()).toEqual([]);
  });

  it("starts nothing for a relative path, even one the repository provides (Review Focus 1)", async () => {
    const { fake, scope } = await world();
    await writeFile(join(scope.repoPath, "ccmem"), `#!/bin/sh\nexec '${fake.bin}' "$@"\n`, { mode: 0o755 });
    for (const bin of ["ccmem", "./ccmem"]) {
      const adapter = adapterFor(fake, { ccmemBin: bin });
      expect(await adapter.health()).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
      expect((await refusal(adapter.search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
    }
    expect(fake.calls()).toEqual([]);
  });

  it("reports a path that is missing, a directory, or not executable, without starting it", async () => {
    const { fake } = await world();
    await chmod(join(fake.dir, "data.json"), 0o644);
    for (const bin of [join(fake.dir, "absent"), fake.dir, join(fake.dir, "data.json")]) {
      expect(await adapterFor(fake, { ccmemBin: bin }).health(), bin).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    }
    expect(await adapterFor(fake).health()).toEqual({ status: "ok" });
    expect(fake.calls()).toEqual([]);
  });

  it("maps a non-executable path to ccmem-missing at spawn time (EACCES)", async () => {
    const { fake, scope } = await world();
    const bin = join(fake.dir, "data.json");
    await chmod(bin, 0o644);
    expect((await refusal(adapterFor(fake, { ccmemBin: bin }).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
    expect(fake.calls()).toEqual([]);
  });

  it("maps a path that vanished after health to ccmem-missing", async () => {
    const { fake, scope } = await world();
    expect((await refusal(adapterFor(fake, { ccmemBin: join(fake.dir, "absent") }).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
  });

  it("answers read-only capabilities", async () => {
    const { fake } = await world();
    expect(adapterFor(fake).capabilities()).toEqual({ search: true, get: true, recordCorrection: false });
  });
});
