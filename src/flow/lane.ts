/**
 * One lane per run: an advance of a run, and a message's take, each run to their end before the next one starts. Without
 * it two accepts of one run could take the same mid-run intervention twice (the second write finds it no longer
 * `accepted`, flow-execution-stale). A call made from inside the lane -- an accept's take calling advanceRun -- runs at
 * once: the lane is reentrant.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const inLane = new AsyncLocalStorage<ReadonlySet<string>>();
const tails = new Map<string, Promise<void>>();

export async function inFlowLane<T>(flowRunId: string, work: () => Promise<T>): Promise<T> {
  const held = inLane.getStore();
  if (held?.has(flowRunId) === true) return work();
  const previous = tails.get(flowRunId) ?? Promise.resolve();
  const run = previous.then(() => inLane.run(new Set([...(held ?? []), flowRunId]), work));
  const tail = run.then(() => undefined, () => undefined);
  tails.set(flowRunId, tail);
  try {
    return await run;
  } finally {
    if (tails.get(flowRunId) === tail) tails.delete(flowRunId);
  }
}
