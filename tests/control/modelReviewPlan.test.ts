import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";
import { REVIEW_INPUT_ITEM_LIMIT, writeReviewInputs } from "../../src/control/modelReview/inputs.js";
import { buildModelReviewPlanSource, FINDINGS_PATH, validatorCommand, type ModelReviewPlanInput } from "../../src/control/modelReview/plan.js";

/**
 * Checks spec 2026-10-22 §6.1 (read-only, enforced by code) and §6.2 (inputs), plan Task 8: the review's one-task plan
 * may write only its findings file and its own decision ledger; its required check is Orca's own validator, invoked by
 * absolute path so the target repository needs nothing installed; the same input gives the same bytes. Its inputs are
 * files under Orca's runs root (private modes), each item bounded with the cut recorded.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exec = promisify(execFile);
const FROM = "a".repeat(40), TO = "b".repeat(40);
const input = (over: Partial<ModelReviewPlanInput> = {}): ModelReviewPlanInput => ({
  source: { kind: "model-review", repoId: "repo", target: "main", from: FROM, to: TO, runSeq: 1 },
  inputDir: "/runs/review-input", inputSha256: "c".repeat(64), groups: ["g1", "g2"], budgetTokens: 1_000_000,
  denylistPaths: ["secrets/**", ".env"], ...over,
});

describe("the model-review plan", () => {
  it("writes only the findings file and its decision ledger, under the union denylist, held to the validator", () => {
    const plan = buildModelReviewPlanSource(input(), "/repo", { agent: "codex" });
    expect(canonicalBytes(buildModelReviewPlanSource(input(), "/repo", { agent: "codex" }))).toEqual(canonicalBytes(plan));
    expect(plan.tasks).toHaveLength(1);
    const contract = taskContractSchema.parse(plan.tasks[0]!.originalContract);
    expect(contract.context.targetPaths).toEqual([FINDINGS_PATH, ".decisions/**"]);
    expect(contract.safetyPolicy.allowlistPaths).toEqual([FINDINGS_PATH, ".decisions/**"]);
    expect(contract.safetyPolicy.denylistPaths).toEqual(["secrets/**", ".env"]);
    expect(contract.verification.requiredChecks).toEqual([validatorCommand(FROM, TO)]);
    expect(contract.executionPolicy.tokenBudget).toBe(1_000_000);
    expect(contract.objective.goal).toContain(`- the range ${FROM}..${TO} on main`);
    expect(contract.objective.goal).toContain("/runs/review-input");
    expect(plan.agent).toEqual({ agent: "codex" });
    expect(FINDINGS_PATH).toBe(".orca-review/findings.json");
  });

  it("names the validator by Orca's absolute dist path, and its source entry exists", () => {
    const command = validatorCommand(FROM, TO);
    expect(command).toBe(`node '${join(ROOT, "dist", "control", "validateFindings.js")}' .orca-review/findings.json ${FROM} ${TO}`);
    expect(existsSync(join(ROOT, "src", "control", "validateFindings.ts"))).toBe(true);
  });

  it("the validator exits 0 on a valid file of the range and 1 (zod error on stderr) otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vf-"));
    try {
      const file = join(dir, "findings.json");
      const run = async (doc: unknown, to = TO) => {
        await writeFile(file, JSON.stringify(doc));
        try { await exec(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "src", "control", "validateFindings.ts"), file, FROM, to]); return { code: 0, stderr: "" }; }
        catch (error) { const e = error as { code: number; stderr: string }; return { code: e.code, stderr: e.stderr }; }
      };
      const ok = { schema: "orca-model-review-findings-v1", range: { from: FROM, to: TO }, findings: [] };
      expect(await run(ok)).toEqual({ code: 0, stderr: "" });
      const wrongRange = await run(ok, "c".repeat(40));
      expect(wrongRange.code).toBe(1);
      expect(wrongRange.stderr).toContain("range-mismatch");
      const bad = await run({ ...ok, findings: [{ id: "x" }] });
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("schema:");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});

describe("the review inputs", () => {
  it("writes one JSON per item plus index.json, dir 0700 and files 0600, and cuts an over-long item by the head rule", async () => {
    const root = await mkdtemp(join(tmpdir(), "ri-"));
    try {
      const dir = join(root, "review-1");
      const big = "x".repeat(REVIEW_INPUT_ITEM_LIMIT + 10);
      const written = await writeReviewInputs(dir, {
        range: { target: "main", from: FROM, to: TO, groups: [] },
        requirements: { g1: big },
        decisions: {}, conflicts: [], instruction: "review",
      });
      expect(written.dir).toBe(dir);
      expect((await readdir(dir)).sort()).toEqual(["conflicts.json", "decisions.json", "index.json", "instruction.json", "range.json", "requirements.json"]);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      for (const name of await readdir(dir)) expect((await stat(join(dir, name))).mode & 0o777).toBe(0o600);
      const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as { items: Array<{ file: string; bytes: number; cut: { kept: number } | null }> };
      const requirements = index.items.find((item) => item.file === "requirements.json")!;
      expect(requirements.cut).toEqual({ kept: REVIEW_INPUT_ITEM_LIMIT });
      expect(index.items.find((item) => item.file === "range.json")!.cut).toBeNull();
      const cut = JSON.parse(await readFile(join(dir, "requirements.json"), "utf8")) as { truncated: boolean; head: string };
      expect(cut.truncated).toBe(true);
      expect(Buffer.byteLength(cut.head)).toBeLessThanOrEqual(REVIEW_INPUT_ITEM_LIMIT);
      const { createHash } = await import("node:crypto");
      expect(written.sha256).toBe(createHash("sha256").update(await readFile(join(dir, "index.json"))).digest("hex"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
