import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId, deriveFixRunId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import { MetricsRejection } from "../../src/metrics/rejection.js";
import { ARCHIVE_NAME_AMBIGUOUS, resolveOverturned } from "../../src/metrics/resolve.js";
import type { ArchiveIo } from "../../src/metrics/resolve.js";

function correction(overrides: Partial<Omit<Correction, "id">> = {}): Correction {
  const base = {
    projectKey: "github.com/biran/orca",
    decisionId: "orca-dev-1/1",
    kind: "wrong" as const,
    because: "证据不对",
    at: "2026-03-01T00:00:00.000Z",
    by: "amy",
    ...overrides,
  };
  return { id: deriveCorrectionId(base), ...base };
}

/** 一个记账的 io:记下它被问过哪些路径,好让判据能观测【遍历规模】。 */
function io(files: Record<string, string>, yearDirs: string[] = []): ArchiveIo & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async listYearDirs() {
      return yearDirs;
    },
    async statFile(path) {
      asked.push(path);
      return path in files;
    },
    async readFile(path) {
      return files[path];
    },
  };
}

function fixRunPath(c: Correction, year: string): string {
  const { id: _id, ...row } = c;
  return `/repo/.decisions/archive/${year}/${deriveFixRunId(row, c.id)}.jsonl`;
}

function scanned(decisionIds: string[], closed: string[] = []) {
  return { overturnedCorrectionIds: new Set(closed), decisionIds: new Set(decisionIds) };
}

describe("resolveOverturned (E2 spec §3.4.1, §3.4.2; A' §3.7.1 pins archive/<YYYY>/)", () => {
  it("finds an overturned that archiving moved into archive/<year>/, so a closed correction stays closed", async () => {
    const c = correction();
    const path = fixRunPath(c, "2026");
    const line = JSON.stringify({
      ev: "overturned", id: c.decisionId, correctionId: c.id,
      replacedBy: "orca-fix-x/1", at: "2026-05-01T00:00:00.000Z", run: "orca-fix-x",
    });

    const out = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: scanned([c.decisionId]) },
      io({ [path]: `${line}\n` }, ["2026"]),
    );

    expect(out.overturned.map((o) => o.correctionId)).toEqual([c.id]);
    expect(out.overturned[0].at).toBe("2026-05-01T00:00:00.000Z");
    expect(out.unresolvedDecisions).toEqual([]);
  });

  // 🔴 一层定点查,不是递归全扫。只断言「找到了」的话,全扫也会绿 ⇒ 正向观测遍历规模。
  it("asks for exactly one path per year dir — never walks the archive tree", async () => {
    const c = correction();
    const theIo = io({}, ["2024", "2025", "2026"]);
    await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: scanned([c.decisionId]) },
      theIo,
    );
    expect(theIo.asked).toHaveLength(3);
    for (const p of theIo.asked) expect(p).toMatch(/archive\/20\d\d\/orca-fix-[0-9a-f]{8}\.jsonl$/);
  });

  it("refuses when the derived filename appears under two year dirs — that is a real ambiguity", async () => {
    const c = correction();
    const a = fixRunPath(c, "2025");
    const b = fixRunPath(c, "2026");

    const error = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: scanned([c.decisionId]) },
      io({ [a]: "", [b]: "" }, ["2025", "2026"]),
    ).then(
      () => {
        throw new Error("accepted an ambiguous archive name");
      },
      (e: unknown) => e,
    );

    expect((error as MetricsRejection).code).toBe(ARCHIVE_NAME_AMBIGUOUS);
    expect((error as Error).message).toContain("2025");
    expect((error as Error).message).toContain("2026");
  });

  // 变异 8 的落点 —— 决策扫不到 ⇒ 报告,不硬拒。
  it("reports a correction whose decision is outside what was scanned, instead of refusing", async () => {
    const c = correction({ decisionId: "orca-dev-archived/7" });
    const out = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: scanned([]) },
      io({}, []),
    );
    expect(out.unresolvedDecisions).toEqual([
      { correctionId: c.id, projectKey: c.projectKey, decisionId: "orca-dev-archived/7" },
    ]);
    expect(out.overturned).toEqual([]);
  });

  it("does not go to the archive at all for a correction the default scan already closed", async () => {
    const c = correction();
    const theIo = io({}, ["2026"]);
    await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: scanned([c.decisionId], [c.id]) },
      theIo,
    );
    // spec §3.4.2:代价是【每条未闭环 correction】一次 stat。已闭环的一次都不问。
    expect(theIo.asked).toEqual([]);
  });

  it("is pure: no node: import and no clock", async () => {
    const src = await readFile(new URL("../../src/metrics/resolve.ts", import.meta.url), "utf8");
    // 剥注释后再判 —— 见 compute.test.ts 里同形的那条。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+"node:/);
    expect(code).not.toMatch(/\bnew Date\s*\(/);
    expect(code).not.toMatch(/\bDate\.now\s*\(/);
    expect(code).not.toMatch(/\bperformance\.now\s*\(/);
  });
});
