/**
 * Task 10 step 4: the web ledger's frozen dispatch bytes against a real ccloop consumer, with no
 * provider anywhere.
 *
 * Two consumers appear here. The shipped CLI (`ORCA_CCLOOP_BIN`) is asked only the questions it can
 * answer without launching a worker -- what it can prove, and whether an envelope parses -- so the
 * claims the ledger gates on come from the adapter itself rather than from this file. The protocol
 * fixture (`tests/control/fixtures/fake-ccloop-control.mjs`) is the deterministic worker stand-in:
 * a genuine child process speaking genuine V1 protocol, so accept, handoff, collect and
 * read-evidence are proven over a pipe and a recorded stdin instead of a stub.
 *
 * What is NOT here, and cannot be: a production process that turns the ledger's
 * `orca-dispatch-envelope-v1` into a ccloop `StartEnvelopeV1` and runs the worker. That translation
 * is performed in this file, so what it proves is the envelope, not a deployed executor.
 */
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { dispatchEnvelopeSchema, type CapabilityViewV1, type DispatchEnvelopeV1 } from "../../src/control/webProtocol.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import type { ControlStore } from "../../src/control/store.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

const realBinary = process.env.ORCA_CCLOOP_BIN;
const fixtureCli = resolve("tests/control/fixtures/fake-ccloop-control.mjs");
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** A confirmed group whose profiles probe exactly as the shipped adapter does. */
async function confirmedByAdapter(budgetMode: "strict" | "soft", probe: CapabilityViewV1) {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  f.setObserved(probe);
  const service = new WebControlService(f.deps);
  const confirmed = await service.confirm(f.command("confirm", { ...f.confirmPayload(), budgetMode }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const deps = { store: f.store, profileRouter: f.deps.profileRouter, admissionGate: f.deps.admissionGate };
  return { f, service, deps };
}

/** The envelope the ledger froze for a claimed run, addressed through its outbox row. */
function frozenEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${groupId}:${runId}`);
  if (!row) throw new Error(`no work-claim outbox row for ${runId}`);
  const { envelopeHash } = JSON.parse(String(row.body)) as { envelopeHash: string };
  return dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, envelopeHash)));
}

function runBody(store: ControlStore, runId: string): Record<string, unknown> {
  return JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
}

/**
 * What the ledger's frozen identity becomes on the wire. The translation used to live here, which
 * made a test fixture the production consumer of the ledger; it now lives in
 * `src/control/startEnvelope.ts` and this is a thin adapter to that function's signature, so the
 * two cannot drift.
 */
function startEnvelope(envelope: DispatchEnvelopeV1, run: Record<string, unknown>, sourceDir: string, contract: unknown): StartEnvelope {
  return toStartEnvelope(envelope, run, { sourceDir, targetRepo: sourceDir, base: "v1" }, contract);
}

/** The contract a plan import accepts, so the consumer's own schema has something real to parse. */
function loopContract(taskId: string): Record<string, unknown> {
  return {
    objective: { taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
    context: { repoPath: ".", targetPaths: [`${taskId}.ts`], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
}

/** A deterministic consumer: the production port speaking V1 to a real child process. */
async function consumer(adapterConfig: Record<string, unknown> = {}) {
  const root = await tempRoot("orca-web-consumer-");
  const binary = join(root, "ccloop");
  await copyFile(fixtureCli, binary);
  await chmod(binary, 0o700);
  const record = join(root, "record.json");
  const config = join(root, "adapter.json");
  const sourceDir = join(root, "run");
  await mkdir(sourceDir, { mode: 0o700 });
  await writeFile(config, JSON.stringify({ record, ...adapterConfig }), { mode: 0o600 });
  const port = createCcloopExecutionPort({ binary, adapter: "codex", adapterConfigPath: config, timeoutMs: 10_000 });
  const started = async () => JSON.parse(await readFile(record, "utf8")) as { argv: string[]; stdin: string };
  return { root, config, record, sourceDir, port, started, contract: loopContract("a") };
}

/** Import, confirm and claim one task, and hand back what the ledger froze for it. */
async function claimedWith(mode: "strict" | "soft") {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const service = new WebControlService(f.deps);
  const confirmed = await service.confirm(f.command("confirm", { ...f.confirmPayload(), budgetMode: mode }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const started = await service.start(f.command("start", {}));
  if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  const delivery = await deliverScheduledStart({ store: f.store, profileRouter: f.deps.profileRouter, admissionGate: f.deps.admissionGate }, "g");
  if (delivery.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivery)}`);
  const runId = delivery.runId;
  return { f, service, runId, envelope: frozenEnvelope(f.store, "g", runId), run: runBody(f.store, runId) };
}

describe("the shipped consumer answers for its own capabilities (task 10 step 4)", () => {
  it.skipIf(!realBinary)("claims phase-end usage and soft enforcement, and the ledger opens no strict run on it", async () => {
    const root = await tempRoot("orca-web-real-cap-");
    const config = join(root, "adapter.json");
    await writeFile(config, "{}");
    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), adapter: "codex", adapterConfigPath: config, timeoutMs: 15_000 });
    const capabilities = await port.capabilities();

    // Codex's own words, taken from the binary that would run the work: v2, eight fields, no
    // realtime usage, no bounded enforcement, no context observation, and no request-bound proof.
    // Human authorization 2026-09-24, G1 seam A Task 5: this literal moved from the v1 seven-field
    // shape to the v2 eight-field shape ccloop main now answers.
    expect(capabilities).toEqual({
      protocol: 2, usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
      handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
    });

    // Human authorization 2026-09-24, G1 seam A Task 5: the adapter's own probe answer feeds the
    // router as-is -- nothing here borrows from the declared profile.
    const strict = await confirmedByAdapter("strict", await port.probeProfileCapabilities!());
    try {
      const refused = await strict.service.start(strict.f.command("start", {}));
      expect("error" in refused ? refused.error.code : "applied").toBe("control-capability-unsupported");
      expect(strict.f.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE kind='start'").get()!.n).toBe(0);
      expect(strict.f.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g'").get()!.n).toBe(0);
    } finally { await strict.f.dispose(); }

    const soft = await confirmedByAdapter("soft", await port.probeProfileCapabilities!());
    try {
      expect("error" in await soft.service.start(soft.f.command("start", {}))).toBe(false);
      expect((await deliverScheduledStart(soft.deps, "g")).kind).toBe("claimed");
      expect(soft.f.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n).toBe(1);
    } finally { await soft.f.dispose(); }
  });

  it.skipIf(!realBinary)("refuses an envelope that is not V1 and reads a well-formed one as no execution yet", async () => {
    const root = await tempRoot("orca-web-real-env-");
    const config = join(root, "adapter.json");
    await writeFile(config, "{}");
    const sourceDir = join(root, "run");
    await mkdir(sourceDir, { mode: 0o700 });
    const bundlePath = join(sourceDir, "input", "bundle");
    await mkdir(bundlePath, { recursive: true, mode: 0o700 });
    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), adapter: "codex", adapterConfigPath: config, timeoutMs: 15_000 });
    const envelope: StartEnvelope = {
      protocol: 1,
      claim: {
        groupId: "g", workItemId: "a", taskId: "a", runId: "run-web-smoke", generation: 1, graphVersion: 1, targetVersion: 1,
        commandId: "start-g-2-a", configHash: sha256("config"),
        grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
        ownerToken: "token",
      },
      contractHash: sha256("contract"),
      inputCheckpoint: null,
      work: { contract: loopContract("a"), targetRepo: root, base: "v1", sourceDir },
    };

    // Nothing has been accepted for this run, so the shipped consumer parses the envelope and
    // reports the absence -- parsing it at all is the point: the shape the ledger freezes is V1.
    expect(await port.inspect(envelope)).toEqual({ kind: "absent" });
    // A continuation envelope has to be legal too, because that is the one a recovery hands over.
    expect(await port.inspect({
      ...envelope,
      inputCheckpoint: { predecessorRunId: "run-predecessor", checkpointId: "cp-1", checkpointHash: sha256("cp"), bundlePath },
    })).toEqual({ kind: "absent" });
    // A foreign protocol version, an unsafe claim integer, and a bundle that escapes the run
    // directory are each refused before a worker could exist.
    await expect(port.inspect({ ...envelope, protocol: 2 as 1 })).rejects.toThrow("control-peer-exit:2:control-protocol-unsupported");
    await expect(port.inspect({ ...envelope, claim: { ...envelope.claim, generation: 0 } })).rejects.toThrow("control-peer-exit:2:control-request-invalid");
    await expect(port.inspect({
      ...envelope,
      inputCheckpoint: { predecessorRunId: "run-predecessor", checkpointId: "cp-1", checkpointHash: sha256("cp"), bundlePath: root },
    })).rejects.toThrow("control-peer-exit:2:control-request-invalid");
  });
});

describe("the frozen dispatch envelope reaches a real process (task 10 step 4)", () => {
  it("carries the ledger's claim identity byte-for-byte and is durably accepted once", async () => {
    const work = await claimedWith("soft");
    const c = await consumer();
    try {
      const start = startEnvelope(work.envelope, work.run, c.sourceDir, c.contract);

      // The ledger keeps only the hash; the consumer is handed the token, and the two must agree.
      expect(sha256(start.claim.ownerToken)).toBe(work.envelope.ownerTokenHash);
      expect(start.claim.runId).toBe(work.envelope.runId);
      expect(start.claim.generation).toBe(work.envelope.generation);
      expect(work.envelope.grants).toEqual(start.claim.grant);
      expect(work.envelope.derivedContractHash).toBe(start.contractHash);
      expect(work.envelope.claimIdentity.endsWith(`:attempt:${work.envelope.claimOrdinal}`)).toBe(true);

      const accepted = await c.port.accept(start);
      expect(accepted).toEqual({ kind: "accepted", executionId: "execution-1", configHash: start.claim.configHash });
      const wire = await c.started();
      expect(wire.argv).toEqual(["control", "accept", "--adapter", "codex", "--adapter-config", c.config]);
      // Byte-for-byte: nothing between the ledger and the pipe re-serialises the claim.
      expect(wire.stdin).toBe(JSON.stringify(start));

      // A replay of the same frozen envelope reports the same execution, never a second one.
      expect(await c.port.accept(start)).toEqual(accepted);
    } finally { await work.f.dispose(); }
  });

  it("latches the stop under the ledger's request identity and returns evidence the store re-hashes", async () => {
    const text = "usage event written by the worker";
    const bytes = Buffer.from(text);
    const ref = { artifactId: "evidence-usage", hash: sha256(bytes) };
    const work = await claimedWith("soft");
    const c = await consumer({ evidence: text, collectRef: ref });
    try {
      const start = startEnvelope(work.envelope, work.run, c.sourceDir, c.contract);
      const stopped = await work.service.handoffStop(work.f.command("handoff-stop", {}, "smoke-stop"));
      if ("error" in stopped) throw new Error(`handoff-stop refused: ${JSON.stringify(stopped.error)}`);

      // The stop a person asked for is the request the consumer latches: same id, same run.
      const request = work.f.store.db.prepare("SELECT id,body FROM handoff_requests WHERE group_id='g' AND run_id=?").get(work.runId);
      if (!request) throw new Error("handoff-stop froze no request");
      const body = JSON.parse(String(request.body)) as { generation: number };
      const ack = await c.port.requestHandoff(start, {
        protocol: 1, requestId: String(request.id), runId: work.runId, generation: body.generation,
        reason: "context", deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      });
      expect(ack).toEqual({ kind: "latched", requestId: String(request.id) });
      expect(JSON.parse((await c.started()).stdin).request.requestId).toBe(String(request.id));

      // Usage the adapter reports is evidence the store must verify by re-hashing bytes, not by
      // trusting the reference it was handed.
      const report = await c.port.collect(start, 0);
      expect(report.events.map((event) => event.source)).toEqual([ref]);
      expect((await c.port.readEvidence(ref)).equals(bytes)).toBe(true);
      const packet = canonicalBytes({ schema: "orca-usage-event-v1", text });
      const archived = await writeArtifact(work.f.store, ref.artifactId, packet);
      expect(archived.hash).toBe(sha256(packet));
      expect((await readArtifact(work.f.store, archived)).equals(packet)).toBe(true);
      // A reference whose bytes are gone is refused, never rendered with a hole in it.
      work.f.store.db.prepare("DELETE FROM artifacts WHERE id=?").run(ref.artifactId);
      await expect(readArtifact(work.f.store, archived)).rejects.toThrow("artifact-not-found");
    } finally { await work.f.dispose(); }
  });
});
