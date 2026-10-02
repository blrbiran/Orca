import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git } from "../../src/scheduler/gitExec.js";
import { tempRepo } from "../helpers/tempRepo.js";

/** Memory tab spec §6.1. Every criterion that spawns a ccmem gets a temp data root and a temp HOME of its own (Rule 17). */
const FAKE = resolve("tests/memory/fixtures/fake-ccmem.mjs");
export const PROJECT_KEY = "example.invalid/o/r";

export const memoryRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1, scope: "global", project_key: null, type: "rule", content: "global one", pinned: 0, source: "user_explicit",
  trust_score: 0.5, tags: null, created_at: 1_790_000_000_000, updated_at: 1_790_000_000_000, ...over,
});

export interface FakeData { global: unknown[]; project: unknown[]; all: unknown[] }
const project = (id: number, content: string, key = PROJECT_KEY) => memoryRow({ id, scope: "project", project_key: key, type: "fact", content });
export const DEFAULT_FAKE_DATA: FakeData = {
  global: [memoryRow({ id: 1, content: "global one", pinned: 1, tags: "[\"style\"]" }), memoryRow({ id: 2, content: "global two" })],
  project: [project(3, "project three"), project(4, "project four")],
  // What ccmem prints for a --scope value it does not know: every project, including one this repo must never see.
  all: [memoryRow({ id: 1 }), memoryRow({ id: 2 }), project(3, "project three"), project(4, "project four"), project(99, "another project's secret", "other.invalid/x/y")],
};

export interface FakeCall { argv: string[]; cwd: string; env: { CCMEM_DATA_ROOT?: string; HOME?: string } }
export interface FakeCcmem { bin: string; dir: string; env: NodeJS.ProcessEnv; calls(): FakeCall[]; cleanup(): Promise<void> }

export async function fakeCcmem(opts: { mode?: string; data?: FakeData } = {}): Promise<FakeCcmem> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-fake-ccmem-")));
  const bin = join(dir, "ccmem");
  // process.execPath, not `node`: the wrapper must not depend on the PATH a criterion hands the adapter.
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const dataFile = join(dir, "data.json");
  await writeFile(dataFile, JSON.stringify(opts.data ?? DEFAULT_FAKE_DATA));
  const log = join(dir, "calls.jsonl");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: join(dir, "home"),
    CCMEM_DATA_ROOT: join(dir, "data-root"),
    FAKE_CCMEM_MODE: opts.mode ?? "ok",
    FAKE_CCMEM_DATA: dataFile,
    FAKE_CCMEM_LOG: log,
  };
  return {
    bin, dir, env,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as FakeCall) : []),
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

/** A temp git repository whose origin makes ccmem compute PROJECT_KEY. */
export async function memoryRepo(): Promise<string> {
  const repo = await tempRepo();
  await git(repo, ["remote", "add", "origin", `https://${PROJECT_KEY}.git`]);
  return repo;
}
