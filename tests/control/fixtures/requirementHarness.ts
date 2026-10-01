import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { updateRevision } from "../../../src/control/commandLedger.js";
import { deliverSchedulerWakes } from "../../../src/control/dispatch.js";
import { ControlError } from "../../../src/control/errors.js";
import { createExecutionDriver, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
import { estimatorSlotFor } from "../../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { insertClarifyingGroup, newRound, queueRequirementCall, readRound, writeRound } from "../../../src/control/requirementRecords.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../../../src/control/requirementSchemas.js";
import type { Amount, ArtifactRef, Candidate } from "../../../src/control/types.js";
import { createWebWakeHandlers } from "../../../src/control/webDispatch.js";
import { WebControlService, readWebGroup } from "../../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import { FIXTURE_AGENT_ID, fixtureResolveAgent, seedPanelOperator, seedPreferences } from "./agents.js";
import { clarifyingInput } from "./requirement.js";
import { openTestStore } from "./store.js";
import { profileSnapshot } from "./web.js";

/** N1 plan Task 6: one queued model answer per single call, in order; `purpose` is checked against the prompt's first line. */
/** `output` may be a function of the prompt (an estimate's answer must echo the plan hash its request carries). */
export interface QueuedAnswer { purpose: "clarify" | "split" | "estimate"; output: unknown; outcome?: "complete" | "failed" | "aborted"; tokens?: number | null }
const HEADS = { clarify: "Orca requirement clarification, instruction version 1.", split: "Orca requirement split, instruction version 1.", estimate: "You are estimating the budget" } as const;
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function queuedPort(answers: QueuedAnswer[], stoppable: boolean) {
  const evidence = new Map<string, Buffer>();
  const calls = { accept: [] as StartEnvelope[], collect: 0 };
  const byRun = new Map<string, QueuedAnswer>();
  let requested = false;
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => { const ref = { artifactId, hash: sha(bytes) }; evidence.set(`${artifactId}:${ref.hash}`, bytes); return ref; };
  const accepted = (envelope: StartEnvelope) => ({ kind: "accepted" as const, executionId: `exec-${envelope.claim.runId}`, configHash: envelope.claim.configHash });
  const resolveAgent = fixtureResolveAgent(() => profileSnapshot().profile.capabilities);
  const port: ExecutionPort = {
    resolveAgent: async (partial) => resolveAgent(partial),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
    async accept(envelope) { calls.accept.push(structuredClone(envelope)); return accepted(envelope); },
    async inspect(envelope) { return accepted(envelope); },
    async requestHandoff(_envelope, request) { requested = true; return { kind: "latched", requestId: request.requestId }; },
    async collect(envelope): Promise<ExecutionReport> {
      calls.collect += 1;
      const { claim, work } = envelope;
      if (work.kind !== "single-call") throw new Error("queuedPort: single calls only");
      let answer = byRun.get(claim.runId);
      if (answer === undefined) {
        answer = answers[byRun.size];
        if (answer === undefined) throw new Error(`queuedPort: no answer left for call ${byRun.size + 1}`);
        if (!work.prompt.startsWith(HEADS[answer.purpose])) throw new Error(`queuedPort: call ${byRun.size + 1} is not a ${answer.purpose} prompt`);
        byRun.set(claim.runId, answer);
      }
      const outcome = stoppable && requested ? "aborted" : answer.outcome ?? "complete";
      const tokens = answer.tokens === undefined ? 777 : answer.tokens;
      const events = [{ runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work" as const,
        cumulative: tokens === null ? null : { tokens, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`usage ${claim.runId}`)) }];
      if (stoppable && !requested) return { events, candidate: null, terminal: null };
      const output = typeof answer.output === "function" ? (answer.output as (prompt: string) => unknown)(work.prompt) : answer.output;
      const outputRef = outcome === "complete" ? put(`output-${claim.runId}`, canonicalBytes(output)) : null;
      const record = { schema: "ccloop-single-call-record-v1", promptSha256: sha(Buffer.from(work.prompt, "utf8")), responseSchemaSha256: sha256Canonical(work.responseSchema),
        outcome, outputRef, errorCode: outcome === "failed" ? "single-call-output-invalid" : null };
      const executionId = `exec-${claim.runId}`;
      const candidate: Candidate = {
        groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
        graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 1,
        result: outcome === "complete" ? "complete" : outcome === "aborted" ? "partial" : "failed", artifacts: outputRef === null ? [] : [outputRef], snapshot: null,
        missing: [], unresolvedRequestIds: [], stopProof: { executionId, generation: claim.generation, isolated: true, source: put(`stop-${claim.runId}`, Buffer.from(`stop ${executionId}`)) },
        terminalOutcome: `single-call-${outcome}`, handoff: put(`call-${claim.runId}`, canonicalBytes(record)),
      };
      return { events, candidate, terminal: null };
    },
    async readEvidence(ref) { const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`); if (!bytes) throw new ControlError("control-evidence-context-missing"); return bytes; },
  };
  return { port, calls };
}

/**
 * A clarifying group "r" on target repository `repo` (README.md, src/a.ts), round 1 queued as requirement-open leaves it,
 * a driver over the queued single-call port, the pump's real wake handlers, and the service for commands.
 */
export async function requirementHarness(options: { answers: QueuedAnswer[]; stoppable?: boolean; limit?: Amount } = { answers: [] }) {
  const h = await openTestStore();
  const repo = join(h.root, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  await writeFile(join(repo, "README.md"), "# Notes\nA note-taking tool.\n");
  await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n");
  g("add", "-A"); g("commit", "-qm", "base");
  const snapshot = profileSnapshot();
  const fake = queuedPort(options.answers, options.stoppable ?? false);
  const supplied = resolveProfile(snapshot, fake.port), router = createExecutionProfileRouter([supplied]);
  const profile = router.resolve("budget-estimate", "all", supplied.profileHash);
  seedPreferences(h.store, "human", { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
  seedPanelOperator(h.store, { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
  const slot = await estimatorSlotFor({ store: h.store, profileRouter: router }, "human", {}, profile);
  if (slot.outcome.kind !== "frozen") throw new Error("requirementHarness: the fixture agent did not resolve");
  const frozenSlot = slot.outcome.slot;
  // Controller ruling PR-B1: what requirement-open leaves behind -- the group at revision 1 and projection_seq 1, round 1
  // drafting and its call queued -- in one transaction.
  h.store.transaction(() => {
    insertClarifyingGroup(h.store, clarifyingInput("r", { limit: options.limit ?? { ...REQUIREMENT_LIMIT_DEFAULT }, profile: { profileId: "all", profileHash: profile.profileHash }, agentSlot: frozenSlot, maxOutputTokens: 64_000 }));
    updateRevision(h.store, "r", 1);
    h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
    writeRound(h.store, "r", newRound(1));
    queueRequirementCall(h.store, "r", "open");
  });
  const admissionGate = createAdmissionGate();
  const service = new WebControlService({ store: h.store, port: fake.port, admissionGate, profileRouter: router,
    trustedConfig: { resolveTarget: () => { throw new ControlError("control-plan-rejected", "no-plan-files"); } },
    knownRepository: (id: string) => id === "repo",
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: profile.profileHash, estimateMode: "soft" as const }) });
  const deps: ExecutionDriverDeps = { store: h.store, router, admissionGate, roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => repo,
    ccloopBin: "/bin/false", agentsTablePath: join(h.root, "agents.json"), astGrepBin: null };
  const handlers = createWebWakeHandlers({ store: h.store, profileRouter: router, admissionGate, service });
  const driver = createExecutionDriver(deps);
  const runs = () => h.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id='r' ORDER BY rowid").all().map((row) => ({ runId: String(row.id), active: Number(row.active), ...JSON.parse(String(row.body)) }));
  const until = async (predicate: () => boolean, limit = 40): Promise<void> => {
    for (let i = 0; i < limit && !predicate(); i += 1) { await deliverSchedulerWakes(h.store, handlers); await driver.round(); }
    if (!predicate()) throw new Error(`requirementHarness: not there; runs ${JSON.stringify(runs().map((r) => [r.workItemId, r.state, r.drive?.blockedReason ?? null]))}`);
  };
  const revision = () => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='r'").get()!.revision);
  let sequence = 0;
  const command = (verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "r" }) =>
    ({ schema: "orca-raw-command-v1", commandId: `c-${++sequence}`, actorId: "human", expectedRevision: revision(), verb, target, payload }) as never;
  return {
    store: h.store, root: h.root, repo, service, deps, driver, fake, until, runs, command, profile,
    /** One pump pass over the durable wakes, with the real handlers (no driver round). */
    deliver: () => deliverSchedulerWakes(h.store, handlers),
    round: (n: number) => readRound(h.store, "r", n), group: () => readWebGroup(h.store, "r"), head: () => g("rev-parse", "HEAD"), git: g,
    dispose: async () => { await driver.stop(); await h.dispose(); },
  };
}
