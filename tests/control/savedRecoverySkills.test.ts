import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readDriverRun, savedRecoveryInspectionInput } from "../../src/control/executionDriver.js";
import { persistRecoveryArtifact } from "../../src/control/savedResultRecoveryPackage.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../../src/control/snapshot.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { readWorkClaimEnvelope } from "../../src/control/webDispatch.js";
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

/**
 * Syncskill integration spec §10.6, D3: a saved-result recovery's inspection input mirrors A2. The source run's envelope
 * named directories that no longer exist; the rebuilt one names the copy injected for the recovery run itself.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const CLAUDE = { agent: FIXTURE_OTHER_AGENT_ID };
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  const pending = cleanups.reverse();
  cleanups = [];
  const errors: unknown[] = [];
  for (const c of pending) { try { await c(); } catch (error) { errors.push(error); } }
  if (errors.length > 0) throw errors[0];
});

/** A2 leaves a snapshot read-only; the harness cannot dispose until its workspace root is writable again. */
function restoreWrite(path: string): void {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) return;
  chmodSync(path, (stat.mode & 0o777) | 0o200 | (stat.isDirectory() ? 0o100 : 0));
  if (stat.isDirectory()) for (const entry of readdirSync(path)) restoreWrite(join(path, entry));
}

async function fakeSyncskill(): Promise<{ o: SyncskillOptions; calls: () => string[][] }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-saved-recovery-skills-")));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const bin = join(dir, "syncskill"), modeFile = join(dir, "mode"), log = join(dir, "calls.jsonl");
  await writeFile(modeFile, "inject-ok");
  await writeFile(bin, `#!/bin/sh\nexport FAKE_SYNCSKILL_MODE="$(cat '${modeFile}')"\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  return {
    o: { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_LOG: log } },
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]) : []),
  };
}

const withSkills = (taskId: string, names: string[]) => ({ ...loop(taskId), skills: { names } });

/**
 * A `verify-saved-result` row whose controller never submitted accept: its source envelope, package and admission
 * artifacts are persisted, and its own work claim is frozen, so only the inspection input stands between it and a
 * dispatch. The source envelope's contract is the source run's old runtime -- never what the rebuild may reuse.
 */
function fabricateRecovery(h: Awaited<ReturnType<typeof driverHarness>>, sourceRunId: string): string {
  const store = h.h.store, source = h.body(sourceRunId), groupId = String(source.groupId), workItemId = String(source.workItemId);
  const runId = "recovery-run";
  const recoveryOf = { sourceRunId, sourceAttempt: 1, capsuleHash: "a".repeat(64), snapshotHash: "b".repeat(64), normalizedExecutionHash: "c".repeat(64) };
  const sourceEnvelope = persistRecoveryArtifact(store, { work: { kind: "loop", base: "d".repeat(40), contract: { context: { repoPath: "/source/workspace" } } } });
  const sourcePackage = persistRecoveryArtifact(store, { schema: "ccloop-saved-result-source-package-v1" });
  const admission = persistRecoveryArtifact(store, { schema: "ccloop-saved-result-admission-v1" });
  const policy = persistRecoveryArtifact(store, { schema: "ccloop-recovery-policy-authority-v1" });
  const amount = { tokens: 10, activeMs: 0, attempts: 1, sessions: 1 };
  const funding = {
    kind: "legacy-fresh-grant-v1", inheritedUsage: amount,
    reservation: { runId, revision: 1, workAllocationId: "work-allocation", handoffAllocationId: "handoff-allocation" },
    historicalPolicy: { contractHash: "e".repeat(64), authority: policy, accountingMode: "finite-legacy", authoredWork: amount },
    freshGrant: { work: amount, handoff: amount }, fundedTotal: amount,
  };
  const body = {
    ...source, runId, mode: "verify-saved-result", recoveryOf, executionId: null, state: "start-pending",
    savedRecovery: {
      recoveryOf, source: { authorityKind: "legacy-published-candidate-v1", source: sourcePackage, attempt: 1 },
      sourceEnvelope, admission, funding, currentRunId: sourceRunId, predecessor: null, artifacts: [], revision: 1,
    },
    savedDispatch: { state: "never-submitted", admissionHash: admission.hash, fundingHash: sha256Canonical(funding), revision: 1, envelopeHash: null },
  };
  delete (body as { drive?: unknown }).drive;
  // A recovery claim is made only after the source run left the active slot (savedResultRecovery.ts).
  store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(sourceRunId);
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)").run(runId, groupId, workItemId, JSON.stringify(body));
  const claim = readWorkClaimEnvelope(store, groupId, sourceRunId);
  const recoveryClaim = { ...claim, runId, claimOrdinal: (claim.claimOrdinal ?? 0) + 1, claimIdentity: `recovery:${runId}` };
  const envelopeHash = sha256Canonical(recoveryClaim);
  writeCanonicalRecord(store, groupId, envelopeHash, canonicalBytes(recoveryClaim).toString());
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'work-claim',?,0)").run(`work:${groupId}:${runId}`, canonicalBytes({ groupId, workItemId, runId, envelopeHash, sessionReservation: 1, attemptReservation: 0 }).toString());
  return runId;
}

async function harness(tasks: Parameters<typeof driverHarness>[0], fake: Awaited<ReturnType<typeof fakeSyncskill>>, options: HarnessOptions = {}) {
  const t = await driverHarness(tasks, { ...options, syncskill: fake.o });
  cleanups.push(() => t.h.dispose());
  cleanups.push(() => restoreWrite(`${t.h.store.stateDir}.workspaces`));
  return t;
}

describe("a saved-result recovery's inspection input", { timeout: 60_000 }, () => {
  it("injects the frozen skills for the recovery run and names that copy in the envelope", async () => {
    const fake = await fakeSyncskill();
    const t = await harness([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", ["alpha"]) }], fake);
    const runId = fabricateRecovery(t, await t.claim());
    const envelope = await savedRecoveryInspectionInput(t.deps, readDriverRun(t.h.store, runId));
    const dir = await realpath(`${t.h.store.stateDir}.workspaces/skills-${runId}`);
    expect((envelope.work as { skillPluginDir?: string }).skillPluginDir).toBe(dir);
    expect(readFileSync(join(dir, "skills", "alpha", "SKILL.md"), "utf8")).toBe("# alpha\n");
    expect(fake.calls()).toEqual([["--json", "inject", "--skills", "alpha", "--target", join(dir, "skills")]]);
    const recorded = readDriverRun(t.h.store, runId);
    expect(recorded.drive?.skills?.dir).toBe(dir);
    // The rebuilt contract is the frozen one pointed at this run's workspace, never the source envelope's runtime.
    expect((envelope.work as { contract: { context: { repoPath: string } } }).contract.context.repoPath).toBe(recorded.drive!.workspacePath);
    expect(recorded.savedDispatch).toMatchObject({ state: "never-submitted", envelopeHash: sha256Canonical(envelope) });
    expect(JSON.parse(readCanonicalRecord(t.h.store, recorded.drive!.envelopeHash!))).toEqual(envelope);
  });

  it("keeps a recovery run without skills byte-identical to a plain rebuild", async () => {
    const fake = await fakeSyncskill();
    const t = await harness([{ taskId: "a", agent: CLAUDE, loop: loop("a") }], fake);
    const runId = fabricateRecovery(t, await t.claim());
    const envelope = await savedRecoveryInspectionInput(t.deps, readDriverRun(t.h.store, runId));
    expect(Object.keys(envelope.work).sort()).toEqual(["base", "contract", "kind", "sourceDir", "targetRepo"]);
    expect(readDriverRun(t.h.store, runId).drive?.skills).toBe(null);
    expect(fake.calls()).toEqual([]);
  });
});
