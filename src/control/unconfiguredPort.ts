import { ControlError } from "./errors.js";
import type { ExecutionPort } from "./executionPort.js";

/**
 * Assembly design spec §3 / ruling R5. A panel is allowed to boot with no `ORCA_CCLOOP_BIN` +
 * agents table (`ORCA_AGENTS_TABLE`, agent selection spec §6.6): it mounts the control plane, serves
 * every read, and refuses the commands that need an execution port. This is the object that does the
 * refusing.
 *
 * It is deliberately NOT a stub that answers plausibly. Every method rejects with one closed code,
 * `resolveAgent` included -- the router folds a probe throw into a failure code, and an operator who
 * forgot an environment variable must be told that, not that their agent lacks a capability. The two
 * failures need different answers because they need different fixes.
 *
 * The one thing this must never be is a fallback to `legacyExecutionPort`: that runner has no
 * ledger authority and no handoff protocol, so "quietly ran the work somewhere else" is strictly
 * worse than "refused by name".
 */
export function createUnconfiguredControlPort(): ExecutionPort {
  const refuse = (): never => {
    throw new ControlError(
      "control-port-unconfigured",
      "this panel has no execution port: set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it.",
    );
  };
  return Object.freeze({
    resolveAgent: async () => refuse(),
    listAgents: async () => refuse(),
    readEvidence: async () => refuse(),
    accept: async () => refuse(),
    inspect: async () => refuse(),
    requestHandoff: async () => refuse(),
    collect: async () => refuse(),
  });
}
