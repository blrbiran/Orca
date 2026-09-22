import { ControlError } from "./errors.js";
import type { ExecutionPort } from "./executionPort.js";

/**
 * Assembly design spec §3 / ruling R5. A panel is allowed to boot with no `ORCA_CCLOOP_BIN` +
 * adapter config: it mounts the control plane, serves every read, and refuses the commands that
 * need an execution port. This is the object that does the refusing.
 *
 * It is deliberately NOT a stub that answers plausibly. Every method rejects with one closed code,
 * including the optional `probeProfileCapabilities` -- if that one were left off, the router would
 * report `control-capability-probe-failed` (`profiles.ts:150`) and an operator who forgot an
 * environment variable would be told their adapter lacks a capability. The two failures need
 * different answers because they need different fixes.
 *
 * The one thing this must never be is a fallback to `legacyExecutionPort`: that runner has no
 * ledger authority and no handoff protocol, so "quietly ran the work somewhere else" is strictly
 * worse than "refused by name".
 */
export function createUnconfiguredControlPort(): ExecutionPort {
  const refuse = (): never => {
    throw new ControlError(
      "control-port-unconfigured",
      "this panel has no execution port: set ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG and restart it.",
    );
  };
  return Object.freeze({
    probeProfileCapabilities: async () => refuse(),
    capabilities: async () => refuse(),
    readEvidence: async () => refuse(),
    accept: async () => refuse(),
    inspect: async () => refuse(),
    requestHandoff: async () => refuse(),
    collect: async () => refuse(),
  });
}
