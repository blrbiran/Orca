import { z } from "zod";
import { ControlError } from "./errors.js";
import type { StartEnvelope } from "./executionPort.js";
import { dispatchEnvelopeSchema, type DispatchEnvelopeV1 } from "./webProtocol.js";
import { agentSelectionSchema, grantSchema, idSchema, safeInteger, startEnvelopeSchema } from "./schema.js";
import type { InputCheckpointV1 } from "./resumeBundle.js";

/**
 * Assembly plan Task 4. The ledger freezes a `DispatchEnvelopeV1`; the execution port speaks
 * `StartEnvelope`. Until now the only translation between the two lived inside
 * `tests/control/webCcloopSmoke.test.ts`, which meant the production consumer of the ledger's
 * frozen identity was a test fixture. This is that function, moved, and the smoke test imports it
 * so the fixture cannot drift away from what a real dispatch would send.
 */

/** The run-row fields a start envelope's claim is built from, parsed rather than coerced. */
const startEnvelopeSourceSchema = z
  .object({
    groupId: idSchema,
    workItemId: idSchema,
    taskId: idSchema.nullable(),
    runId: idSchema,
    generation: safeInteger.positive(),
    graphVersion: safeInteger,
    targetVersion: safeInteger,
    commandId: idSchema,
    configHash: z.string().min(1),
    // Agent selection spec §4.6: the run's frozen, complete selection travels in the claim (StartEnvelopeV2).
    agent: agentSelectionSchema,
    grant: grantSchema,
    ownerToken: idSchema,
  })
  .strip();

export type StartEnvelopeSource = z.infer<typeof startEnvelopeSourceSchema>;

export interface StartEnvelopeWork {
  sourceDir: string;
  targetRepo: string;
  base: string;
  /** Syncskill integration spec §10.6: the run's skill snapshot; absent for a run without skills (no key on the wire). */
  skillPluginDir?: string;
}

/** The checks both translations share (see toStartEnvelope's comment), and the claim built from the run row. */
function frozenClaim(envelope: DispatchEnvelopeV1, run: unknown): { frozen: DispatchEnvelopeV1; claim: StartEnvelope["claim"] } {
  const parsedEnvelope = dispatchEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) {
    throw new ControlError("start-envelope-conflict", `schema:${parsedEnvelope.error.issues[0]?.message ?? "invalid"}`);
  }
  const parsedRun = startEnvelopeSourceSchema.safeParse(run);
  if (!parsedRun.success) {
    throw new ControlError("start-envelope-conflict", `run:${parsedRun.error.issues[0]?.path.join(".") || "invalid"}`);
  }
  const source = parsedRun.data;
  const frozen = parsedEnvelope.data;
  if (frozen.runId !== source.runId || frozen.generation !== source.generation
    || frozen.groupId !== source.groupId || frozen.workItemId !== source.workItemId) {
    throw new ControlError("start-envelope-conflict", `identity:${frozen.runId}`);
  }
  return {
    frozen,
    claim: {
      groupId: source.groupId, workItemId: source.workItemId, taskId: source.taskId, runId: source.runId, generation: source.generation,
      graphVersion: source.graphVersion, targetVersion: source.targetVersion, commandId: source.commandId, configHash: source.configHash,
      agent: source.agent, grant: source.grant, ownerToken: source.ownerToken,
    },
  };
}

/**
 * Refuses before it builds, and refuses before any port object is touched. Three ways a dispatch
 * can be wrong here, each named in the detail:
 *
 * - `schema`: the stored envelope is not a valid `DispatchEnvelopeV1`. A ledger row that no longer
 *   parses must not be handed to a peer on the grounds that it once did.
 * - `run`: the run row lacks the fields a claim needs. The version of this that lived in the test
 *   used `String(run.groupId)`, which turns a missing field into the four characters "undefined"
 *   and dispatches it.
 * - `identity`: the envelope and the run disagree about which run this is. Two rows that name
 *   different runs cannot both be this dispatch, and picking either one silently is how work gets
 *   charged to the wrong claim.
 */
export function toStartEnvelope(
  envelope: DispatchEnvelopeV1,
  run: unknown,
  work: StartEnvelopeWork,
  contract: unknown,
  // Handoff delivery spec §4, §11 M4: a continuation carries the checkpoint ccloop rebuilds its first workspace from.
  inputCheckpoint: InputCheckpointV1 | null = null,
): StartEnvelope {
  const { frozen, claim } = frozenClaim(envelope, run);
  // Single-call estimate spec §4.1, N1 spec §5.1: an estimate or other single-call claim is one single call, never a loop.
  if (frozen.phase === "estimate" || frozen.phase === "single-call") throw new ControlError("start-envelope-conflict", `phase:${frozen.phase}`);
  const built: StartEnvelope = {
    protocol: 3,
    claim,
    // The ledger's derived hash, never one recomputed here: recomputing would let a contract that
    // drifted after the freeze pass as the one the claim was made against.
    contractHash: frozen.derivedContractHash,
    inputCheckpoint,
    work: {
      kind: "loop", contract, targetRepo: work.targetRepo, base: work.base, sourceDir: work.sourceDir,
      // Absent stays absent, so a run without skills keeps its exact envelope bytes and hash.
      ...(work.skillPluginDir !== undefined ? { skillPluginDir: work.skillPluginDir } : {}),
    },
  };
  // Parsed against the repository's own start-envelope schema rather than merely typed as one, so
  // that a field this function assembles wrongly is refused here instead of at the peer.
  const checked = startEnvelopeSchema.safeParse(built);
  if (!checked.success) throw new ControlError("start-envelope-conflict", `built:${checked.error.issues[0]?.path.join(".") || "invalid"}`);
  return built;
}

export interface SingleCallEnvelopeWork { sourceDir: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }

/**
 * Single-call estimate spec §4.1, §6.2 (A2 of an estimate run): the same claim and the same ledger contract hash as
 * toStartEnvelope, and one single call as the work -- the prompt and response schema Orca assembled, handed to ccloop
 * byte for byte (Web spec §5.4). Never a checkpoint: an estimate is not resumed.
 */
export function toSingleCallEnvelope(envelope: DispatchEnvelopeV1, run: unknown, work: SingleCallEnvelopeWork): StartEnvelope {
  const { frozen, claim } = frozenClaim(envelope, run);
  if (frozen.phase !== "estimate" && frozen.phase !== "single-call") throw new ControlError("start-envelope-conflict", `phase:${frozen.phase}`);
  const built: StartEnvelope = {
    protocol: 3, claim, contractHash: frozen.derivedContractHash, inputCheckpoint: null,
    work: { kind: "single-call", prompt: work.prompt, responseSchema: work.responseSchema, maxOutputTokens: work.maxOutputTokens, sourceDir: work.sourceDir },
  };
  const checked = startEnvelopeSchema.safeParse(built);
  if (!checked.success) throw new ControlError("start-envelope-conflict", `built:${checked.error.issues[0]?.path.join(".") || "invalid"}`);
  return built;
}
