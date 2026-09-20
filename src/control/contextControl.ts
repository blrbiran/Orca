import { createHash } from "node:crypto";
import { canonicalBytes } from "./canonicalJson.js";
import { contextObservationSchema, type ContextObservationV1 } from "./webProtocol.js";
import type { FrozenProfile } from "./profiles.js";
import type { ControlStore } from "./store.js";

export interface ContextPolicy { handoffAtContextTokens: number | null }
export interface ContextObservationInput { observation: ContextObservationV1; policy: ContextPolicy; profile: FrozenProfile }
export type ContextAction =
  | { kind: "observed" }
  | { kind: "invalid"; code: "context-observation-invalid" }
  | { kind: "handoff-requested"; requestId: string }
  | { kind: "joined"; requestId: string }
  | { kind: "advisory" };

const OPEN_HANDOFF_STATES = ["request-pending", "latched", "collecting", "outcome-unknown"];
const HANDOFF_DEADLINE_MS = 30 * 60_000;
const invalid = (): ContextAction => ({ kind: "invalid", code: "context-observation-invalid" });

/**
 * The spec's colon-form string is the desired handoff identity, which lives in the
 * outbox key. The canonical row id must stay `idSchema`-shaped for the panel read path.
 */
function requestIdentity(observation: ContextObservationV1, threshold: number): { desiredRequestId: string; requestId: string } {
  const desiredRequestId = `context-handoff-request:${observation.runId}:${observation.generation}:${threshold}`;
  return { desiredRequestId, requestId: `context-handoff-${createHash("sha256").update(desiredRequestId).digest("hex")}` };
}

interface LatchRow { reason: string; request_id: string | null }

function readLatch(store: ControlStore, runId: string, generation: number): LatchRow | null {
  const row = store.db.prepare("SELECT reason,request_id FROM context_latches WHERE run_id=? AND generation=?").get(runId, generation);
  return row ? { reason: String(row.reason), request_id: row.request_id === null || row.request_id === undefined ? null : String(row.request_id) } : null;
}

function latch(store: ControlStore, runId: string, generation: number, reason: "context-threshold-crossed" | "context-observation-gap", requestId: string | null): void {
  store.db.prepare("INSERT INTO context_latches(run_id,generation,reason,request_id) VALUES (?,?,?,?) ON CONFLICT(run_id,generation) DO NOTHING").run(runId, generation, reason, requestId);
}

/**
 * Accept one context watermark observation. Realtime crossings and sequence gaps
 * latch permanently and own exactly one handoff request; phase-end is advisory only.
 */
export function acceptContextObservation(deps: { store: ControlStore }, input: ContextObservationInput): ContextAction {
  const { store } = deps;
  const parsed = contextObservationSchema.safeParse(input.observation);
  if (!parsed.success) return invalid();
  const observation = parsed.data;

  return store.transaction(() => {
    const runRow = store.db.prepare("SELECT body FROM runs WHERE id=?").get(observation.runId);
    if (!runRow) return invalid();
    const run = JSON.parse(String(runRow.body)) as { runId: string; groupId: string; generation: number; providerAttemptOrdinal: number };

    const declared = input.profile.snapshot.profile;
    const mode = declared.capabilities.contextObservation;
    const window = declared.capabilities.contextWindowTokens;
    const tokenizer = declared.contextTokenizer;
    if (mode !== "realtime" && mode !== "phase-end") return invalid();
    if (window === null || tokenizer === null) return invalid();
    if (observation.generation !== run.generation) return invalid();
    if (observation.workerSessionOrdinal !== 1) return invalid();
    if (observation.tokenizerId !== tokenizer.tokenizerId || observation.tokenizerVersion !== tokenizer.tokenizerVersion) return invalid();
    if (observation.occupiedInputTokens + observation.requestMaxOutputTokens > window) return invalid();

    const body = canonicalBytes(observation).toString("utf8");
    const stored = store.db.prepare("SELECT body FROM context_observations WHERE run_id=? AND generation=? AND sequence=?")
      .get(observation.runId, observation.generation, observation.sequence);
    let duplicate = false;
    if (stored) {
      if (String(stored.body) !== body) {
        latch(store, observation.runId, observation.generation, "context-observation-gap", null);
        return invalid();
      }
      duplicate = true;
    } else {
      const high = Number(store.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM context_observations WHERE run_id=? AND generation=?")
        .get(observation.runId, observation.generation)?.n ?? 0);
      if (observation.sequence !== high + 1) {
        latch(store, observation.runId, observation.generation, "context-observation-gap", null);
        return invalid();
      }
      store.db.prepare("INSERT INTO context_observations VALUES (?,?,?,?)").run(observation.runId, observation.generation, observation.sequence, body);
    }

    const threshold = input.policy.handoffAtContextTokens;
    if (threshold === null || observation.occupiedInputTokens < threshold) return { kind: "observed" };
    if (mode === "phase-end") return { kind: "advisory" };

    const { desiredRequestId, requestId } = requestIdentity(observation, threshold);
    const latched = readLatch(store, observation.runId, observation.generation);
    if (latched) {
      if (!duplicate) return { kind: "observed" };
      if (latched.reason === "context-observation-gap") return invalid();
      const canonical = String(latched.request_id);
      const joined = store.db.prepare("SELECT request_id FROM handoff_request_joins WHERE request_id=? AND joined_request_id=?").get(canonical, desiredRequestId);
      return { kind: joined ? "joined" : "handoff-requested", requestId: canonical };
    }

    const open = store.db.prepare(`SELECT id FROM handoff_requests WHERE run_id=? AND state IN (${OPEN_HANDOFF_STATES.map(() => "?").join(",")}) ORDER BY id LIMIT 1`)
      .get(observation.runId, ...OPEN_HANDOFF_STATES);
    const deadlineAt = new Date(Date.parse(observation.observedAt) + HANDOFF_DEADLINE_MS).toISOString();
    if (open) {
      const existingRequestId = String(open.id);
      const join = {
        schema: "orca-handoff-join-v1", joinId: `handoff-join:${desiredRequestId}:${existingRequestId}`,
        desiredRequestId, existingRequestId, runId: observation.runId, generation: observation.generation,
        origin: "context", effectiveDeadlineAt: deadlineAt, createdAt: observation.observedAt,
      };
      store.db.prepare("INSERT INTO handoff_request_joins(request_id,joined_request_id,body) VALUES (?,?,?) ON CONFLICT(request_id,joined_request_id) DO NOTHING")
        .run(existingRequestId, desiredRequestId, canonicalBytes(join).toString("utf8"));
      latch(store, observation.runId, observation.generation, "context-threshold-crossed", existingRequestId);
      return { kind: "joined", requestId: existingRequestId };
    }
    const request = {
      requestId, runId: observation.runId, state: "request-pending", deadlineAt,
      phaseAttemptOrdinal: run.providerAttemptOrdinal + 1, failureCode: null, evidenceIds: [],
    };
    store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,'request-pending',?) ON CONFLICT(id) DO NOTHING")
      .run(requestId, run.groupId, observation.runId, canonicalBytes(request).toString("utf8"));
    const outbox = {
      desiredRequestId, requestId, groupId: run.groupId, runId: observation.runId, generation: observation.generation,
      origin: "context", acceptedAt: observation.observedAt, deadlineAt,
    };
    store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-request',?,0) ON CONFLICT(id) DO NOTHING")
      .run(desiredRequestId, canonicalBytes(outbox).toString("utf8"));
    latch(store, observation.runId, observation.generation, "context-threshold-crossed", requestId);
    return { kind: "handoff-requested", requestId };
  });
}
