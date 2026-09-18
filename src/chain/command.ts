import { lockState, removeChainLock } from "./lock.js";
import { commitChainRecord, commitMessage } from "./record.js";
import { readChainRecord } from "./recordSchema.js";
import { ChainRejection } from "./rejection.js";
import { type ChainDeps, defaultChainDeps, startChain } from "./run.js";
import { requestStop } from "./stopRequest.js";

function flags(sub: string, args: string[], allowed: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!allowed.includes(flag) || value === undefined || values.has(flag)) {
      throw new ChainRejection("chain-args-invalid", `orca chain ${sub}: unexpected argument ${JSON.stringify(flag)}`);
    }
    values.set(flag, value);
  }
  return values;
}
function required(values: Map<string, string>, sub: string, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new ChainRejection("chain-args-invalid", `orca chain ${sub}: ${flag} is required`);
  return value;
}
const numberOf = (values: Map<string, string>, flag: string): number | undefined => (values.has(flag) ? Number(values.get(flag)) : undefined);

/**
 * `orca chain start|stop|unlock`. Catches everything (D-launch spec §4.3, review I8): a named refusal answers with its
 * own code, anything unforeseen with 2 (an anomaly) — never main()'s 3, which for a chain means "blocked on a person".
 */
export async function runChainCommand(args: string[], deps: ChainDeps = defaultChainDeps()): Promise<number> {
  try {
    const [sub, ...rest] = args;
    if (sub === "start") {
      const v = flags("start", rest, ["--repo", "--by", "--goal", "--max-sessions", "--max-cost-usd", "--session-timeout-min", "--chain-id", "--via"]);
      return await startChain(
        {
          repo: required(v, "start", "--repo"),
          by: v.get("--by"),
          goal: v.get("--goal"),
          maxSessions: numberOf(v, "--max-sessions"),
          maxCostUsd: numberOf(v, "--max-cost-usd"),
          sessionTimeoutMin: numberOf(v, "--session-timeout-min"),
          chainId: v.get("--chain-id"),
          via: v.get("--via") ?? "cli",
        },
        deps,
      );
    }
    if (sub === "stop") return await stopChain(flags("stop", rest, ["--repo", "--chain-id"]), deps);
    if (sub === "unlock") return await unlockChain(flags("unlock", rest, ["--repo"]), deps);
    deps.err("orca chain: expected start, stop or unlock\n");
    return 1;
  } catch (err) {
    if (err instanceof ChainRejection) {
      deps.err(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    deps.err(`orca chain: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 2;
  }
}

/** Spec §2, plan PC-7: without --chain-id, the chain named in the lock. */
async function stopChain(values: Map<string, string>, deps: ChainDeps): Promise<number> {
  const repo = required(values, "stop", "--repo");
  let chainId = values.get("--chain-id");
  if (chainId === undefined) {
    const state = await lockState(repo);
    if (state.kind === "free" || state.holder === null) throw new ChainRejection("no-running-chain", `no chain holds the lock in ${repo}; name one with --chain-id`);
    chainId = state.holder.chainId;
  }
  const path = await requestStop(repo, chainId);
  deps.out(`orca chain: stop requested for ${chainId}; it stops after the current session ends (${path})\n`);
  return 0;
}

/** Spec §5.3 (review M13), plan PC-6: only a lock whose holder is gone; the record is ended as unlocked-by-human. */
async function unlockChain(values: Map<string, string>, deps: ChainDeps): Promise<number> {
  const repo = required(values, "unlock", "--repo");
  const state = await lockState(repo);
  if (state.kind === "free") throw new ChainRejection("no-chain-lock", `there is no chain lock in ${repo}`);
  if (state.kind === "held") {
    throw new ChainRejection("chain-running", `chain ${state.holder.chainId} is still running as pid ${state.holder.pid}; use \`orca chain stop\``);
  }
  await removeChainLock(repo);
  deps.out(`orca chain: removed the chain lock (${state.why})\n`);
  if (state.holder === null) {
    deps.out("orca chain: the lock named no chain; no chain record was changed\n");
    return 0;
  }
  const record = await readChainRecord(repo, state.holder.chainId);
  if (record.state !== "running") {
    deps.out(`orca chain: ${record.chainId} was already stopped (${record.stop?.reason})\n`);
    return 0;
  }
  record.state = "stopped";
  record.stop = { reason: "unlocked-by-human", category: "anomaly", at: deps.now().toISOString(), awaitingHuman: [], detail: state.why };
  await commitChainRecord(repo, record, commitMessage(record.chainId, "stopped, unlocked-by-human"));
  deps.out(`orca chain: recorded ${record.chainId} as stopped (unlocked-by-human)\n`);
  return 0;
}
