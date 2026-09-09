import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { withCorrectionsDir } from "../corrections/harness.js";
import { captureStdout } from "../scheduler/sandbox.js";
import { buildFixture } from "./buildFixture.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "..", "fixtures", "metrics", "golden.json");
const AS_OF = "2026-09-09T00:00:00.000Z";

const newRoot = () => mkdtemp(join(tmpdir(), "orca-metrics-cli-"));

async function bareRepo(root: string, name: string, remote?: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  if (remote !== undefined) await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

describe("orca metrics (E2 spec §7)", () => {
  it("matches the golden byte for byte", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store);
      const { result, stdout } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(0);
      expect(stdout).toBe(await readFile(GOLDEN, "utf8"));
    });
  });

  it("① the integrity gate: a store key neither mechanism resolves ⇒ exit 1", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store);
      const other = await newRoot();              // 一个不含任何仓库的 root
      const { result } = await captureStdout(() =>
        main(["metrics", "--root", other, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(1);
    });
  });

  it("② one projectKey on two paths ⇒ exit 1", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store);
      await bareRepo(root, "alpha-twin", "https://github.com/biran/alpha.git");
      const { result } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(1);
    });
  });

  it("③ no --as-of and a row dated 2099 ⇒ exit 1", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store);
      await writeFile(
        join(root, "beta", ".decisions", "future.jsonl"),
        `${JSON.stringify({
          ev: "decision", id: "orca-dev-b/99", at: "2099-01-01T00:00:00.000Z", run: "orca-dev-b",
          question: "q", chose: "a", alternatives: [{ option: "b", why_not: "no" }], because: "r",
          undo: { how: "git revert abc123 -- src/foo.ts", cost: "low", blast_radius: "one file" },
          scope: "repo", kind: "interface",
        })}\n`,
      );
      const { result } = await captureStdout(() => main(["metrics", "--root", root, "--json"]));
      expect(result).toBe(1);
    });
  });

  /**
   * 🔴 spec §7 ④ 的加固形状:只断言退出码的话,把 §5.2 改回硬拒【也会绿】。
   * 必须同时断言报告整份打印出来了。
   */
  it("④ a corrupt MIDDLE line ⇒ exit 6, AND the report still prints in full", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store, { corruptMiddleLine: true });
      const { result, stdout } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(6);
      expect(stdout.length).toBeGreaterThan(0);
      expect(JSON.parse(stdout).malformed_lines).toHaveLength(1);
    });
  });

  it("a torn LAST line in the store is exit 0 and says a write may be in flight", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store, { tornStoreTail: true });
      const { result, stdout } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.malformed_lines).toHaveLength(1);
      expect(parsed.malformed_lines[0].torn).toBe(true);
      expect(parsed.malformed_lines[0].reason).toContain("still being written");
    });
  });

  it("a torn store tail AND a corrupt ledger middle line together are still exit 6", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store, { tornStoreTail: true, corruptMiddleLine: true });
      const { result, stdout } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      expect(result).toBe(6);
      expect(JSON.parse(stdout).malformed_lines).toHaveLength(2);
    });
  });

  // 🔴 Rule 17:CLI 必须认改道,否则 golden 判据会去读使用者真实的 ~/.orca。
  it("reads the corrections store ORCA_CORRECTIONS_DIR points at, not the real ~/.orca", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await newRoot();
      await buildFixture(root, store);
      const { stdout } = await captureStdout(() =>
        main(["metrics", "--root", root, "--as-of", AS_OF, "--json"]),
      );
      // 夹具的 store 里有 3 条 correction。读错目录就不可能是 3。
      expect(JSON.parse(stdout).correction_rate.corrections_total_including_stale).toBe(3);
      expect(store).toContain("orca-corrections-");
    });
  });
});
