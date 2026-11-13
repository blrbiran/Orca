/**
 * Raw usage detail spec 2026-11-13 §2 (tester follow-up J): `orca run show` and `orca group show` print the booked usage
 * per model and phase -- the four parts, the sub-parts (reasoning of output; 5-minute and 1-hour of cache write), the
 * request count and the largest single request's input -- with "—" where the agent did not report a value (or did not
 * report it for every row summed). Totals are the ledger's `tokens`, unchanged.
 */
export interface UsageDetailLine {
  model: string | null; phase: string | null; tokens: number;
  input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null;
  reasoning: number | null; cacheWrite5m: number | null; cacheWrite1h: number | null; requests: number | null; maxRequestInput: number | null;
}

const count = (n: number | null): string => (n === null ? "—" : n.toLocaleString("en-US"));

function lineText(line: UsageDetailLine): string {
  const head = `  ${line.model ?? "unattributed"} (${line.phase ?? "no phase"}): ${count(line.tokens)} tokens`;
  if (line.model === null) return head;
  return `${head} -- input ${count(line.input)} / output ${count(line.output)} (reasoning ${count(line.reasoning)}) / cacheRead ${count(line.cacheRead)}`
    + ` / cacheWrite ${count(line.cacheWrite)} (5m ${count(line.cacheWrite5m)}, 1h ${count(line.cacheWrite1h)}) / requests ${count(line.requests)}`
    + ` / largest request input ${count(line.maxRequestInput)}`;
}

/** `orca run show`: the run's lines as the view gives them; none before any usage is booked. */
export function runUsageDetailLines(detail: readonly UsageDetailLine[] | undefined): string[] {
  return detail === undefined || detail.length === 0 ? [] : ["usage by model and phase:", ...detail.map(lineText)];
}

const plus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b);

/**
 * `orca group show`: the group's runs' lines summed per model and phase, as the usage view sums ledger rows -- a part
 * unknown on any summed line is unknown in the sum; the largest request is the largest of the lines. Usage booked to no
 * run (an integration conflict's resolution) is not in any run and so not here; `orca usage show` has it.
 */
export function groupUsageDetailLines(runs: ReadonlyArray<{ usageDetail?: readonly UsageDetailLine[] }>): string[] {
  const sums = new Map<string, UsageDetailLine>();
  for (const line of runs.flatMap((run) => run.usageDetail ?? [])) {
    const key = JSON.stringify([line.model, line.phase]), sum = sums.get(key);
    sums.set(key, sum === undefined ? { ...line } : {
      ...sum, tokens: sum.tokens + line.tokens, input: plus(sum.input, line.input), output: plus(sum.output, line.output),
      cacheRead: plus(sum.cacheRead, line.cacheRead), cacheWrite: plus(sum.cacheWrite, line.cacheWrite), reasoning: plus(sum.reasoning, line.reasoning),
      cacheWrite5m: plus(sum.cacheWrite5m, line.cacheWrite5m), cacheWrite1h: plus(sum.cacheWrite1h, line.cacheWrite1h), requests: plus(sum.requests, line.requests),
      maxRequestInput: sum.maxRequestInput === null || line.maxRequestInput === null ? null : Math.max(sum.maxRequestInput, line.maxRequestInput),
    });
  }
  const order = (a: UsageDetailLine, b: UsageDetailLine) => (a.model === b.model ? 0 : a.model === null ? 1 : b.model === null ? -1 : a.model < b.model ? -1 : 1)
    || (a.phase === b.phase ? 0 : a.phase === null ? 1 : b.phase === null ? -1 : a.phase < b.phase ? -1 : 1);
  return sums.size === 0 ? [] : ["group usage by model and phase (booked to its runs):", ...[...sums.values()].sort(order).map(lineText)];
}
