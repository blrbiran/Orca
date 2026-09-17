import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCovering } from "../../src/checkpoint/covering.js";
import { runIdFor } from "../../src/checkpoint/schema.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { SESSION } from "../helpers/transcript.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-covering-"));
const BAND2 = { kind: "reading" as const, level: 460_000, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 2 as const };

describe("findCovering (D spec 9, item 10: covered by band)", () => {
  it("returns the highest band this session has a checkpoint for", async () => {
    const repo = await tempDir();
    const p2 = await putCheckpoint(repo, "a.json", checkpointFixture({ level: BAND2 }));
    await putCheckpoint(repo, "b.json", checkpointFixture());
    expect(await findCovering(repo, SESSION)).toEqual({ covering: { path: p2, band: 2 }, problems: [] });

    // Order independence: the band-2 checkpoint can also be the one that sorts last.
    const repo2 = await tempDir();
    await putCheckpoint(repo2, "a.json", checkpointFixture());
    const q2 = await putCheckpoint(repo2, "b.json", checkpointFixture({ level: BAND2 }));
    expect(await findCovering(repo2, SESSION)).toEqual({ covering: { path: q2, band: 2 }, problems: [] });
  });

  it("does not let another session's checkpoint cover this one", async () => {
    const repo = await tempDir();
    await putCheckpoint(repo, "a.json", checkpointFixture({ sessionRef: "ffffffff-0000-4000-8000-000000000000", level: BAND2 }));
    expect(await findCovering(repo, SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("a band-0 or no-reading checkpoint covers nothing", async () => {
    const repo = await tempDir();
    await putCheckpoint(repo, "a.json", checkpointFixture({ level: { ...BAND2, level: 10, band: 0 } }));
    await putCheckpoint(repo, "b.json", checkpointFixture({ level: { kind: "no-reading", reason: "x" } }));
    expect(await findCovering(repo, SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("names an unreadable checkpoint as a problem and still reads the rest", async () => {
    const repo = await tempDir();
    const bad = await putCheckpoint(repo, "a-bad.json", "{");
    const good = await putCheckpoint(repo, "b.json", checkpointFixture());
    const found = await findCovering(repo, SESSION);
    expect(found.covering).toEqual({ path: good, band: 1 });
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0].startsWith(`${bad}: `)).toBe(true);
  });

  it("no checkpoint directory means no covering and no problem", async () => {
    expect(await findCovering(await tempDir(), SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("names a run by the first eight hex digits of the session, and refuses a session that has none", () => {
    expect(runIdFor(SESSION)).toBe("orca-dev-0a1b2c3d");
    expect(runIdFor("session-0a1b2c3d")).toBeNull();
  });
});
