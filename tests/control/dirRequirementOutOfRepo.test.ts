/**
 * Dir-requirements spec §14, §17 criterion D12 (plan Task 7; Rule 17): the D5 requirement path with `HOME`, `TMPDIR` and
 * every `ORCA_*` redirect on separate temporary directories writes nothing outside them.
 *
 * One dir project over a real ccloop build (open → two clarify rounds → consensus → split → accept → export) creates
 * the folder's vault: the vault is exactly `<ORCA_VAULT_DIR>/<vaultKeyOf(folder)>.git`, every directory under it is
 * 0700 and every file owner-only (0600, git's executable sample hooks 0700); nothing appears under `HOME`, and no file
 * left under `TMPDIR` holds a folder file's bytes (a merge or snapshot temporary would). A landing (a commit on the
 * work branch, recorded as `landedTip`, as the driver leaves one) is then placed twice -- under umask 0077 and 0022 --
 * and both times a new file is 0644, a new executable 0755, a new directory 0755, and a pre-existing folder file no
 * landing changes keeps its mode and bytes.
 *
 * The world's own roots are made while `TMPDIR` points at a directory outside the one scanned afterwards, so the scan
 * cannot see the folder or vault themselves.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { recordLandedTip } from "../../src/control/dirGroup.js";
import { placeDirGroups } from "../../src/control/dirPlacement.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { normalizeControlPlan } from "../../src/control/planImport.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { CLARIFY_PROMPT_HEAD } from "../../src/control/requirementClarify.js";
import { readDraft, readRequirementGroup, readRound } from "../../src/control/requirementRecords.js";
import { SPLIT_PROMPT_HEAD } from "../../src/control/requirementSplit.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { ccloopWorlds, raw, realBinary, until } from "./fixtures/ccloopWorld.js";
import { ROUND_ONE, ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-dir-outofrepo-", epochPrefix: "epoch-dir-outofrepo-" });
const ownRoots: string[] = [];

const README = "# Notes\nOrca D12 folder marker: a note-taking tool.\n";
const SOURCE = "export const a = 1; // D12 marker\n";
const estimateFor = (planHash: string) => ({ schema: "budget-estimate-v1", planHash, groupRationale: "one small task",
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 },
  tasks: ["exporter", "images"].map((taskId) => ({ taskId, complexity: "S", confidence: "high", work: { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 },
    handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["the file does not exist yet"] })) });
const answerAll = (runtime: ControlRuntime, roundNo: number, commandId: string) => {
  const result = readRound(runtime.store, "g", roundNo).result!;
  return runtime.service.answerRequirement(raw(runtime, commandId, "requirement-answer", { roundNo,
    answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) }));
};
const planHashOfDraft = (runtime: ControlRuntime, draftNo: number): string => {
  const stored = readDraft(runtime.store, "g", draftNo).plan as { targetRepo: string };
  return sha256Canonical(normalizeControlPlan({ ...schedulerControlPlanSourceOf(stored, stored.targetRepo), repoId: readRequirementGroup(runtime.store, "g").requirement.repoId, planId: `requirement-draft-${draftNo}` }));
};

/** A commit on `parent` with these paths set (mode and bytes), as a landing leaves one. */
function commitOn(vault: string, parent: string, files: Record<string, { content: string; mode: "100644" | "100755" }>): string {
  const scratch = mkdtempSync(join(tmpdir(), "orca-d12-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
    const git = (args: string[], input?: string): string => execFileSync("git", ["--git-dir", vault, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", env, ...(input === undefined ? {} : { input }) }).trim();
    git(["read-tree", parent]);
    const puts = Object.entries(files).map(([path, { content, mode }]) => `${mode} ${git(["hash-object", "-w", "--stdin"], content)}\t${path}`);
    git(["update-index", "--index-info"], puts.map((line) => `${line}\n`).join(""));
    return git(["commit-tree", git(["write-tree"]), "-p", parent, "-F", "-"], "landing");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const modeOf = (path: string): number => statSync(path).mode & 0o7777;
const read = (root: string, path: string): string => readFileSync(join(root, path), "utf8");

describe.skipIf(!realBinary)("a dir requirement writes only to its redirected roots (D12)", { timeout: 300_000 }, () => {
  relocateHome("orca-dir-outofrepo-home-");
  afterAll(removeRoots);

  it("creates a private vault, leaves HOME and TMPDIR clean, and places the same folder modes under umask 0077 and 0022", async () => {
    const base = mkdtempSync(join(tmpdir(), "orca-dir-outofrepo-world-"));
    const leak = mkdtempSync(join(tmpdir(), "orca-dir-outofrepo-tmp-"));
    ownRoots.push(base, leak);
    try {
      const folder = join(base, "notes"), vaults = join(base, "vaults"), projectsFile = join(base, "projects.json");
      mkdirSync(join(folder, "src"), { recursive: true });
      writeFileSync(join(folder, "README.md"), README);
      writeFileSync(join(folder, "src", "a.ts"), SOURCE);
      writeFileSync(join(folder, "keep.md"), "keep\n");
      chmodSync(join(folder, "keep.md"), 0o640);
      vi.stubEnv("ORCA_VAULT_DIR", vaults);
      vi.stubEnv("ORCA_PROJECTS_FILE", projectsFile);
      // The world (and its roots, which hold the folder and the vault) is made outside the TMPDIR scanned below.
      process.env.TMPDIR = base;
      const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults, ORCA_PROJECTS_FILE: projectsFile },
        extraRepos: [{ projectKey: "notes", path: folder, kind: "dir" }] });
      vi.stubEnv("ORCA_CONTROL_DIR", join(w.root, "control"));
      const real = realpathSync(folder).normalize("NFC");
      const vault = join(vaults, `${vaultKeyOf(real)}.git`);
      const repoId = controlRepoKey("notes");
      const runtime = await w.boot();
      try {
        // Everything from here on runs with TMPDIR on the scanned directory.
        process.env.TMPDIR = leak;
        expect(await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
          { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }))).not.toHaveProperty("error");
        const queue = [{ match: CLARIFY_PROMPT_HEAD, output: ROUND_ONE }, { match: CLARIFY_PROMPT_HEAD, output: ROUND_TWO }, { match: SPLIT_PROMPT_HEAD, output: VALID_SPLIT }];
        writeFileSync(w.claudeScriptPath, JSON.stringify({ "single-call-queue": queue }));
        const opened = await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
          target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId, idea: "Let people export their notes as Markdown.", contentLanguage: "en" } } as never);
        expect(opened).toMatchObject({ result: { kind: "requirement-opened" } });
        runtime.startPump(50);
        await until(() => readRound(runtime.store, "g", 1).state === "awaiting-answers", 90_000, "round 1", 50);
        answerAll(runtime, 1, "answer-1");
        await until(() => readRound(runtime.store, "g", 2).state === "awaiting-answers", 90_000, "round 2", 50);
        expect(answerAll(runtime, 2, "answer-2")).toMatchObject({ result: { nextRoundNo: null } });
        expect(runtime.service.requirementConsensus(raw(runtime, "consensus", "requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { draftNo: 1 } });
        await until(() => { try { return readDraft(runtime.store, "g", 1).state === "awaiting-review"; } catch { return false; } }, 90_000, "draft 1", 50);
        const planHash = planHashOfDraft(runtime, 1);
        writeFileSync(w.claudeScriptPath, JSON.stringify({ "single-call-queue": [...queue, { match: "budget-estimate-request-v1", output: estimateFor(planHash) }] }));
        const accepted = await runtime.service.acceptRequirementDraft(raw(runtime, "accept", "requirement-draft-accept", { draftNo: 1, draftHash: readDraft(runtime.store, "g", 1).draftHash! }));
        expect(accepted).toMatchObject({ result: { kind: "requirement-draft-accepted", estimateState: "queued" } });
        expect(readArchivedPlan(runtime.store, "g").planHash).toBe(planHash);
        const estimateId = (accepted as { result: { estimateId: string } }).result.estimateId;
        await until(() => readEstimateRecord(runtime.store, "g", estimateId).state === "ready" && readRequirementGroup(runtime.store, "g").requirement.export.state === "done", 120_000, "the estimate and the export", 50);
        expect(readRequirementGroup(runtime.store, "g").requirement.export.state).toBe("done");
        // The pump also runs the placement pass every round; stop it so the two landings below are placed once, by
        // this test (the store stays open).
        expect(await runtime.shutdown()).toBe(true);

        // A landing on the work branch, recorded as the driver records one; then the placement pass.
        const document = readRequirementGroup(runtime.store, "g").requirement.export.commit!;
        const env = { ...process.env, ORCA_VAULT_DIR: vaults, ORCA_CONTROL_DIR: join(w.root, "control"), ORCA_PROJECTS_FILE: projectsFile };
        const savedUmask = process.umask(0o077);
        try {
          const first = commitOn(vault, document, { "exports/report.md": { content: "report\n", mode: "100644" }, "bin/tool": { content: "#!/bin/sh\necho hi\n", mode: "100755" } });
          execFileSync("git", ["--git-dir", vault, "update-ref", "refs/heads/orca/g", first, document], { env });
          runtime.store.transaction(() => recordLandedTip(runtime.store, "g", first));
          expect(await placeDirGroups({ store: runtime.store, env })).toBe(true);
        } finally { process.umask(savedUmask); }
        expect(modeOf(join(folder, "exports", "report.md"))).toBe(0o644);
        expect(modeOf(join(folder, "exports"))).toBe(0o755);
        expect(modeOf(join(folder, "bin", "tool"))).toBe(0o755);
        expect(modeOf(join(folder, "bin"))).toBe(0o755);
        // A pre-existing file no landing changes: same mode, same bytes.
        expect(modeOf(join(folder, "keep.md"))).toBe(0o640);
        expect(read(folder, "keep.md")).toBe("keep\n");
        expect(read(folder, "README.md")).toBe(README);

        const savedUmask2 = process.umask(0o022);
        try {
          const tip = execFileSync("git", ["--git-dir", vault, "rev-parse", "refs/heads/orca/g"], { encoding: "utf8", env }).trim();
          const second = commitOn(vault, tip, { "notes/x.md": { content: "x\n", mode: "100644" }, "notes/run.sh": { content: "#!/bin/sh\ntrue\n", mode: "100755" } });
          execFileSync("git", ["--git-dir", vault, "update-ref", "refs/heads/orca/g", second, tip], { env });
          runtime.store.transaction(() => recordLandedTip(runtime.store, "g", second));
          expect(await placeDirGroups({ store: runtime.store, env })).toBe(true);
        } finally { process.umask(savedUmask2); }
        // The same result under the other umask.
        expect(modeOf(join(folder, "notes", "x.md"))).toBe(0o644);
        expect(modeOf(join(folder, "notes"))).toBe(0o755);
        expect(modeOf(join(folder, "notes", "run.sh"))).toBe(0o755);

        // The vault: every directory 0700, every file owner-only (git's executable sample hooks carry the x bit).
        const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? [full, ...walk(full)] : [full]; });
        for (const path of walk(vault)) {
          const mode = modeOf(path);
          expect(mode & 0o077, `${path} is ${mode.toString(8)}`).toBe(0);
          if (statSync(path).isDirectory()) expect(mode).toBe(0o700);
        }
        expect(modeOf(vault)).toBe(0o700);

        // Nothing under HOME, and no file under TMPDIR holds a folder file's bytes.
        expect(readdirSync(process.env.HOME!, { recursive: true })).toEqual([]);
        const markers = [README.trim(), SOURCE.trim(), "keep\n"];
        const left = readdirSync(leak, { recursive: true }).map(String).filter((rel) => { try { return statSync(join(leak, rel)).isFile(); } catch { return false; } });
        for (const rel of left) {
          const bytes = readFileSync(join(leak, rel));
          for (const marker of markers) expect(bytes.includes(marker), `${rel} holds a folder file's bytes`).toBe(false);
        }
      } finally { await w.teardown(); }
    } finally {
      for (const root of ownRoots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
