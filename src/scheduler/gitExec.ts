import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The four-line `git` wrapper this directory kept re-declaring.
 *
 * Task 10's review recorded the duplication as a deferred minor; Task 11 kept
 * a third copy rather than consolidate, on the grounds that there was no
 * shared home and making one meant editing two files that task had no other
 * reason to touch. Task 12 needs a FOURTH consumer (`ledgerWiring.ts`), which
 * is where "one more copy" stops being cheaper than a home — so this became
 * the home, with `land.ts` and `run.ts` left carrying their own and the
 * remaining three definitions registered rather than hidden.
 *
 * ⚠️ That registration is now discharged: this is the ONLY definition. The
 * convergence round that closed it is the one the round after C's execution
 * was told to do, so a fourth copy appearing here again is a regression, not
 * a Rule 3 deferral.
 *
 * `execFile`, never a shell: every argument here is data (a ref name, a path,
 * a commit message) and several of them come out of a plan file, so a shell
 * would make a task id with a `;` in it a command.
 */
export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}

/**
 * The identity every commit orca makes carries, passed per invocation rather
 * than read from the environment — for the same reason ccloop's own
 * worktreeManager does it: the repository being written is frequently a
 * throwaway clone or a CI checkout with no user.email set, where `git merge
 * --no-ff` and `git commit` fail outright. Depending on ambient config would
 * break landing in exactly the setups it exists to serve.
 *
 * ⚠️ Measured, and worth knowing before trusting a mutation of this constant:
 * an absent repository identity is NOT by itself enough to make `git commit`
 * fail — git derives one from the OS user and host and commits with a
 * warning (recorded in P0's ERRATUM 1). It fails when
 * `user.useConfigOnly=true` and the global config is empty, which is the CI
 * shape. So a criterion that deletes this constant will pass on a developer
 * laptop; the reason to keep it is the machine that is not one.
 */
export const ORCA_IDENTITY = ["-c", "user.name=orca", "-c", "user.email=orca@invalid"];
