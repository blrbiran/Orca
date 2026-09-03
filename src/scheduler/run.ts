import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DecisionEvent } from "../ledger/schema.js";
import { appendEvent } from "../ledger/writer.js";
import { disposeWorkdir, routeOutcome, runTask } from "./ccloopRunner.js";
import type { TaskRun } from "./ccloopRunner.js";
import { buildGraph, implicitEdgeDecisions } from "./graph.js";
import type { TaskGraph } from "./graph.js";
import { disposition, harvest, sameLayerWriteSets } from "./harvest.js";
import { checkoutWorkBranch, commitLedgerOnW, landIntoW, workBranchTip } from "./land.js";
import { loadPlan } from "./planFile.js";
import type { PlanFile, PlanRejection } from "./planFile.js";
import { emptyRequiredChecksPairs, renderPlanReport } from "./planReport.js";
import { preflight } from "./preflight.js";
import type { PreflightReport } from "./preflight.js";
import { acquireRepoLock } from "./repoLock.js";
import { allocateRunId, deriveRunId } from "./runId.js";

const execFileAsync = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}

/**
 * spec §9.2: `plan` reads the target repo's currently checked-out branch name
 * to compare against workBranch (loadPlan's work-branch-is-default rejection
 * needs it), but never mutates it — `git symbolic-ref` with no second
 * argument is a read. A repo with nothing checked out (bare, or a fresh
 * --bare clone) has no default to compare against; falling back to "" rather
 * than throwing lets every other check still run and get reported, instead of
 * a caller fixing exceptions one at a time.
 *
 * ⚠️ It is read ONCE, at the start, and everything downstream uses that value
 * — including land.ts's refusal to check out the default branch. It must not
 * be re-read after `checkoutWorkBranch` has run, because by then HEAD is W
 * and the answer would be "the default branch is W".
 */
async function resolveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Everything `orca plan` prints and everything `orca run` needs before it
 * spends a cent, derived exactly once.
 *
 * spec §9.4 is the reason this type exists at all: two implementations of
 * "read → validate → compute write sets → build the graph → layer it" WILL
 * drift, and the direction they drift in is the worst one — the picture a
 * person approved stops being the graph that runs. `plan` and `run` are not
 * two code paths that agree; they are one function, called twice.
 */
export interface Round {
  plan: PlanFile;
  graph: TaskGraph;
  contracts: Map<string, unknown>;
  defaultBranch: string;
  /** The plan file's raw bytes — the round id is derived from them (§2.1). */
  planBytes: Buffer;
}

export async function loadRound(planPath: string): Promise<{ round: Round } | { rejections: PlanRejection[] }> {
  let planBytes: Buffer;
  try {
    planBytes = await readFile(planPath);
  } catch (err) {
    return {
      rejections: [{ code: "unreadable-plan", message: `cannot read plan file ${planPath}: ${(err as Error).message}` }],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(planBytes.toString("utf8"));
  } catch (err) {
    return {
      rejections: [{ code: "unreadable-plan", message: `cannot read plan file ${planPath}: ${(err as Error).message}` }],
    };
  }

  const rawTargetRepo = (raw as { targetRepo?: unknown } | null)?.targetRepo;
  const targetRepo = typeof rawTargetRepo === "string" ? rawTargetRepo : "";
  const defaultBranch = targetRepo ? await resolveDefaultBranch(targetRepo) : "";

  const result = loadPlan(raw, defaultBranch);
  if ("rejections" in result) return result;
  const { plan } = result;

  // buildGraph's contracts map is the already-loaded contract per task, not a
  // path to go read one (graph.ts's own doc comment on that parameter) —
  // reading each task's contract file here, at the I/O seam, is what keeps
  // that layer pure. loadPlan's contract-inside-target-repo rejection
  // guarantees every contract path lives outside targetRepo, so this is not a
  // read against the repo either.
  const contracts = new Map<string, unknown>();
  for (const task of plan.tasks) {
    contracts.set(task.taskId, JSON.parse(await readFile(task.contract, "utf8")));
  }

  return { round: { plan, graph: buildGraph(plan, contracts), contracts, defaultBranch, planBytes } };
}

export function renderRound(round: Round, preflightReport: PreflightReport, verbose: boolean): string {
  // Fix round 1, finding 2 (Task 5): the requiredChecks-union escalation
  // warning (spec §5.3 / §9.1(6)) needs the contracts map, which the round
  // already holds. Attached onto the graph rather than threaded as a fifth
  // parameter, since PlanGraphExtras is already the seam renderPlanReport
  // reads it from.
  const annotated = { ...round.graph, emptyRequiredChecksPairs: emptyRequiredChecksPairs(round.graph, round.contracts) };
  return renderPlanReport(annotated, round.plan, preflightReport, { verbose, runtimeChecksEvaluated: true });
}

export interface RunOptions {
  verbose?: boolean;
  /** spec §4.5: keep every task copy, including the successful ones. */
  keepWorkdirs?: boolean;
  /** G13 / spec §1.2 rule 6: v1 runs entirely on `scripted` and spends no model money. */
  adapter?: "scripted" | "claude";
  /** ccloop requires an `--adapter-config` for both adapters; there is no plan-file field for it (§2.3). */
  adapterConfig?: string;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

/**
 * spec §6.3's precedence, 3 > 2 > 1 > 0, spelled inline because the codes are
 * ordered integers and the largest contribution wins.
 *
 * ⚠️ Task 13 owns `src/scheduler/exitCode.ts` and the named `M-EXIT` mutation
 * that pins this rule against a criterion. Until then this is the same rule
 * with no module of its own — deliberately NOT a private re-derivation with
 * different semantics, so that Task 13's version replaces it rather than
 * competing with it.
 */
function roundExitCode(contributions: number[]): number {
  return contributions.reduce((worst, code) => Math.max(worst, code), 0);
}

/**
 * spec §4.3: "落地顺序本身是一次 `scheduling` 决策 ⇒ 进台账" — but only when
 * there IS an order to choose. A layer that lands one task made no choice,
 * and A′ §3.5 is explicit that something with no alternatives is not a
 * decision at all (§4.3's own note about the repoPath rewrite makes the same
 * point). Recording one anyway would fill the panel with non-decisions and
 * make the real ones harder to find.
 *
 * Written AFTER the layer's landings rather than before, because which tasks
 * land is not known until §7's reconciliation has run on each of them — a
 * task can succeed in ccloop and still not land (§7.3). The choice this
 * records is therefore the order the landings actually happened in, which is
 * also the only order a reader could check against W's history.
 */
function landingOrderDecision(
  roundId: string,
  seq: number,
  layerIndex: number,
  order: string[],
  layerBase: string,
  workBranch: string,
  at: string,
): DecisionEvent {
  return {
    ev: "decision",
    id: `${roundId}/${seq}`,
    at,
    run: roundId,
    question: `layer ${layerIndex} has ${order.length} tasks to land on ${workBranch}, and nothing about them says which should be merged first`,
    chose: `land them one at a time in taskId lexicographic order: ${order.join(" -> ")}`,
    alternatives: [
      {
        option: `land them in the reverse order: ${[...order].reverse().join(" -> ")}`,
        why_not:
          "same-layer tasks share one base commit and cannot see each other, so both orders are legal; " +
          "taskId lexicographic order is the deterministic default, and the scheduler is not allowed to " +
          "pick an order silently on a person's behalf",
      },
    ],
    because:
      "spec §4.3 lands one task at a time rather than in a batch: one merge commit per task, so " +
      "attribution needs no bisection. The order decides which task hits a conflict first (§5), which " +
      "makes it a real choice rather than a mechanism",
    undo: {
      how: `git reset --hard ${layerBase}`,
      cost: `discard the ${order.length} merge commits this layer already landed and re-merge them in the other order`,
      blast_radius: `the ${order.length} merge commits layer ${layerIndex} put on ${workBranch}`,
    },
    scope: "repo",
    kind: "scheduling",
  };
}

/**
 * Where the target repository is right now, read best-effort.
 *
 * spec §4.2.1 permits C to check out a real person's worktree only because the
 * design promises to be explicit about having done it. An exception that
 * escaped mid-round would otherwise leave them on a branch they did not
 * choose with nothing printed about it — which is the half of §4.2.1's bargain
 * that would not have been kept.
 *
 * Every read is individually swallowed and reported as "<unreadable>": this
 * runs on an error path, and a second failure here (W never created, the git
 * directory itself broken) must not mask the error that got us here.
 */
async function describeRepoState(plan: PlanFile): Promise<string> {
  const read = async (args: string[]): Promise<string> => {
    try {
      return (await git(plan.targetRepo, args)).trim();
    } catch {
      return "<unreadable>";
    }
  };
  const head = await read(["symbolic-ref", "--short", "HEAD"]);
  const tip = await read(["rev-parse", plan.workBranch]);
  return `orca: ${plan.targetRepo} is left on branch ${head}; work branch ${plan.workBranch} is at ${tip}`;
}

/**
 * spec §4.3's six steps for every task in the plan, layer by layer.
 *
 * The shape of the loop is §4.2's: one base per LAYER (W's rolling HEAD when
 * the layer starts, shared by every task in it, because same-layer tasks are
 * exactly the ones the graph proved cannot see each other), and one landing
 * at a time within it (§4.3 — "归因免费，不需要二分"; the merge is seconds and
 * the task is minutes, so serialising the cheap half is the right trade).
 */
export async function runRound(planPath: string, options: RunOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const logError = options.logError ?? ((line: string) => process.stderr.write(`${line}\n`));

  const loaded = await loadRound(planPath);
  if ("rejections" in loaded) {
    for (const r of loaded.rejections) logError(`rejected: ${r.code}: ${r.message}`);
    return 1;
  }
  const { round } = loaded;
  const { plan, graph, defaultBranch } = round;

  if (options.adapterConfig === undefined) {
    logError("orca run: --adapter-config <path> is required (ccloop requires one for every adapter)");
    return 1;
  }

  // spec §8.5: `out-of-repo` writes the ledger into runsDir with a content
  // hash instead of a commit anchor. Task 2 deliberately accepts the value in
  // the plan schema and Task 13 owns implementing (or rejecting) it. Refusing
  // loudly here is the only honest option in between: writing in-repo anyway
  // would silently ignore what the plan asked for, and that is the exact
  // silent-degradation shape §0.1 forbids.
  if (plan.ledgerMode !== "in-repo") {
    logError(`orca run: ledgerMode ${JSON.stringify(plan.ledgerMode)} is not implemented yet (spec §8.5)`);
    return 1;
  }

  // spec §1.2 rule 3: acquired BEFORE anything reads or writes the target
  // repo's state, because everything after this point — the cleanliness
  // preflight included — is only meaningful while no second orca can be
  // moving W underneath it. Failing to acquire is exit 1: the round was
  // refused before it started, not run and found broken.
  let lock;
  try {
    lock = await acquireRepoLock(plan.targetRepo);
  } catch (err) {
    logError((err as Error).message);
    return 1;
  }

  try {
    const preflightReport = await preflight(plan, defaultBranch);

    // spec §9.4(2): `run` ALWAYS prints plan's output first. Not a
    // convenience — it is half of what makes the two impossible to drift
    // apart, the other half being that they call the same loadRound above.
    log(renderRound(round, preflightReport, options.verbose === true));

    if (preflightReport.rejections.length > 0) {
      for (const r of preflightReport.rejections) logError(`rejected: ${r.code}: ${r.message}`);
      return 1;
    }

    // spec §4.2: W is cut from the default branch's HEAD, read ONCE at round
    // start. §4.2.1's registered v1 limitation: a push to the default branch
    // during a long round is not picked up.
    const base = (await git(plan.targetRepo, ["rev-parse", defaultBranch])).trim();
    await checkoutWorkBranch(plan, defaultBranch, base);

    // spec §8.0: C's own decisions go into their own file on W, named after
    // the round rather than after any task — which is what keeps A′ §3.1's
    // "conflicts are structurally impossible" true when N task copies are
    // writing their own `.decisions/<run-id>.jsonl` at the same time.
    // Derived, not random, and from the plan's bytes plus the base commit, so
    // the same plan against the same base names the same round.
    const roundId = deriveRunId("round", round.planBytes, base);
    const decisionsDir = join(plan.targetRepo, ".decisions");
    let decisionSeq = 0;

    // spec §2.4 / §8.1: every implicit edge's direction is an arbitrary
    // tie-break, so it is a Tier 1 decision. Written and committed BEFORE the
    // first ccloop spawn, because that is when the choice is actually made —
    // and because a round that dies half way should still have left behind
    // the reasoning it scheduled on.
    const edgeDecisions = implicitEdgeDecisions(graph, roundId);
    for (const decision of edgeDecisions) {
      await appendEvent(decisionsDir, roundId, decision);
      decisionSeq += 1;
    }
    if (edgeDecisions.length > 0) {
      await commitLedgerOnW(plan, `orca: record ${edgeDecisions.length} scheduling decision(s) for ${roundId}`);
    }

    const contributions: number[] = [];
    const notRun = new Set<string>();
    let stopRound = false;

    for (const [layerIndex, layer] of graph.layers.entries()) {
      if (stopRound) {
        for (const taskId of layer) notRun.add(taskId);
      }

      const runnable = layer.filter((taskId) => !notRun.has(taskId));
      for (const taskId of layer) {
        if (notRun.has(taskId)) log(`orca: ${taskId}: upstream_not_run (spec §6.2)`);
      }
      if (runnable.length === 0) continue;

      // spec §4.2: one base per layer, read from W's rolling HEAD. Every task
      // in this layer clones at it, so their diffs are all against the same
      // commit and §7's reconciliation compares like with like.
      const layerBase = (await git(plan.targetRepo, ["rev-parse", "HEAD"])).trim();

      // Parallel within the layer (spec §2.4 "层内并行"); the landings below
      // are strictly serial.
      const runs = await Promise.all(
        runnable.map(async (taskId): Promise<{ taskId: string; run: TaskRun }> => {
          const task = plan.tasks.find((t) => t.taskId === taskId)!;
          const contractBytes = await readFile(task.contract);
          const runId = await allocateRunId(plan.runsDir, taskId, contractBytes, layerBase);
          const run = await runTask(plan, task, layerBase, runId, {
            adapter: options.adapter ?? "scripted",
            adapterConfig: options.adapterConfig!,
          });
          return { taskId, run };
        }),
      );

      const landed: string[] = [];
      for (const { taskId, run } of runs) {
        log(`orca: ${taskId}: ccloop reported ${run.outcome} (run ${run.runId})`);

        // spec §6.1's routing table, applied before anything is harvested: a
        // run that never published an attempt commit has nothing to
        // reconcile, and §7's harvest refuses it on purpose rather than
        // absorbing it into "changed nothing".
        const route = routeOutcome(graph, taskId, run.outcome);
        for (const descendant of route.upstreamNotRun) notRun.add(descendant);
        if (route.stopRound) stopRound = true;
        if (route.escalates) contributions.push(3);
        else if (route.countsAsFailure) contributions.push(2);

        if (run.outcome !== "succeeded") {
          // spec §4.5: a copy that is not deleted has its path printed —
          // disposeWorkdir's own keep branch does that, and this is the
          // branch it exists for.
          await disposeWorkdir(run, { keepWorkdirs: options.keepWorkdirs, log });
          continue;
        }

        // spec §7: C measures the net change set itself and reconciles it
        // against the declaration in both directions.
        const reconciliation = await harvest(run, layerBase, graph.writeSets.get(taskId) ?? []);
        const verdict = disposition(reconciliation, sameLayerWriteSets(graph, taskId));
        contributions.push(verdict.exitContribution);

        if (!verdict.land) {
          log(
            `orca: ${taskId}: refusing to land — ${reconciliation.empty ? "the net change set is empty (succeeded_but_empty, spec §6.2)" : `wrote outside its declared write set: ${reconciliation.outOfBounds.join(", ")}`}`,
          );
          // keepWorkdirs is deliberately not passed here: the copy is kept
          // either way, and the printed reason should be the real one rather
          // than a flag that happens to also be set.
          await disposeWorkdir(run, {
            keepBecause: "it did not land, and its copy is the only place its result still exists",
            log,
          });
          continue;
        }

        if (reconciliation.outOfBounds.length > 0) {
          log(`orca: ${taskId}: landed despite writing outside its declared write set (spec §7.3): ${reconciliation.outOfBounds.join(", ")}`);
        }
        if (reconciliation.declaredNotProduced.length > 0) {
          log(`orca: ${taskId}: declared but did not produce: ${reconciliation.declaredNotProduced.join(", ")}`);
        }

        const result = await landIntoW(plan, run);
        if (!result.merged) {
          // spec §5 is the conflict main line and it is Task 11/12's; until
          // it exists, a conflict escalates (exit 3, §6.3) and the copy is
          // kept, because §5.2's reconciliation is rebuilt from exactly this
          // copy and these two parents.
          contributions.push(3);
          log(
            `orca: ${taskId}: merge into ${plan.workBranch} conflicted on ${result.conflict.conflictedPaths.join(", ")} ` +
              `(W tip ${result.conflict.wTip}, incoming ${result.conflict.incomingRef})`,
          );
          await disposeWorkdir(run, {
            keepBecause: "its merge into the work branch conflicted and a human has to look",
            log,
          });
          continue;
        }

        landed.push(taskId);

        // spec §4.5, and the reason Task 8 refused to call this from runTask:
        // the attempt commit is reachable only from inside the copy until the
        // fetch above puts it in the target repo's object store. This line is
        // the first moment the copy is genuinely finished with.
        await disposeWorkdir(run, { keepWorkdirs: options.keepWorkdirs, log });
      }

      if (landed.length >= 2) {
        decisionSeq += 1;
        await appendEvent(
          decisionsDir,
          roundId,
          landingOrderDecision(
            roundId,
            decisionSeq,
            layerIndex,
            landed,
            layerBase,
            plan.workBranch,
            new Date().toISOString(),
          ),
        );
        await commitLedgerOnW(plan, `orca: record the landing order for layer ${layerIndex}`);
      }
    }

    // spec §4.5: W is never deleted (deleting a branch needs a human, Rule
    // 15), so the round ends by saying where it is.
    log(`orca: work branch ${plan.workBranch} is at ${await workBranchTip(plan)}`);
    return roundExitCode(contributions);
  } catch (err) {
    // Fix round 1, finding 2. Without this the exception propagated out of
    // main() as an unhandled rejection: node picked the exit code instead of
    // §6.3's 3 > 2 > 1 > 0, and the line that tells the human where their
    // repository was left never ran at all.
    //
    // 3, not 2: §6.3's 2 means "this path is dead, read the log" and its
    // consumers are meant to read a task's log. An exception nothing
    // anticipated is by definition the other thing — a person has to come back
    // and look — and demoting it to 2 is exactly the disappearance §6.3
    // forbids. The original error is reported, not swallowed; only the
    // *propagation* is stopped.
    logError(`orca: the round failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    log(await describeRepoState(plan));
    return 3;
  } finally {
    await lock.release();
  }
}
