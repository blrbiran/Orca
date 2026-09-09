import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withCorrectionsDir } from "../corrections/harness.js";
import { FUTURE_ROWS_WITHOUT_AS_OF, MetricsRejection, collect, fsArchiveIo } from "../../src/metrics/collect.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

/**
 * ⚠️ undo.how 必须含路径或 camelCase/snake_case,否则 undoHowIsExecutable 为 false
 * ⇒ validateLine 判 downgraded 而不是 ok。"git revert abc123" 就是这样(现测)。
 */
function decision(id: string, at: string, opts: { executable?: boolean; kind?: string } = {}): string {
  return JSON.stringify({
    ev: "decision", id, at, run: id.split("/")[0], question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: {
      how: opts.executable === false ? "看情况再说" : "git revert abc123 -- src/foo.ts",
      cost: "low", blast_radius: "one file",
    },
    scope: "repo", kind: opts.kind ?? "interface",
  });
}

const NOW = () => "2026-09-09T00:00:00.000Z";

describe("collect + --as-of (E2 spec §4.2, §5.1)", () => {
  it("filters rows newer than --as-of and reports how many", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(
        join(repo, ".decisions", "orca-dev-1.jsonl"),
        `${decision("orca-dev-1/1", "2026-01-01T00:00:00.000Z")}\n${decision("orca-dev-1/2", "2099-01-01T00:00:00.000Z")}\n`,
      );

      const obs = await collect({ root, repos: [], correctionsDir: store, asOf: "2026-06-01T00:00:00.000Z" });

      expect(obs.decisions.map((d) => d.id)).toEqual(["orca-dev-1/1"]);
      expect(obs.excludedAsFuture).toBe(1);
      expect(obs.asOfMode).toBe("explicit");
      expect(obs.asOf).toBe("2026-06-01T00:00:00.000Z");
      expect(obs.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/a"]);
    });
  });

  // 🔴 一个【有仓库、零决策】的乖仓库必须出现在 repos 里 —— 那是扫描机制存在的理由。
  it("keeps a repository with decisions=0 in repos — that is the one the scan exists to catch", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      await repoWithRemote(root, "empty", "https://github.com/biran/empty.git");

      const obs = await collect({ root, repos: [], correctionsDir: store, now: NOW });
      expect(obs.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/empty"]);
      expect(obs.decisions).toEqual([]);
    });
  });

  // 🔴 rejected 与 downgraded 是两件事,而且都不是坏行。
  it("keeps a downgraded decision, drops a rejected one, and calls neither a malformed line", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      const rejected = JSON.stringify({ ev: "decision", id: "orca-dev-1/3" });
      await writeFile(
        join(repo, ".decisions", "orca-dev-1.jsonl"),
        `${decision("orca-dev-1/1", "2026-01-01T00:00:00.000Z")}\n` +
          `${decision("orca-dev-1/2", "2026-01-02T00:00:00.000Z", { executable: false })}\n` +
          `${rejected}\n`,
      );

      const obs = await collect({ root, repos: [], correctionsDir: store, now: NOW });

      expect(obs.decisions.map((d) => [d.id, d.verdict])).toEqual([
        ["orca-dev-1/1", "ok"],
        ["orca-dev-1/2", "downgraded"],
      ]);
      expect(obs.malformed).toEqual([]);
    });
  });

  it("WITHOUT --as-of, a future row is a named refusal — not a silent skip", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"), `${decision("orca-dev-1/1", "2099-01-01T00:00:00.000Z")}\n`);

      const error = await collect({ root, repos: [], correctionsDir: store, now: NOW }).then(
        () => {
          throw new Error("a row dated 2099 was accepted with no --as-of");
        },
        (e: unknown) => e,
      );

      expect((error as MetricsRejection).code).toBe(FUTURE_ROWS_WITHOUT_AS_OF);
      expect((error as Error).message).toContain("orca-dev-1/1");
    });
  });

  /**
   * 🔴 变异 20 的【正向对照】。「读侧不取锁」是「什么都没发生」,不可能直接红。
   * 现测 storeLock.ts 的 STORE_LOCK_TIMEOUT_MS = 1_000 ⇒ 若读侧取了同一把锁,
   * 这里会在 ~1s 抛 CorrectRejection,远早于 5000ms 超时 ⇒ 是抛错红,不是超时红。
   */
  it("reads while the store lock is held — the read side takes nothing", { timeout: 5000 }, async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      const { withStoreLock } = await import("../../src/corrections/storeLock.js");

      let collected = false;
      await withStoreLock(store, async () => {
        await collect({ root, repos: [], correctionsDir: store, now: NOW });
        collected = true;
      });
      expect(collected).toBe(true);
    });
  });

  /**
   * 🔴 真正能把「一层定点查」偷偷变成「全扫」的地方在这里,不在纯层:
   * resolve.ts 只有三个原语,表达不了递归;而 fsArchiveIo.listYearDirs 是真 fs。
   * ⇒ 这条判据【正向观测遍历规模】。
   */
  it("lists only the top level of archive/ — a nested dir must not become a year dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    const archive = join(repo, ".decisions", "archive");
    await mkdir(join(archive, "2026", "nested"), { recursive: true });
    await mkdir(join(archive, "2025"), { recursive: true });
    await writeFile(join(archive, "2026", "nested", "orca-fix-deadbeef.jsonl"), "");

    const years = await fsArchiveIo.listYearDirs(repo);

    expect(years).toEqual(["2025", "2026"]);
    for (const y of years) expect(y).not.toContain("/");
  });

  it("carries every malformed line through, with its file and line", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"), `{ not json\n`);

      const obs = await collect({ root, repos: [], correctionsDir: store, now: NOW });
      expect(obs.malformed).toHaveLength(1);
      expect(obs.malformed[0].line).toBe(1);
      expect(obs.malformed[0].torn).toBe(false);
    });
  });
});
