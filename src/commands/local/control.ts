import type { LocalHandler } from "../types.js";

/** `orca control get|send`: today's grammar, unchanged (spec §4). */
export function runControl(action: "get" | "send"): LocalHandler {
  return async (args, io) => {
    const { runControlCommand } = await import("../../entry/controlCommand.js");
    return runControlCommand([action, ...(args.raw ?? [])], io.env);
  };
}
