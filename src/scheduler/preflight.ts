import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PlanFile, PlanRejection } from "./planFile.js";
import { RUNTIME_CHECKS } from "./planReport.js";

const execFileAsync = promisify(execFile);

// Ruling 1 (task-6-brief.md): RUNTIME_CHECKS is planReport.ts's single
// source of truth for these three code strings — imported, not retyped. A
// previous task invented a fourth spelling of one of these and it cost a
// review round; destructuring here rather than writing the literals out a
// second time is what makes that impossible to repeat.
const [WORK_BRANCH_ALREADY_EXISTS, BASE_NOT_A_COMMIT, DIRTY_WORKTREE] = RUNTIME_CHECKS;

// Ruling R3: exactly this shape, no extra fields — renderPlanReport already
// takes `{ rejections: PlanRejection[] }` structurally, so this stays
// assignable to it with no change needed on the renderer's side.
export interface PreflightReport {
  rejections: PlanRejection[];
}

/**
 * Three-way, never two-way: git said yes, git said no, or git could not look.
 *
 * 🔴 Final review's promoted follow-up. Both ref reads used to be
 * `catch { return false }`, which collapses "there is no such ref" into the
 * same answer as "this is not a repository, I never looked" — and
 * `renderPlanReport`'s `checkLine` turns "no rejection carries this code"
 * into `[pass] <code>`. So pointing `targetRepo` at a directory that is not a
 * git repository printed a green `work-branch-already-exists` line, in the
 * report a human approves a round from, one line above two failures proving
 * git could not have answered it. A check that cannot answer must produce a
 * rejection; silence renders as a pass.
 *
 * The split is on git's own exit code, measured rather than assumed
 * (2026-09-05, git on darwin, `git rev-parse --verify --quiet`):
 * present ref → 0, absent ref or unborn branch → 1, not a repository or a
 * missing cwd → 128. `execFile` reports a non-numeric `code` (ENOENT) when
 * git is not on PATH at all, which is also "could not look" — so only an
 * exit code of exactly 1 is read as a real "no".
 */
type RefProbe = { known: boolean } | { unreadable: string };

async function probeRef(targetRepo: string, arg: string): Promise<RefProbe> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", arg], { cwd: targetRepo });
    return { known: true };
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return { known: false };
    return { unreadable: (err as Error).message.trim() };
  }
}

/**
 * Returns the porcelain output, or the reason it could not be read.
 *
 * 🔴 Final review, Important 5. This used to let the failure propagate, and
 * it was the first of the three checks to be able to fail rather than answer.
 * A `targetRepo` that is not a git repository at all — a typo in the plan
 * file, the purest exit-1 input error there is — therefore threw out of
 * `preflight`, out of `orca plan`, and reached the user as a raw node stack
 * with node's own exit code instead of §9.3's 1.
 *
 * ⚠️ The rest of that fix's reasoning said "the other two swallow their git
 * error and answer no", and treated that as merely a difference. It was the
 * bug the whole-branch review then found: answering "no" is what renders as
 * `[pass]`. Both ref reads now go through `probeRef` and report unreadability
 * the same way this one does — see its comment.
 *
 * The failure is reported under `dirty-worktree` rather than a fourth check
 * name, and that is deliberate: the check's claim is "the worktree is
 * verifiably clean before C checks a real person's worktree out onto W"
 * (§4.2.1), and a directory whose cleanliness cannot be read fails that claim
 * for real. Inventing a fourth spelling of a §4.2 check code is the exact
 * mistake preflight's own Ruling 1 comment above exists to prevent, and the
 * message says plainly what happened rather than implying uncommitted work.
 */
async function porcelainOf(targetRepo: string): Promise<{ output: string } | { unreadable: string }> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: targetRepo });
    return { output: stdout };
  } catch (err) {
    return { unreadable: (err as Error).message.trim() };
  }
}

/**
 * spec §4.2's three runtime preflight checks (the two plan-level halves of
 * the "nine up-front checks" live in loadPlan already — see planReport.ts's
 * own PLAN_LEVEL_CHECKS comment). These cannot be evaluated from the plan
 * file alone: they need the target repo's actual on-disk state, which is why
 * they are a separate function rather than folded into loadPlan.
 *
 * All three checks read (git rev-parse, git status --porcelain) and never
 * write — spec §9.1(4) says explicitly that reading a ref or porcelain
 * output does not count as touching the repo. That is what lets `orca plan`
 * (spec §9.2: zero side effects on the target repo) call this function and
 * print real verdicts instead of leaving these three checks perpetually
 * "not evaluated".
 */
export async function preflight(plan: PlanFile, baseBranch: string): Promise<PreflightReport> {
  const rejections: PlanRejection[] = [];

  // S18 / §4.2 runtime rejection: an existing workBranch must never be
  // silently reused. Reuse would mean merging onto a branch that may already
  // carry someone else's un-landed work, with no record that anyone chose
  // to build on top of it.
  const workBranch = await probeRef(plan.targetRepo, `refs/heads/${plan.workBranch}`);
  if ("unreadable" in workBranch) {
    rejections.push({
      code: WORK_BRANCH_ALREADY_EXISTS,
      message:
        `cannot determine whether the branch ${JSON.stringify(plan.workBranch)} exists in ` +
        `${plan.targetRepo} (is it a git repository?): ${workBranch.unreadable}`,
    });
  } else if (workBranch.known) {
    rejections.push({
      code: WORK_BRANCH_ALREADY_EXISTS,
      message: `workBranch ${JSON.stringify(plan.workBranch)} already exists in ${plan.targetRepo}`,
    });
  }

  // S19 / §4.2 runtime rejection: the base is the base branch's HEAD at run
  // start (spec §4.2 — the work branch is cut from it, and each layer's base
  // is W's rolling HEAD), derived at runtime rather than a plan-file field. A
  // repository with zero commits at all is the honest fixture: its branch is
  // unborn and does not resolve to any commit yet.
  const base = await probeRef(plan.targetRepo, `${baseBranch}^{commit}`);
  if ("unreadable" in base) {
    // Same three-way split as the work branch above. This one already
    // rejected on an unreadable repo — but it said the branch "does not
    // resolve to a real commit", which is a claim about the branch, when the
    // truth is that nothing about the directory could be read at all.
    rejections.push({
      code: BASE_NOT_A_COMMIT,
      message:
        `cannot determine whether base branch ${JSON.stringify(baseBranch)} resolves to a commit in ` +
        `${plan.targetRepo} (is it a git repository?): ${base.unreadable}`,
    });
  } else if (!base.known) {
    rejections.push({
      code: BASE_NOT_A_COMMIT,
      message: `base branch ${JSON.stringify(baseBranch)} does not resolve to a real commit in ${plan.targetRepo}`,
    });
  }

  // S22 / §4.2.1: C checks out the target repo's own worktree onto W — that
  // is the main path, not a side effect — so it must never run on top of
  // work a human left uncommitted. Measured with `git status --porcelain`,
  // never `git diff`: diff is blind to an untracked file's content (§9.2's
  // own warning, same reasoning as S17's byte-identical porcelain check).
  const porcelain = await porcelainOf(plan.targetRepo);
  if ("unreadable" in porcelain) {
    rejections.push({
      code: DIRTY_WORKTREE,
      message:
        `cannot determine whether the worktree of ${plan.targetRepo} is clean ` +
        `(is it a git repository?): ${porcelain.unreadable}`,
    });
  } else if (porcelain.output.length > 0) {
    rejections.push({
      code: DIRTY_WORKTREE,
      message: `target repo worktree is not clean: ${plan.targetRepo}`,
    });
  }

  return { rejections };
}
