import { z } from "zod";
import { ControlError } from "./errors.js";
import type { StartEnvelope } from "./executionPort.js";
import { dispatchEnvelopeSchema, type DispatchEnvelopeV1 } from "./webProtocol.js";
import { grantSchema, idSchema, safeInteger, startEnvelopeSchema } from "./schema.js";

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
    grant: grantSchema,
    ownerToken: idSchema,
  })
  .strip();

export type StartEnvelopeSource = z.infer<typeof startEnvelopeSourceSchema>;

export interface StartEnvelopeWork {
  sourceDir: string;
  targetRepo: string;
  base: string;
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
): StartEnvelope {
  const parsedEnvelope = dispatchEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) {
    throw new ControlError("start-envelope-conflict", `schema:${parsedEnvelope.error.issues[0]?.message ?? "invalid"}`);
  }
  const parsedRun = startEnvelopeSourceSchema.safeParse(run);
  if (!parsedRun.success) {
    throw new ControlError("start-envelope-conflict", `run:${parsedRun.error.issues[0]?.path.join(".") || "invalid"}`);
  }
  const claim = parsedRun.data;
  const frozen = parsedEnvelope.data;
  if (frozen.runId !== claim.runId || frozen.generation !== claim.generation
    || frozen.groupId !== claim.groupId || frozen.workItemId !== claim.workItemId) {
    throw new ControlError("start-envelope-conflict", `identity:${frozen.runId}`);
  }
  const built = {
    protocol: 1 as const,
    claim: {
      groupId: claim.groupId,
      workItemId: claim.workItemId,
      taskId: claim.taskId,
      runId: claim.runId,
      generation: claim.generation,
      graphVersion: claim.graphVersion,
      targetVersion: claim.targetVersion,
      commandId: claim.commandId,
      configHash: claim.configHash,
      grant: claim.grant,
      ownerToken: claim.ownerToken,
    },
    // The ledger's derived hash, never one recomputed here: recomputing would let a contract that
    // drifted after the freeze pass as the one the claim was made against.
    contractHash: frozen.derivedContractHash,
    inputCheckpoint: null,
    work: { contract, targetRepo: work.targetRepo, base: work.base, sourceDir: work.sourceDir },
  };
  // Parsed against the repository's own start-envelope schema rather than merely typed as one, so
  // that a field this function assembles wrongly is refused here instead of at the peer.
  const checked = startEnvelopeSchema.safeParse(built);
  if (!checked.success) throw new ControlError("start-envelope-conflict", `built:${checked.error.issues[0]?.path.join(".") || "invalid"}`);
  return built;
}
