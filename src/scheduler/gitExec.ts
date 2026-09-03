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
 * is where "one more copy" stops being cheaper than a home — so this is the
 * home. `reconcile.ts` and `ledgerWiring.ts` import it; `land.ts` and `run.ts`
 * still carry their own, and converging them is a change to two files this
 * task has no reason to touch either (Rule 3). Registered, not hidden: three
 * definitions remain, down from the four this task would otherwise have left.
 *
 * `execFile`, never a shell: every argument here is data (a ref name, a path,
 * a commit message) and several of them come out of a plan file, so a shell
 * would make a task id with a `;` in it a command.
 */
export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}
