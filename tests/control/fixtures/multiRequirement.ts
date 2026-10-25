import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { WebControlService } from "../../../src/control/webService.js";
import { flowVaultRepoId, vaultPathOfRepoId } from "../../../src/flow/groups.js";
import { vaultKeyOf } from "../../../src/flow/vault/paths.js";
import { controlRepoKey } from "../../../src/panel/controlOptions.js";
import { writeTree } from "./dirRequirement.js";
import { requirementHarness, type QueuedAnswer } from "./requirementHarness.js";

/**
 * A multi group on "repo": members in a deliberately non-alphabetical order -- the `dir` folder "posts" first (the
 * primary) and the git repository "alpha" second. The registry's names are "Posts notes" and "Alpha service".
 */
export async function multiHarness(options: { answers: QueuedAnswer[]; startAt?: "none" | "split"; alphaFileCount?: number }) {
  const x = await requirementHarness({ answers: options.answers, startAt: options.startAt ?? "none" });
  const env: NodeJS.ProcessEnv = {
    HOME: join(x.root, "home"), ORCA_VAULT_DIR: join(x.root, "vaults"), ORCA_CONTROL_DIR: join(x.root, "control"), ORCA_PROJECTS_FILE: join(x.root, "projects.json"),
  };
  mkdirSync(env.HOME!, { mode: 0o700 });
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!);
  const alpha = join(x.root, "alpha");
  // `alphaFileCount`: that many small files in one directory, for the divided-limit test; without it the two above.
  writeTree(alpha, { "README.md": "# Alpha service\nThe alpha service.\n", ...(options.alphaFileCount === undefined ? { "src/a.ts": "export const a = 1;\n" } : {}) });
  if (options.alphaFileCount !== undefined) {
    mkdirSync(join(alpha, "big"), { recursive: true });
    for (let no = 1; no <= options.alphaFileCount; no += 1) writeFileSync(join(alpha, "big", `f${String(no).padStart(4, "0")}.txt`), "x\n");
  }
  const alphaGit = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: alpha, encoding: "utf8" }).trim();
  alphaGit("init", "-q", "-b", "main"); alphaGit("add", "-A"); alphaGit("commit", "-qm", "alpha base");
  const alphaHead = alphaGit("rev-parse", "HEAD");
  const posts = join(x.root, "posts");
  writeTree(posts, { "README.md": "# Posts notes\nthe posts folder.\n", "notes/p1.md": "first post\n" });
  const dirs = [
    { key: "posts", name: "Posts notes", repoId: controlRepoKey("posts"), kind: "dir" as const, path: posts },
    { key: "alpha", name: "Alpha service", repoId: controlRepoKey("alpha"), kind: "repo" as const, path: alpha },
  ];
  const resolveRepository = (repoId: string) => vaultPathOfRepoId(env, repoId) ?? alpha;
  x.deps.env = env;
  x.deps.multiDirProjectOf = (repoId: string) => (repoId === "repo" ? { dirs } : null);
  x.deps.resolveRepository = resolveRepository;
  const service = new WebControlService({ ...x.service.deps, resolveRepository,
    multiDirProjectOf: (repoId: string) => (repoId === "repo" ? { dirs } : null) });
  const body = () => JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as Record<string, unknown>;
  const open = () => service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open-r", actorId: "human", expectedRevision: 0, verb: "requirement-open",
    target: { kind: "group", groupId: "r" }, payload: { groupId: "r", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never);
  // `startAt: "split"` seeds the group consensus leaves behind; the multi list is what requirement-open would have frozen.
  if (options.startAt === "split") {
    const seeded = body();
    const realPosts = realpathSync(posts).normalize("NFC");
    seeded.multiDir = { project: "repo", landing: null, dirs: [
      { key: "posts", repoId: controlRepoKey("posts"), kind: "dir", dirWorkspace: { dir: realPosts, vaultId: vaultKeyOf(realPosts) } },
      { key: "alpha", repoId: controlRepoKey("alpha"), kind: "repo" },
    ] };
    x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(seeded));
  }
  /** The import commit the posts member's vault holds (its one import ref). */
  const postsVault = (): string => {
    const frozen = (body().multiDir as { dirs: Array<{ key: string; dirWorkspace?: { vaultId: string } }> }).dirs[0]!;
    return vaultPathOfRepoId(env, flowVaultRepoId(frozen.dirWorkspace!.vaultId))!;
  };
  const importCommit = (): string => execFileSync("git", ["--git-dir", postsVault(), "for-each-ref", "--format=%(objectname)", "refs/orca/import/"], { encoding: "utf8" }).trim();
  const promptOf = (index: number): string => {
    const envelope = x.fake.calls.accept[index]! as { work: { kind: string; prompt?: string } };
    return envelope.work.prompt!;
  };
  return { ...x, service, env, alpha, alphaHead, posts, postsVault, importCommit, open, body, promptOf,
    dispose: async () => { vi.unstubAllEnvs(); await x.dispose(); } };
}
