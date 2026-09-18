import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chainStateDir, stopRequestPath } from "../../src/chain/paths.js";
import { commitChainRecord } from "../../src/chain/record.js";
import { requestStop, stopRequested } from "../../src/chain/stopRequest.js";
import { recordFixture } from "../helpers/chainRecord.js";
import { tempRepo } from "../helpers/tempRepo.js";

describe("stop requests (D-launch spec §2, review I10)", () => {
  it("Q1 a chain id of the wrong shape is refused before anything is touched", async () => {
    const repo = await tempRepo();
    await expect(requestStop(repo, "../../../escape")).rejects.toMatchObject({ code: "chain-id-invalid" });
    expect(existsSync(await chainStateDir(repo))).toBe(false);
  });
  it("Q2 a well-shaped id with no record is chain-not-found", async () => {
    const repo = await tempRepo();
    await expect(requestStop(repo, "chain-0000000a")).rejects.toMatchObject({ code: "chain-not-found" });
    expect(existsSync(await chainStateDir(repo))).toBe(false);
  });
  it("Q3 a stopped chain is chain-not-running", async () => {
    const repo = await tempRepo();
    await commitChainRecord(repo, recordFixture({ state: "stopped", stop: { reason: "done", category: "done", at: "2026-09-18T01:00:00.000Z", awaitingHuman: [], detail: null } }), "m");
    await expect(requestStop(repo, "chain-0000000a")).rejects.toMatchObject({ code: "chain-not-running" });
  });
  it("Q4 a running chain gets the request inside the git dir, where a session's cleanup cannot reach it", async () => {
    const repo = await tempRepo();
    await commitChainRecord(repo, recordFixture(), "m");
    expect(await stopRequested(repo, "chain-0000000a")).toBe(false);
    expect(await requestStop(repo, "chain-0000000a")).toBe(await stopRequestPath(repo, "chain-0000000a"));
    expect(await stopRequested(repo, "chain-0000000a")).toBe(true);
    expect((await stopRequestPath(repo, "chain-0000000a")).startsWith(`${repo}/.git/orca-chain/`)).toBe(true);
  });
});
