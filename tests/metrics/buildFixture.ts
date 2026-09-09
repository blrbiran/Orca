import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { deriveCorrectionId, deriveFixRunId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import { correctionsFile } from "../../src/corrections/paths.js";

const execFileAsync = promisify(execFile);

/**
 * spec §7's fixture, built deterministically.
 *
 * 🔴 Deterministic on purpose: the same criterion and the golden-generating
 * command must build the SAME store, or the byte-exact diff can never pass.
 * Correction ids and fix run ids are derived from content, so fixed `at` values
 * and fixed text are enough.
 *
 * 🔴 Nothing here produces an absolute path in the OUTPUT: no unkeyable repo
 * and no malformed line in the golden case. Those two are the only report
 * fields that carry filesystem paths, and a golden holding a mkdtemp path would
 * be unreproducible by construction. The corrupt-line case is a separate
 * criterion asserting exit 6, not part of the golden.
 *
 * ⚠️ Each repo gets an explicit URL-shaped remote: `git init` alone leaves no
 * remote (TARGET_HAS_NO_REMOTE) and `git clone --local` leaves a path-style one
 * (TARGET_REMOTE_NOT_KEYABLE) — spec §1.8, §7.
 */
export interface FixtureOptions {
  corruptMiddleLine?: boolean;
  tornStoreTail?: boolean;
}

const AT = {
  d1: "2026-01-05T00:00:00.000Z",
  d2: "2026-01-06T00:00:00.000Z",
  d3: "2026-02-01T00:00:00.000Z",
  c1: "2026-03-01T00:00:00.000Z",
  c2: "2026-03-02T00:00:00.000Z",
  c3: "2026-04-01T00:00:00.000Z",
  fix: "2026-05-01T00:00:00.000Z",
};

function decision(
  id: string,
  at: string,
  kind: string,
  opts: { executable?: boolean } = {},
): string {
  return JSON.stringify({
    ev: "decision", id, at, run: id.split("/")[0], question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: {
      // ⚠️ 现测:"git revert abc123" 不含路径也不含 camelCase ⇒ undoHowIsExecutable 为 false
      //    ⇒ validateLine 判 downgraded。要 ok 必须给一个真的可执行形状。
      how: opts.executable === false ? "看情况再说" : "git revert abc123 -- src/foo.ts",
      cost: "low", blast_radius: "one file",
    },
    scope: "repo", kind,
  });
}

/**
 * ⚠️ `not_my_taste` MUST carry chose_instead: correctionSchema's superRefine
 * requires it there and only there (ruling orca-dev-c1c3c2ec/12). Omitting it
 * does not fail loudly here — the lenient reader turns the row into a MALFORMED
 * LINE, the correction silently leaves every count, and the report grows a
 * temp-directory path that makes the golden unreproducible.
 */
function correction(
  projectKey: string,
  decisionId: string,
  kind: Correction["kind"],
  at: string,
): Correction {
  const base = {
    projectKey,
    decisionId,
    kind,
    ...(kind === "not_my_taste" ? { chose_instead: "另一个方案" } : {}),
    because: "人的理由",
    at,
    by: "amy",
  };
  return { id: deriveCorrectionId(base), ...base };
}

async function repo(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

export async function buildFixture(
  root: string,
  store: string,
  opts: FixtureOptions = {},
): Promise<void> {
  const keyA = "github.com/biran/alpha";
  const keyB = "github.com/biran/beta";
  const a = await repo(root, "alpha", "https://github.com/biran/alpha.git");
  await repo(root, "beta", "https://github.com/biran/beta.git");

  // A' §1.1 的三态各一条:ok / downgraded / rejected。
  // 🔴 rejected 那条【不是坏行】—— 它穿过宽容读取器,由 validateLine 判掉,
  //    所以它不影响 exit 0。这正是 C2 那一刀买到的东西。
  const rejected = JSON.stringify({ ev: "decision", id: "orca-dev-a/9" });
  const lines = [
    decision("orca-dev-a/1", AT.d1, "interface"),
    decision("orca-dev-a/2", AT.d2, "reconcile", { executable: false }),
    decision("orca-dev-a/3", AT.d3, "dependency"),
    rejected,
  ];
  if (opts.corruptMiddleLine) lines.splice(2, 0, "{ not json");
  await writeFile(join(a, ".decisions", "orca-dev-a.jsonl"), `${lines.join("\n")}\n`);

  const c1 = correction(keyA, "orca-dev-a/1", "wrong", AT.c1);
  const c2 = correction(keyA, "orca-dev-a/2", "stale", AT.c2);
  const c3 = correction(keyB, "orca-dev-b/1", "not_my_taste", AT.c3);   // decision 扫不到

  // c1 的 overturned 写在它的 fix run 文件里,并【被归档进 archive/<YYYY>/】——
  // 钉 §3.4.2:一次 git mv 不许让一条已闭环的 correction 复活成积压。
  const { id: _drop, ...c1row } = c1;
  const fixRun = deriveFixRunId(c1row, c1.id);
  await mkdir(join(a, ".decisions", "archive", "2026"), { recursive: true });
  await writeFile(
    join(a, ".decisions", "archive", "2026", `${fixRun}.jsonl`),
    `${JSON.stringify({
      ev: "overturned", id: c1.decisionId, correctionId: c1.id,
      replacedBy: `${fixRun}/1`, at: AT.fix, run: fixRun,
    })}\n`,
  );

  const rows = [c1, c2, c3].map((r) => JSON.stringify(r));
  const text = opts.tornStoreTail
    ? `${rows.join("\n")}\n${JSON.stringify({ id: "c_torn" }).slice(0, 12)}`
    : `${rows.join("\n")}\n`;
  await writeFile(correctionsFile(store), text, { mode: 0o600 });
}
