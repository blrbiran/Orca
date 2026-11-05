import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { READ_ROWS } from "../../src/commands/domains/reads.js";
import { runViewSchema } from "../../src/control/webProtocol.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { openTestStore } from "../control/fixtures/store.js";

// Session 3cfc2e73 D7 (tester issue #158, Orca half): an omp execute answer ccloop's strict shape refuses fails the run,
// and the attempt's work survives only under ccloop's attempt refs. ccloop (from 963b856) names them in
// <runDir>/execute-format-failure.json. The run diagnosis and `orca run show` now name the refs and, read-only, what each
// changed against the attempt's base, so a person can take the work by hand. A fake run dir; a real temp git repository.
const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const g = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
const REF = "refs/ccloop/run-1/attempts/1", MISSING = "refs/ccloop/claim-9/attempts/1";

function world() {
  const root = mkdtempSync(join(tmpdir(), "ffw-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  g(root, "init", "-q", "-b", "main", repo);
  writeFileSync(join(repo, "src", "a.js"), "export const a = 1;\n");
  g(repo, "add", "-A"); g(repo, "commit", "-q", "-m", "base");
  const base = g(repo, "rev-parse", "HEAD");
  // The attempt's work, committed off the branch and pinned only by the attempt ref, as ccloop's cleanup does.
  writeFileSync(join(repo, "answer.txt"), "42\n");
  writeFileSync(join(repo, "src", "a.js"), "export const a = 2;\n");
  g(repo, "add", "-A"); g(repo, "commit", "-q", "-m", "attempt");
  const attempt = g(repo, "rev-parse", "HEAD");
  g(repo, "update-ref", REF, attempt);
  g(repo, "reset", "-q", "--hard", base);
  const sourceDir = join(root, "source");
  mkdirSync(join(sourceDir, "run"), { recursive: true });
  const write = (body: unknown) => writeFileSync(join(sourceDir, "run", "execute-format-failure.json"), typeof body === "string" ? body : JSON.stringify(body), { mode: 0o600 });
  const file = { schema: "ccloop-omp-execute-format-failure-v1", attempt: 1, evidenceDir: join(sourceDir, "run", "calls", "x"), attemptRefs: [REF, MISSING], attemptBase: base,
    normalization: { reason: "execution-format-invalid", issues: [{ path: "", message: "Unrecognized key(s) in object: 'schema', 'goal'" }] } };
  return { repo, base, attempt, sourceDir, write, file };
}
const run = (sourceDir: string, targetRepo: string | null) => ({ groupId: "g", workItemId: "w", taskId: "t", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "exec-1",
  providerAttemptOrdinal: 1, phase: "work" as const, progress: null, failureCode: null, drive: { sourceDir, targetRepo, envelopeHash: null, failureCause: null } });
const diagnosisShape = (runViewSchema as unknown as { shape: { diagnosis: { safeParse(v: unknown): { success: boolean } } } }).shape.diagnosis;

describe("an omp execute format failure's kept work (D7, #158)", () => {
  it("the diagnosis names each attempt ref, its commit, the files and the diff stat against the base; a ref not in the repository has no commit", async () => {
    const w = world();
    w.write(w.file);
    const h = await openTestStore();
    try {
      const diagnosis = readRunDiagnosis(h.store, run(w.sourceDir, w.repo));
      expect(diagnosis.formatFailureWork).toMatchObject({ attempt: 1, attemptBase: w.base,
        issues: [{ path: "", message: "Unrecognized key(s) in object: 'schema', 'goal'" }] });
      const [kept, missing] = diagnosis.formatFailureWork!.refs;
      expect(kept).toMatchObject({ ref: REF, commit: w.attempt, files: ["answer.txt", "src/a.js"], filesMore: false });
      expect(kept!.stat.join("\n")).toContain("answer.txt");
      expect(kept!.stat.at(-1)).toContain("2 files changed");
      expect(missing).toEqual({ ref: MISSING, commit: null, files: [], filesMore: false, stat: [] });
      expect(diagnosisShape.safeParse(diagnosis).success).toBe(true);
      // Read-only: the branch and the working tree are as they were.
      expect(g(w.repo, "rev-parse", "HEAD")).toBe(w.base);
      expect(g(w.repo, "status", "--porcelain")).toBe("");
    } finally { await h.dispose(); }
  });

  it("an absent file (an older ccloop pin) or a malformed one gives no formatFailureWork and no error", async () => {
    const w = world();
    const h = await openTestStore();
    try {
      const without = () => Object.hasOwn(readRunDiagnosis(h.store, run(w.sourceDir, w.repo)), "formatFailureWork");
      expect(without()).toBe(false);
      for (const bad of ["{not json", JSON.stringify({ ...w.file, schema: "other" }), JSON.stringify({ ...w.file, attemptRefs: ["--output=/tmp/x"] }),
        JSON.stringify({ ...w.file, attemptRefs: ["refs/ccloop/../heads/main"] }), JSON.stringify({ ...w.file, attemptBase: "HEAD" }), JSON.stringify([])]) {
        w.write(bad);
        expect(without()).toBe(false);
      }
      expect(Object.hasOwn(readRunDiagnosis(h.store, { ...run(w.sourceDir, w.repo), drive: { envelopeHash: null, failureCause: null } }), "formatFailureWork")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("orca run show's human output names the refs, the files changed, the stat and the read-only git to see it", () => {
    const w = world();
    const row = READ_ROWS.find((r) => r.domain === "run" && r.action === "show")!;
    const work = { attempt: 1, attemptBase: w.base, issues: [{ path: "", message: "Unrecognized key(s)" }], refs: [
      { ref: REF, commit: w.attempt, files: ["answer.txt", "src/a.js"], filesMore: false, stat: [" answer.txt | 1 +", " src/a.js   | 2 +-", " 2 files changed, 2 insertions(+), 1 deletion(-)"] },
      { ref: MISSING, commit: null, files: [], filesMore: false, stat: [] }] };
    const text = row.format({ groupId: "g", run: { runId: "run-1", state: "failed", diagnosis: { formatFailureWork: work } }, activity: { entries: [] }, evidence: { count: 0 } });
    expect(text).toContain(`execute format failure (attempt 1): the attempt's work is kept under these refs in the project repository, on base ${w.base.slice(0, 12)}`);
    expect(text).toContain("  refused: (top level): Unrecognized key(s)");
    expect(text).toContain(`  ${REF} = ${w.attempt.slice(0, 12)}: 2 files changed`);
    expect(text).toContain("    answer.txt | 1 +");
    expect(text).toContain(`    see it: git diff ${w.base.slice(0, 12)} ${REF}`);
    expect(text).toContain(`  ${MISSING}: not found in the project repository`);
    expect(row.format({ groupId: "g", run: { runId: "run-1", state: "failed", diagnosis: {} }, activity: { entries: [] }, evidence: { count: 0 } })).not.toContain("execute format failure");
  });
});
