/**
 * spec §1.3's "v1 uses a fixed upper bound" — the parenthetical that put the
 * *adaptive* concurrency budget out of scope, and which the plan never
 * carried forward. Before this module existed the layer loop was a bare
 * `await Promise.all(runnable.map(...))`, which has two defects that only
 * look like one:
 *
 *  1. NO BOUND. A 40-task layer spawned 40 `git clone --local` copies and 40
 *     node processes at once, on a machine spec §1.2 rule 1 already pins to
 *     one host.
 *  2. `Promise.all` REJECTS ON THE FIRST FAILURE. Its siblings keep running
 *     as orphans; the results of the ones that finish afterwards are
 *     discarded un-harvested and un-disposed; and the `finally` that releases
 *     the repo lock runs while those children are still writing into runsDir
 *     — i.e. the lock spec §1.2 rule 3 calls the mechanism protecting W is
 *     released while work is still in flight.
 *
 * So the pool is not a performance knob: it is what makes "one task's
 * exception is that task's failure" true, which is what lets run.ts route a
 * throw through §6.1's `failed` row instead of killing the round.
 */

/**
 * spec §1.3's fixed upper bound. Four, not a tuned number: each slot is a
 * full `git clone --local` plus a node subprocess plus whatever that
 * subprocess's own required checks spawn, and v1 has no measurement to tune
 * against. Adaptive sizing is explicitly out of scope in §1.3.
 */
export const MAX_PARALLEL_TASKS = 4;

/**
 * A third outcome the settled array can carry: an item the pool never handed
 * to `fn` at all.
 *
 * 🔴 The pool introduced a state that did not exist before it (final review's
 * parked finding): tasks QUEUED BUT NOT YET LAUNCHED. `Promise.all` started
 * every task in the layer at once, so "stop before starting" had nothing to
 * refer to; with a bound of four, a layer's fifth task sits in a queue while
 * an earlier one is already reporting a status that ends the round. Round
 * cancellation was consulted only at layer boundaries, so those queued tasks
 * launched anyway — an invariant the code could express and did not enforce.
 */
export const NOT_STARTED = { status: "not-started" } as const;
export type PoolResult<R> = PromiseSettledResult<R> | typeof NOT_STARTED;

/**
 * Runs `fn` over `items` with at most `limit` in flight, and settles every
 * one of them: the returned array is in INPUT order, one entry per item, and
 * a rejection from `fn` becomes a `{ status: "rejected" }` entry rather than
 * a rejection of this function. Nothing here is ever discarded, which is the
 * property `Promise.all` does not have.
 *
 * `stopLaunching`, when given, is consulted immediately before each item is
 * handed to `fn` — never in the middle of one, because nothing here can
 * interrupt work already running. Every item not launched gets a
 * `not-started` entry, so a caller still receives exactly one result per
 * item and can tell "never ran" from "ran and failed"; that distinction is
 * spec §6.2's whole point.
 *
 * This function itself only rejects for a caller error (`limit` below 1),
 * because a limit of 0 would silently do no work at all — the shape Rule 12
 * forbids.
 */
export async function mapWithPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  stopLaunching?: () => boolean,
): Promise<PoolResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`orca: mapWithPool needs an integer limit of at least 1, got ${String(limit)}`);
  }

  const results = new Array<PoolResult<R>>(items.length);
  let next = 0;

  // Each worker pulls the next index until there are none left. `next++` is
  // safe without a lock because JavaScript has no preemption inside a
  // synchronous block: the read-and-increment cannot interleave with another
  // worker's.
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      // Marked rather than skipped: the loop keeps going so every remaining
      // index gets its own entry, which is what keeps the results array one
      // per item once a stop has begun.
      if (stopLaunching?.()) {
        results[index] = NOT_STARTED;
        continue;
      }
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  // This Promise.all can never reject: every worker catches everything `fn`
  // can throw. It is here to wait, not to aggregate.
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
