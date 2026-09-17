import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Checkpoint } from "../../src/checkpoint/schema.js";
import { SESSION } from "./transcript.js";

export function checkpointFixture(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    v: 1,
    runId: "orca-dev-0a1b2c3d",
    runtime: "claude-code",
    sessionRef: SESSION,
    writtenAt: "2026-09-17T00:00:00.000Z",
    head: "a".repeat(40),
    level: { kind: "reading", level: 340_000, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 1 },
    next: ["continue with the next task"],
    open: [],
    awaitingHuman: [],
    measurements: [],
    ...overrides,
  };
}

export async function putCheckpoint(repo: string, name: string, value: unknown): Promise<string> {
  const dir = join(repo, ".orca", "checkpoints");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
