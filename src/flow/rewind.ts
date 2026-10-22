/** Flow engine spec §8.3 (plan Task 11): rewind keeps later messages. Built in the next commit. */
import { FlowRefusal, type FlowDeps } from "./kernel.js";
import type { LoadedRun } from "./kinds/registry.js";
import type { MessageRow } from "./store.js";

export async function applyRewind(_deps: FlowDeps, _run: LoadedRun, _message: MessageRow): Promise<string> {
  throw new FlowRefusal("flow-command-unknown", "rewind");
}
