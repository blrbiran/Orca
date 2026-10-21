import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { normalizeControlPlan } from "../../src/control/planImport.js";
import { CLARIFY_PROMPT_HEAD } from "../../src/control/requirementClarify.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { SPLIT_PROMPT_HEAD } from "../../src/control/requirementSplit.js";
import type { ControlStore } from "../../src/control/store.js";
import * as dispatch from "../../src/control/dispatch.js";
import * as controlCommand from "../../src/entry/controlCommand.js";
import * as operations from "../../src/entry/operations.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";
import { ccloopWorlds, g, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { ROUND_ONE } from "../control/fixtures/requirementOutputs.js";
import { boot, untrackSocketPanel, useSocketPanels } from "../panel/fixtures/socketPanel.js";
import { captureStreams } from "../scheduler/sandbox.js";

/**
 * CLI v2 spec §12.2 (plan Task 15): an agent's whole walk through a requirement and its group, typed as v2 commands only --
 * `main([...])` with `--json`, never `orca control send` (a spy on runControlCommand counts zero calls). The panel is
 * real (socketPanel `boot`) on the real ccloop build (ORCA_CCLOOP_BIN) with ccloopWorld's fake agents table: fake claude
 * answers the requirement's single calls from a queue (the outputs requirementHarness queues, through ccloop's
 * "single-call-queue" because a booted panel has no in-process port to queue into) and fake codex does the task.
 *
 * The task's check passes only once a flag file outside the workspace exists (executionDriverE2E R-F), so run 1 fails
 * with known usage and a retry is allowed. Two agents retry that failure: the first agent's retry (exit 0) is applied
 * while the panel's in-process pump is held (a spy on deliverSchedulerWakes -- test-only, no seam in src), the second
 * agent reads (run 1 still current), and the pump is let go between its read and its send: the re-run claims run 2, so
 * the second retry, naming run 1, is refused task-run-moved (spec §14 R2). Mutation: `task retry` stops filling runId ⇒
 * the second retry is judged against run 2 and that refusal is gone (red at the task-run-moved assertion).
 */
// A short root prefix: the panel's control socket lives under it and a socket path is capped at ~104 bytes.
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "aw-", epochPrefix: "epoch-agent-walk-" });
afterAll(removeRoots);
useSocketPanels();

/** Round 1 asks two questions and closes the frontier, so one answer leads to consensus. */
const ROUND = { ...ROUND_ONE, frontierEmpty: true };
/** One task; fake codex's execute also writes answer.txt, so it is a target (VALID_SPLIT does the same). */
const splitFor = (flag: string) => ({
  tasks: [{ taskId: "exporter", title: "Write the exporter", labels: ["feature"], goal: "Export a note as CommonMark.", successCondition: "src/export.ts exports a note.",
    targetPaths: ["src/export.ts", "answer.txt"], checks: [`test -e ${flag}`], dependsOn: [], traces: ["AC1"] }],
  notes: "One task.",
});
const estimateFor = (planHash: string) => ({ schema: "budget-estimate-v1", planHash, groupRationale: "one small task",
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 },
  tasks: [{ taskId: "exporter", complexity: "S", confidence: "high", work: { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 },
    handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["the file does not exist yet"] }] });

interface Envelope { schema: string; status: number; commandId?: string; body: any }

describe("an agent's walk on v2 commands only (CLI v2 spec §12.2)", { timeout: 600_000 }, () => {
  relocateHome("orca-agent-walk-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("requirement open → answer → consensus → accept → group confirm → start → show → task retry → archive, each exit 0", async () => {
    const w = await world([], { exporter: { files: { "src/export.ts": "export const exported = true;\n" } } }, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    await mkdir(join(w.repo, "src"));
    await writeFile(join(w.repo, "README.md"), "# Notes\nA note-taking tool.\n");
    await writeFile(join(w.repo, "src", "a.ts"), "export const a = 1;\n");
    g(w.repo, "add", "-A"); g(w.repo, "commit", "-qm", "notes");
    const flag = join(w.root, "checks-pass.flag");
    const queue = [{ match: CLARIFY_PROMPT_HEAD, output: ROUND }, { match: SPLIT_PROMPT_HEAD, output: splitFor(flag) }];
    await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call-queue": queue }));
    for (const dir of ["control", "corrections"]) await mkdir(join(w.root, dir), { recursive: true });
    // socketPanel's workspace shape, on the world's repository, with the real ccloop and the world's fake agents table.
    const env = { ORCA_CONTROL_DIR: join(w.root, "control"), ORCA_CORRECTIONS_DIR: join(w.root, "corrections"), ORCA_CCLOOP_BIN: realBinary!, ORCA_AGENTS_TABLE: w.table };
    const panel = await boot({ root: w.root, repo: w.repo, state: join(w.root, "s"), env },
      ["--profile", join(w.root, "profile.json"), "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"]);
    // The pump gate below; opened in finally too, so a red step never leaves the pump parked under a closing panel.
    let openGate = (): void => undefined;
    try {
      expect(panel.socketPath).not.toBeNull();
      const stateDir = dirname(panel.socketPath!);
      const sendSpy = vi.spyOn(controlCommand, "runControlCommand");
      /** One v2 command as an agent types it; the one JSON line it prints. */
      const orca = async (...argv: string[]): Promise<{ code: number; out: Envelope; stderr: string }> => {
        const { result, stdout, stderr } = await captureStreams(() => main([...argv, "--json", "--project", "proj", "--control-state-dir", stateDir]));
        const lines = stdout.trim().split("\n");
        expect(lines, `orca ${argv.join(" ")}: ${stdout}${stderr}`).toHaveLength(1);
        return { code: result, out: JSON.parse(lines[0]!) as Envelope, stderr };
      };
      const ok = async (...argv: string[]): Promise<Envelope> => {
        const { code, out, stderr } = await orca(...argv);
        expect(code, `orca ${argv.join(" ")} answered ${JSON.stringify(out)} ${stderr}`).toBe(0);
        return out;
      };
      // The harness's own eyes (not an agent's): the store, read-only, for the waits and the plan hash.
      const rows = (sql: string): Array<Record<string, unknown>> => {
        const db = new DatabaseSync(join(stateDir, "control.sqlite"), { readOnly: true });
        try { db.exec("PRAGMA busy_timeout=5000"); return db.prepare(sql).all() as Array<Record<string, unknown>>; } finally { db.close(); }
      };
      const state = (table: "requirement_rounds" | "requirement_drafts", no: string, n: number): string | undefined =>
        rows(`SELECT state FROM ${table} WHERE group_id='g' AND ${no}=${n}`)[0]?.state as string | undefined;
      const work = (): { status: string; currentRunId: string | null } => JSON.parse(String(rows("SELECT body FROM work_items WHERE group_id='g' AND id='exporter'")[0]!.body));
      const runState = (runId: string): string => JSON.parse(String(rows(`SELECT body FROM runs WHERE id='${runId}'`)[0]!.body)).state;

      const prefs = join(w.root, "prefs.json");
      await writeFile(prefs, JSON.stringify({ defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } }));
      await ok("agent", "set-preferences", "--file", prefs);

      // requirement open → answer → consensus
      expect((await ok("requirement", "open", "--idea", "Let people export their notes as Markdown.", "--group", "g", "--language", "en")).body).toMatchObject({ result: { kind: "requirement-opened" } });
      await until(() => state("requirement_rounds", "round_no", 1) === "awaiting-answers", 120_000, "round 1", 100);
      const round = (await ok("requirement", "show", "g")).body.rounds[0].result as { questions: Array<{ id: string }>; glossary: Array<{ id: string }>; adrs: Array<{ id: string }> };
      expect(round.questions).toHaveLength(2);
      const answered = await ok("requirement", "answer", "g", ...round.questions.flatMap((q) => ["--answer", q.id]),
        ...round.glossary.flatMap((e) => ["--glossary", `${e.id}=accept`]), ...round.adrs.flatMap((a) => ["--adr", `${a.id}=accept`]));
      expect(answered.body).toMatchObject({ result: { nextRoundNo: null } });
      expect((await ok("requirement", "consensus", "g")).body).toMatchObject({ result: { draftNo: 1 } });
      await until(() => state("requirement_drafts", "draft_no", 1) === "awaiting-review", 120_000, "draft 1", 100);

      // requirement accept: the estimate it queues must echo the plan hash the accept archives (requirementE2E's
      // planHashOfDraft), so its answer is queued before the accept.
      const repoId = (await ok("requirement", "show", "g")).body.requirement.repoId as string;
      const db = new DatabaseSync(join(stateDir, "control.sqlite"), { readOnly: true });
      let stored: { targetRepo: string };
      try { stored = readDraft({ db } as unknown as ControlStore, "g", 1).plan as { targetRepo: string }; } finally { db.close(); }
      const planHash = sha256Canonical(normalizeControlPlan({ ...schedulerControlPlanSourceOf(stored, stored.targetRepo), repoId, planId: "requirement-draft-1" }));
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call-queue": [...queue, { match: "budget-estimate-request-v1", output: estimateFor(planHash) }] }));
      expect((await ok("requirement", "accept", "g")).body).toMatchObject({ result: { kind: "requirement-draft-accepted", estimateState: "queued" } });
      await until(() => rows("SELECT state FROM estimates WHERE group_id='g'").some((row) => row.state === "ready")
        && JSON.parse(String(rows("SELECT body FROM groups WHERE id='g'")[0]!.body)).requirement.export.state === "done", 180_000, "the estimate and the export", 100);

      // group confirm --hold → start → show
      expect((await ok("group", "show", "g")).body.plan.planHash).toBe(planHash);
      // The profile declares a 1,000,000-token window, so confirm must name a handoff threshold within it (a null one is
      // execution-policy-unrepresentable); --hold so the person's retry below is the only one (no escalation ladder).
      await ok("group", "confirm", "g", "--hold", "--handoff-at-context-tokens", "1000000");
      await ok("group", "start", "g");
      const shown = await ok("group", "show", "g");
      expect(shown.body.workItems.map((item: { taskId: string }) => item.taskId)).toEqual(["exporter"]);

      // The scripted failure: the check cannot pass yet.
      await until(() => { const id = work().currentRunId; return id !== null && runState(id) === "blocked"; }, 300_000, "run 1 to fail", 200);
      const first = work().currentRunId!;
      await writeFile(flag, "");

      // Two agents retry run 1. The first agent's retry (exit 0) is applied while the panel's pump -- in this process --
      // is held at its wake delivery, so run 2 is not claimed yet. The second agent then reads (the revision after the
      // first retry; run 1 still the task's current run), and only between its read and its send is the pump let go:
      // the re-run claims run 2 and moves the task (a claim does not move the group's revision). Its send names run 1.
      const gate = new Promise<void>((resolve) => { openGate = resolve; });
      const realDeliver = dispatch.deliverSchedulerWakes;
      let parked = 0;
      vi.spyOn(dispatch, "deliverSchedulerWakes").mockImplementation(async (...args) => { parked += 1; await gate; return realDeliver(...args); });
      // A pass parked at the gate is the pump's only pass in flight (it runs one at a time), so nothing can claim now.
      await until(() => parked > 0, 60_000, "the pump to reach the gate", 20);
      const walkRetry = await ok("task", "retry", "g", "exporter");
      expect(walkRetry.body).toMatchObject({ result: { kind: "task-retried", taskId: "exporter", fromRunId: first } });
      expect(work().currentRunId).toBe(first);
      const realSend = operations.controlSend;
      vi.spyOn(operations, "controlSend").mockImplementation(async (input) => {
        openGate();
        await until(() => work().currentRunId !== first, 120_000, "the re-run to move the task to run 2", 50);
        return realSend(input);
      });
      const stale = await orca("task", "retry", "g", "exporter");
      expect({ code: stale.code, error: stale.out.body?.error?.code }).toEqual({ code: 2, error: "task-run-moved" });
      vi.mocked(operations.controlSend).mockRestore();
      vi.mocked(dispatch.deliverSchedulerWakes).mockRestore();

      // Run 2 passes its check and lands; nothing is left running, so the group can be archived.
      // Each task run's workspace cleaned up too, so no driver step is still in flight when the panel closes.
      const cleaned = () => rows("SELECT body FROM runs WHERE group_id='g' AND work_item_id='exporter'").every((r) => JSON.parse(String(r.body)).drive?.cleanedUp === true);
      await until(() => work().status === "done" && rows("SELECT id FROM runs WHERE group_id='g' AND active=1").length === 0 && cleaned(), 300_000, "run 2 to land", 200)
        .catch((error: Error) => { throw new Error(`${error.message}; work ${JSON.stringify(work())}; runs ${JSON.stringify(rows("SELECT id,work_item_id,active,body FROM runs WHERE group_id='g'").map((r) => [r.id, r.work_item_id, r.active, JSON.parse(String(r.body)).state, JSON.parse(String(r.body)).drive ?? null]))}; scripted ${JSON.stringify(w.scripted())}`); });
      expect(runState(first)).toBe("settled-failed");
      expect((await ok("group", "archive", "g")).body).toMatchObject({ result: { kind: "archived", groupId: "g" } });

      // No step went through the raw socket client; the spy is live (one deliberate raw read is counted).
      expect(sendSpy).not.toHaveBeenCalled();
      await captureStreams(() => main(["control", "get", "summary", "--control-state-dir", stateDir]));
      expect(sendSpy).toHaveBeenCalledTimes(1);
    } finally {
      openGate();
      untrackSocketPanel(panel);
      await panel.close();
    }
  });
});
