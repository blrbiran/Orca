/**
 * Flow engine spec §4.2 `check` and §12.1 `{{base:<path>}}`: the step's acceptance checks run, in template order, in a
 * temporary worktree of the execution's composition (§5.3), never in the person's folder. `{{base:<path>}}` is a
 * read-only temp copy of `<path>` as it was at the base. A `gate` that exits non-zero fails the execution; `diagnostic`
 * output is recorded and reaches the next prompts through the record's projection. Output is bounded (64 KiB per
 * check, the cut recorded). No model is involved (Rule 5).
 */
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandVars, type VarScope } from "../template/vars.js";
import { expansionParams } from "../params.js";
import { bounded } from "../prompt.js";
import { vaultGit, vaultGitBytes, type Vault } from "../vault/vault.js";
import type { KindDefinition } from "./registry.js";
import type { FlowCheck } from "../template/schema.js";

export const CHECK_OUTPUT_MAX_BYTES = 64 * 1024;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;

export interface CheckResult { id: string; role: "gate" | "diagnostic"; exitCode: number; output: string; cut: number }

/** `sh -c` in `cwd`, stdout and stderr together; a timeout is exit 124 as timeout(1) reports it. */
export function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const take = (chunk: Buffer) => { if (size <= CHECK_OUTPUT_MAX_BYTES * 2) { chunks.push(chunk); size += chunk.length; } };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGKILL"), CHECK_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ exitCode: code ?? (signal === "SIGKILL" ? 124 : 1), output: Buffer.concat(chunks).toString("utf8") }); });
  });
}

/** The composition's tree written out under `dir` (a private index; the vault's HEAD is never read). */
async function materialize(vault: Vault, commit: string, dir: string): Promise<void> {
  const index = join(dir, "..", `index-${Math.random().toString(36).slice(2)}`);
  try {
    await vaultGit(vault, ["read-tree", commit], { env: { GIT_INDEX_FILE: index } });
    await vaultGit(vault, ["checkout-index", "-a", "-f"], { env: { GIT_INDEX_FILE: index }, workTree: dir });
  } finally { await rm(index, { force: true }); }
}

/**
 * The checks in a throwaway tree at `commit` (§4.2 `check`, §12.1 `{{base:<path>}}`): each runs in template order in a
 * private worktree of the composition, never in the person's folder, with the base copies read from the commit. A
 * `work` step reuses this after its child lands (the landed commit is the tree the checks judge, `baseCommit` the
 * composition `{{base:<path>}}` reads). With `onError` a check that cannot expand or run is recorded instead of
 * throwing (a diagnostic never breaks a step).
 */
export async function runAcceptance(input: {
  checks: readonly FlowCheck[];
  vault: Vault | null;
  commit: string | null;
  /** Where `{{base:<path>}}` is read; `commit` when absent (the `check` kind's base is the tree it runs in). */
  baseCommit?: string | null;
  scope: Omit<VarScope, "workspace" | "base">;
  runCommand: (command: string, cwd: string) => Promise<{ exitCode: number; output: string }>;
  onError?: (check: FlowCheck, index: number, error: unknown) => CheckResult;
}): Promise<CheckResult[]> {
  const baseAt = input.baseCommit === undefined ? input.commit : input.baseCommit;
  const onError = input.onError;
  const root = await mkdtemp(join(tmpdir(), "orca-flow-check-"));
  try {
    const work = join(root, "work");
    const bases = join(root, "base");
    await mkdir(work, { mode: 0o700 }); await mkdir(bases, { mode: 0o700 });
    if (input.vault !== null && input.commit !== null) {
      try { await materialize(input.vault, input.commit, work); }
      catch (error) {
        if (onError === undefined) throw error;
        return input.checks.map((check, i) => onError(check, i, error));
      }
    }
    let n = 0;
    const baseCopies = new Map<string, string>();
    const results: CheckResult[] = [];
    for (const [i, check] of input.checks.entries()) {
      // {{base:<path>}}: resolved before the command runs; a path the base lacks is an empty read-only file.
      const pending: Array<Promise<void>> = [];
      const base = (path: string): string => {
        const known = baseCopies.get(path);
        if (known !== undefined) return known;
        const file = join(bases, `${n += 1}-${path.replace(/[^A-Za-z0-9._-]/g, "_")}`);
        baseCopies.set(path, file);
        pending.push((async () => {
          const bytes = input.vault === null || baseAt === null ? Buffer.alloc(0)
            : await vaultGitBytes(input.vault, ["cat-file", "blob", `${baseAt}:${path}`]).catch(() => Buffer.alloc(0));
          await writeFile(file, bytes, { mode: 0o400 });
          await chmod(file, 0o400);
        })());
        return file;
      };
      let command: string;
      try { command = expandVars(check.run, { ...input.scope, workspace: work, base }, "command"); }
      catch (error) {
        // The copies the expansion asked for are still being written: settle them before the report, never an unhandled
        // rejection racing the finally's removal of the tree.
        await Promise.allSettled(pending);
        if (onError === undefined) throw error;
        results.push(onError(check, i, error));
        continue;
      }
      try {
        await Promise.all(pending);
        const ran = await input.runCommand(command, work);
        const out = bounded(ran.output, CHECK_OUTPUT_MAX_BYTES);
        results.push({ id: check.id ?? `check-${i + 1}`, role: check.role, exitCode: ran.exitCode, output: out.text, cut: out.cut });
      } catch (error) {
        if (onError === undefined) throw error;
        results.push(onError(check, i, error));
      }
    }
    return results;
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** A record's `checks` for later prompts (§12.1); absent or empty yields "" (a `work` step without diagnostics). */
export function checksProjection(record: unknown): string {
  const checks = (record as { checks?: readonly CheckResult[] } | null)?.checks;
  if (checks === undefined || checks.length === 0) return "";
  return checks.map((c) => `check ${c.id} (${c.role}) exit ${c.exitCode}${c.cut > 0 ? ` (output cut by ${c.cut} bytes)` : ""}:\n${c.output.trimEnd()}`).join("\n");
}

export const CHECK_KIND: KindDefinition = {
  kind: "check", kindVersion: 1, interactive: false,
  async start(ctx) {
    if (ctx.step.kind !== "check") throw new Error("orca: check kind on a non-check step");
    const composition = await ctx.composition();
    const results = await runAcceptance({
      checks: ctx.step.acceptance.checks,
      vault: composition?.vault ?? null,
      commit: composition?.commit ?? null,
      scope: { params: expansionParams(ctx.env, ctx.run), runId: ctx.run.row.id, skillDirs: {} },
      runCommand: ctx.runCommand,
    });
    const record = { checks: results };
    const failedGate = results.find((r) => r.role === "gate" && r.exitCode !== 0);
    return failedGate === undefined ? { done: { record } } : { failed: { reason: `gate-failed:${failedGate.id}`, record } };
  },
  projection: checksProjection,
};
