import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitChainRecord, commitMessage } from "../../src/chain/record.js";
import { readChainRecord } from "../../src/chain/recordSchema.js";
import { git } from "../../src/scheduler/gitExec.js";
import { recordFixture } from "../helpers/chainRecord.js";
import { tempRepo } from "../helpers/tempRepo.js";

const REL = ".orca/chains/chain-0000000a.json";

describe("chain record (D-launch spec §6.1)", () => {
  it("RC1 the first write adds the untracked file and commits only it, leaving staged and untracked work alone (review I2, review 7)", async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, "staged.txt"), "s\n");
    await git(repo, ["add", "--", "staged.txt"]);
    await writeFile(join(repo, "loose.txt"), "l\n");
    await commitChainRecord(repo, recordFixture(), commitMessage("chain-0000000a", "started"));
    expect((await git(repo, ["show", "--name-only", "--format=%s", "HEAD"])).trim().split("\n")).toEqual([
      "chore(chain): chain-0000000a, started",
      "",
      REL,
    ]);
    expect(await git(repo, ["status", "--porcelain"])).toBe("A  staged.txt\n?? loose.txt\n");
  });

  it("RC2 a later write replaces the file in a new commit and reads back equal", async () => {
    const repo = await tempRepo();
    await commitChainRecord(repo, recordFixture(), commitMessage("chain-0000000a", "started"));
    const stopped = recordFixture({ state: "stopped", stop: { reason: "done", category: "done", at: "2026-09-18T01:00:00.000Z", awaitingHuman: [], detail: "w" } });
    await commitChainRecord(repo, stopped, commitMessage("chain-0000000a", "session 1, done"));
    expect(await readChainRecord(repo, "chain-0000000a")).toEqual(stopped);
    expect((await git(repo, ["log", "--format=%s", "--", REL])).trim().split("\n")).toEqual([
      "chore(chain): chain-0000000a, session 1, done",
      "chore(chain): chain-0000000a, started",
    ]);
  });

  it("RC3 a git failure is record-commit-refused (exit 2) and leaves the file on disk", async () => {
    const repo = await tempRepo();
    // Plan PC-20: hooks never run for the supervisor, so the failure is made another way — a held index lock.
    await writeFile(join(repo, ".git", "index.lock"), "");
    await expect(commitChainRecord(repo, recordFixture(), "m")).rejects.toMatchObject({ code: "record-commit-refused", exitCode: 2 });
    expect(JSON.parse(await readFile(join(repo, REL), "utf8")).chainId).toBe("chain-0000000a");
  });

  it("RC6 the repository's pre-commit hook and fsmonitor never run for the supervisor's commit (plan PC-20, review I4)", async () => {
    const repo = await tempRepo();
    const trace = join(await mkdtemp(join(tmpdir(), "orca-trace-")), "trace.txt");
    await writeFile(join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\necho pre-commit >> '${trace}'\nexit 1\n`, { mode: 0o755 });
    const monitor = join(repo, ".git", "fsmonitor.sh");
    await writeFile(monitor, `#!/bin/sh\necho fsmonitor >> '${trace}'\nexit 1\n`, { mode: 0o755 });
    await git(repo, ["config", "core.fsmonitor", monitor]);
    await commitChainRecord(repo, recordFixture(), "m");
    expect((await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim()).toBe(REL);
    expect(existsSync(trace)).toBe(false);
  });

  it("RC4 a record the schema refuses is never written", async () => {
    const repo = await tempRepo();
    await expect(commitChainRecord(repo, recordFixture({ chainId: "chain-XYZ" }), "m")).rejects.toThrow();
    expect(existsSync(join(repo, ".orca", "chains"))).toBe(false);
  });

  it("RC5 reading a missing or broken record is refused by name", async () => {
    const repo = await tempRepo();
    await expect(readChainRecord(repo, "chain-0000000a")).rejects.toMatchObject({ code: "chain-not-found" });
    await commitChainRecord(repo, recordFixture(), "m");
    await writeFile(join(repo, REL), "{");
    await expect(readChainRecord(repo, "chain-0000000a")).rejects.toMatchObject({ code: "chain-record-invalid" });
  });
});
