import { sha256Canonical } from "./canonicalJson.js";

/**
 * Issue #149: what a command asks for -- its verb, target and payload, hashed with the ledger's canonical hashing -- and
 * nothing else. Left out: `expectedRevision` (when it was asked; a re-run re-reads it) and the fields that name the request
 * rather than the change: `schema`, `commandId` (the lookup key itself) and `actorId` (set by the panel, not the caller).
 *
 * The command lookup answers it beside a booked outcome, and the CLI computes it the same way for the request it is about
 * to send, so a re-run of the same --command-id with the same arguments can print the booked outcome instead of sending a
 * request the ledger would refuse as command-id-conflict. Replay identity is unchanged: the ledger still compares the whole
 * raw request byte for byte (CLI v2 spec §14 R1).
 */
export function commandArgumentsHash(command: { verb: string; target: unknown; payload: unknown }): string {
  return sha256Canonical({ verb: command.verb, target: command.target, payload: command.payload });
}
