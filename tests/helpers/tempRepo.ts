import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";

/** realpath: on macOS tmpdir is under /var, a symlink, and git reports /private/var. */
export async function tempRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-repo-")));
  await git(dir, ["init", "-q", "-b", "main"]);
  await commitFile(dir, "README.md", "fixture\n", "init");
  return dir;
}

export async function commitFile(repo: string, name: string, content: string, message: string): Promise<void> {
  await writeFile(join(repo, name), content);
  await git(repo, ["add", "--", name]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", message]);
}
