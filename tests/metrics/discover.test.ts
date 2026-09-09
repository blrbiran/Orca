import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { MetricsRejection } from "../../src/metrics/rejection.js";
import {
  KEY_MATCHES_MULTIPLE_PATHS,
  REPO_PATH_MISSING,
  UNRESOLVED_PROJECT_KEYS,
  discoverRepos,
  enforceIntegrityGate,
} from "../../src/metrics/discover.js";

const execFileAsync = promisify(execFile);

/**
 * ⚠️ 必须【显式加】URL 形状的 remote:git init 无 remote ⇒ TARGET_HAS_NO_REMOTE;
 *    git clone --local 的 remote 是路径式 ⇒ TARGET_REMOTE_NOT_KEYABLE(spec §1.8)。
 */
async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  await writeFile(join(path, ".decisions", "orca-dev-1.jsonl"), "");
  return path;
}

describe("repo discovery (E2 spec §2.1, §2.1.1)", () => {
  it("scans --root for repos with .decisions/ and keys them by remote, in projectKey order", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "zzz", "https://github.com/biran/a.git");
    await repoWithRemote(root, "aaa", "git@github.com:biran/b.git");

    const found = await discoverRepos({ root, repos: [] });

    // spec §6 item 2:projectKey 字典序,不是 readdir 顺序 —— 夹具刻意让两者相反。
    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/a", "github.com/biran/b"]);
    expect(found.unkeyable).toEqual([]);
  });

  it("skips a repo it cannot key BUT names it — a --local clone must not kill the command", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "good", "https://github.com/biran/good.git");
    await repoWithRemote(root, "pathy", "/tmp/some/bare.git");

    const found = await discoverRepos({ root, repos: [] });

    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/good"]);
    expect(found.unkeyable).toHaveLength(1);
    expect(found.unkeyable[0].path).toContain("pathy");
    expect(found.unkeyable[0].reason).toContain("not a URL");
  });

  it("a repo with no remote at all is also named, not silently dropped", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const path = join(root, "bare");
    await mkdir(join(path, ".decisions"), { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: path });

    const found = await discoverRepos({ root, repos: [] });
    expect(found.repos).toEqual([]);
    expect(found.unkeyable.map((u) => u.path)).toEqual([path]);
  });

  // spec §8 第 12 条点名「任选一个」在两边相同时会照绿。本判据断的是【抛出并列出两个路径】。
  it("refuses when one projectKey maps to two paths, and lists both", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const one = await repoWithRemote(root, "one", "https://github.com/biran/same.git");
    const two = await repoWithRemote(root, "two", "https://github.com/biran/same.git");

    const error = await discoverRepos({ root, repos: [] }).then(
      () => {
        throw new Error("accepted a projectKey that maps to two paths");
      },
      (e: unknown) => e,
    );
    expect((error as MetricsRejection).code).toBe(KEY_MATCHES_MULTIPLE_PATHS);
    expect((error as Error).message).toContain(one);
    expect((error as Error).message).toContain(two);
  });

  it("refuses a --repo whose path does not exist", async () => {
    const error = await discoverRepos({ repos: [{ projectKey: "k", path: "/nope/nothing/here" }] }).then(
      () => {
        throw new Error("accepted a --repo path that is not there");
      },
      (e: unknown) => e,
    );
    expect((error as MetricsRejection).code).toBe(REPO_PATH_MISSING);
  });

  it("the integrity gate refuses a store key that neither mechanism resolves, and names it", () => {
    expect(() =>
      enforceIntegrityGate(
        [{ projectKey: "github.com/biran/a", path: "/a" }],
        ["github.com/biran/a", "github.com/biran/ghost"],
      ),
    ).toThrowError(/github\.com\/biran\/ghost/);

    try {
      enforceIntegrityGate([], ["github.com/biran/ghost"]);
      throw new Error("the gate did not fire");
    } catch (e) {
      expect((e as MetricsRejection).code).toBe(UNRESOLVED_PROJECT_KEYS);
    }
  });

  it("the gate stays quiet when every store key resolves", () => {
    expect(() => enforceIntegrityGate([{ projectKey: "k", path: "/k" }], ["k"])).not.toThrow();
  });
});
