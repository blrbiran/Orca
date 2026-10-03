import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../../src/control/snapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { loop, snapshotOf, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Syncskill integration spec §10.5 / §10.8 C3, C4, C16 (plan Task 4). Confirm freezes each task's skill set into the
 * execution snapshot: names as declared, a profile as the (fake) syncskill answered it, normalised. A group without
 * skills spawns nothing and gets no `skills` key (its golden snapshot hash is pinned in executionSnapshot.test.ts).
 * Every refusal leaves the group unconfirmed. A snapshot entry that disagrees with the task's recipe blocks recovery.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const CLAUDE = { agent: FIXTURE_OTHER_AGENT_ID };
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}
/** A fake syncskill (tests/skills/fixtures/fake-syncskill.mjs) answering in `mode`, its argv logged per call. */
async function fakeSyncskill(mode: string) {
  const dir = await tempDir("orca-confirm-skills-");
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const log = join(dir, "calls.jsonl");
  const o: SyncskillOptions = { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_MODE: mode, FAKE_SYNCSKILL_LOG: log } };
  const calls = (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]) : []);
  return { o, calls };
}
const withSkills = (taskId: string, skills: unknown) => ({ ...loop(taskId), skills });

async function confirmWith(tasks: Parameters<typeof webFixture>[1], syncskill: SyncskillOptions | undefined) {
  const h = await webFixture(undefined, tasks);
  cleanups.push(() => h.dispose());
  const service = new WebControlService(syncskill === undefined ? h.deps : { ...h.deps, syncskill });
  const answer = await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service, answer };
}
function confirmedOrThrow(answer: unknown): void {
  if (typeof answer !== "object" || answer === null || "error" in answer) throw new Error(JSON.stringify(answer));
}
/** The refusal left nothing behind: the proposal is not confirmed and no task was made ready. */
function expectUnconfirmed(h: Awaited<ReturnType<typeof webFixture>>, taskIds: string[]): void {
  const proposal = readBudgetProposal(h.store, "g");
  expect(proposal.state).not.toBe("confirmed");
  expect(proposal.executionSnapshotHash).toBe(null);
  for (const taskId of taskIds) expect(workBody(h, taskId).status).not.toBe("ready");
}

describe("confirm freezes each task's skill set (C3)", () => {
  it("freezes a profile's members as the fake syncskill answered them, sorted and de-duplicated", async () => {
    const fake = await fakeSyncskill("profile-dupes"); // answers ["beta", "alpha", "beta"]
    const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) }], fake.o);
    confirmedOrThrow(answer);
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "p", names: ["alpha", "beta"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: "p", names: ["alpha", "beta"] });
    expect(fake.calls()).toEqual([["--json", "--no-refresh", "profile", "ls", "p"]]);
  });

  it("freezes declared names without spawning syncskill", async () => {
    const fake = await fakeSyncskill("profile-ok");
    const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { names: ["b", "a"] }) }], fake.o);
    confirmedOrThrow(answer);
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: null, names: ["a", "b"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: null, names: ["a", "b"] });
    expect(fake.calls()).toEqual([]);
  });

  it("looks a profile up once however many tasks share it, and gives a task without skills no entry", async () => {
    const fake = await fakeSyncskill("profile-ok");
    const { h, answer } = await confirmWith([
      { taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) },
      { taskId: "b", agent: CLAUDE, loop: withSkills("b", { profile: "p" }) },
      { taskId: "c", loop: loop("c") },
    ], fake.o);
    confirmedOrThrow(answer);
    expect(snapshotOf(h).skills).toEqual([
      { taskId: "a", profile: "p", names: ["alpha", "beta"] },
      { taskId: "b", profile: "p", names: ["alpha", "beta"] },
    ]);
    expect(fake.calls()).toEqual([["--json", "--no-refresh", "profile", "ls", "p"]]);
    expect(readConfirmedTaskExecution(h.store, "g", "c").skills).toBe(null);
  });

  it("a group without skills spawns nothing and its snapshot has no skills key", async () => {
    const fake = await fakeSyncskill("profile-ok");
    const { h, answer } = await confirmWith([{ taskId: "a", loop: loop("a") }, { taskId: "b" }], fake.o);
    confirmedOrThrow(answer);
    expect(Object.keys(snapshotOf(h))).not.toContain("skills");
    expect(fake.calls()).toEqual([]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toBe(null);
  });
});

describe("confirm refuses, and the group stays unconfirmed (C4)", () => {
  it("syncskill-unconfigured: a profile with ORCA_SYNCSKILL_BIN unset, or with no syncskill deps at all", async () => {
    for (const syncskill of [{ bin: null, env: {} }, undefined]) {
      const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) }], syncskill);
      expect(answer).toMatchObject({ error: { code: "syncskill-unconfigured" } });
      expectUnconfirmed(h, ["a"]);
    }
  });

  it("syncskill-unconfigured: a task that only names its skills, with ORCA_SYNCSKILL_BIN unset or no syncskill deps", async () => {
    // Spec §4.2 / §10.5: names need no lookup, but the run will need syncskill to inject them, so confirm refuses now.
    for (const syncskill of [{ bin: null, env: {} }, undefined]) {
      const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { names: ["x"] }) }], syncskill);
      expect(answer).toMatchObject({ error: { code: "syncskill-unconfigured" } });
      expectUnconfirmed(h, ["a"]);
    }
  });

  it("syncskill-failed:E_PROFILE_NOT_FOUND: syncskill's own error code is named", async () => {
    const fake = await fakeSyncskill("profile-missing");
    const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) }], fake.o);
    expect(answer).toMatchObject({ error: { code: "syncskill-failed", message: "syncskill-failed:E_PROFILE_NOT_FOUND" } });
    expectUnconfirmed(h, ["a"]);
  });

  it("skills-profile-empty: a profile with no members", async () => {
    const fake = await fakeSyncskill("profile-empty");
    const { h, answer } = await confirmWith([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) }], fake.o);
    expect(answer).toMatchObject({ error: { code: "skills-profile-empty" } });
    expectUnconfirmed(h, ["a"]);
  });

  it("decides a lookup failure after the existing checks: a stale proposal version is named first", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { profile: "p" }) }]);
    cleanups.push(() => h.dispose());
    const payload = await h.confirmPayload();
    const answer = await new WebControlService(h.deps).confirm(h.command("confirm", { ...payload, proposalVersion: payload.proposalVersion + 1 }));
    expect(answer).toMatchObject({ error: { code: "proposal-version-conflict" } });
  });
});

/**
 * A snapshot rewritten whole -- a new canonical record under its own hash, with the proposal and group pointing at it --
 * so readCanonicalRecord's byte and hash checks pass and only the skills comparison can refuse it.
 */
function rewriteSnapshot(h: Awaited<ReturnType<typeof webFixture>>, edit: (snapshot: Record<string, unknown>) => void): void {
  const proposal = readBudgetProposal(h.store, "g");
  const snapshot = JSON.parse(readCanonicalRecord(h.store, proposal.executionSnapshotHash!)) as Record<string, unknown>;
  edit(snapshot);
  const parsed = executionSnapshotSchema.parse(snapshot);
  const hash = sha256Canonical(parsed);
  writeCanonicalRecord(h.store, "g", hash, canonicalBytes(parsed).toString("utf8"));
  h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes({ ...proposal, executionSnapshotHash: hash }).toString("utf8"));
  const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  group.proposal.executionSnapshotHash = hash;
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
}
type SkillEntry = { taskId: string; profile: string | null; names: string[] };

describe("a tampered skills entry blocks recovery (C16)", () => {
  async function confirmedPair() {
    const fake = await fakeSyncskill("profile-ok");
    const { h, answer } = await confirmWith([
      { taskId: "a", loop: withSkills("a", { names: ["x"] }) },
      { taskId: "b", loop: loop("b") },
      { taskId: "c", agent: CLAUDE, loop: withSkills("c", { profile: "p" }) },
    ], fake.o);
    confirmedOrThrow(answer);
    return h;
  }

  it("rewritten names", async () => {
    const h = await confirmedPair();
    rewriteSnapshot(h, (s) => { (s.skills as SkillEntry[])[0]!.names = ["y"]; });
    expect(() => readConfirmedTaskExecution(h.store, "g", "a")).toThrow("recovery-blocked");
    // The rewrite itself is accepted: the untouched tasks still read.
    expect(readConfirmedTaskExecution(h.store, "g", "b").skills).toBe(null);
    expect(readConfirmedTaskExecution(h.store, "g", "c").skills).toEqual({ profile: "p", names: ["alpha", "beta"] });
  });

  it("a names entry given a profile", async () => {
    const h = await confirmedPair();
    rewriteSnapshot(h, (s) => { (s.skills as SkillEntry[])[0]!.profile = "p"; });
    expect(() => readConfirmedTaskExecution(h.store, "g", "a")).toThrow("recovery-blocked");
  });

  it("a rewritten profile name", async () => {
    const h = await confirmedPair();
    rewriteSnapshot(h, (s) => { (s.skills as SkillEntry[])[1]!.profile = "q"; });
    expect(() => readConfirmedTaskExecution(h.store, "g", "c")).toThrow("recovery-blocked");
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: null, names: ["x"] });
  });

  it("a deleted entry", async () => {
    const h = await confirmedPair();
    rewriteSnapshot(h, (s) => { s.skills = (s.skills as SkillEntry[]).filter((e) => e.taskId !== "a"); });
    expect(() => readConfirmedTaskExecution(h.store, "g", "a")).toThrow("recovery-blocked");
    expect(readConfirmedTaskExecution(h.store, "g", "c").skills).not.toBe(null);
  });

  it("an entry added for a task without skills", async () => {
    const h = await confirmedPair();
    rewriteSnapshot(h, (s) => { s.skills = [...(s.skills as SkillEntry[]), { taskId: "b", profile: null, names: ["x"] }].sort((l, r) => (l.taskId < r.taskId ? -1 : 1)); });
    expect(() => readConfirmedTaskExecution(h.store, "g", "b")).toThrow("recovery-blocked");
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: null, names: ["x"] });
  });
});

describe("ORCA_SYNCSKILL_BIN reaches the web service (spec §10.5)", () => {
  it.each([
    ["set", "/opt/syncskill/bin/syncskill", "/opt/syncskill/bin/syncskill"],
    ["empty", "", null],
    ["unset", undefined, null],
  ] as const)("%s", async (_label, value, expected) => {
    const root = await tempDir("orca-syncskill-env-");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ...(value === undefined ? {} : { ORCA_SYNCSKILL_BIN: value }) };
    const { rejection, ...control } = resolveControlOptions(["--by", "t"], env, [{ projectKey: "proj", path: repo }]);
    expect(rejection).toBe(null);
    const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-syncskill", env });
    try {
      expect(runtime!.service.deps.syncskill).toEqual({ bin: expected, env });
    } finally { runtime!.close(); }
  });
});
