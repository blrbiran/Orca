import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Tester follow-up G Parts 4 and 5 end to end against the real ccloop build (ORCA_CCLOOP_BIN, which must carry ccloop
 * C1-C4) and its scripted fake codex: a dependent task's prompt points at the handoffs its predecessor left, which Orca
 * stored in its own state directory and never in the target repository (§7 anti-goal); and a Live note sent while a phase
 * runs reaches the next phase's prompt, never the running call, and is shown delivered there.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-handoff-notes-e2e-", epochPrefix: "epoch-hn-" });
afterAll(removeRoots);

const READ_LINE = /^Handoff notes from earlier tasks of this work are in (.+): read \1\/README\.md and the files it lists before anything else\./;
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
const settled = (runtime: ControlRuntime, tasks: string[]): boolean => tasks.every((id) => workStatus(runtime, id) === "done")
  && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true)
  && JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).acceptance !== undefined
  && !readdirSync(`${runtime.store.stateDir}.workspaces`).some((name) => name.startsWith("group-acceptance-"));

describe.skipIf(!realBinary)("task handoffs and Live notes against real ccloop (follow-up G Parts 4-5)", { timeout: 420_000 }, () => {
  relocateHome("orca-handoff-notes-e2e-home-");

  // mutation: A2 sends no work.handoff -> b's plan prompt has no read line and a's files are never stored, red
  it("b's prompt names its inputDir, whose README lists a's handoff; a's files are stored under groups/g/handoffs; the group view lists both runs", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"] }, { taskId: "b", dependsOn: ["a"], targetPaths: ["b.txt"] }], {
      a: { files: { "a.txt": "A\n" }, handoff: { "handoff.md": "# Handoff\nThe parser lives in src/p.ts.\n", "summary.md": "a wrote a.txt\n" } },
      b: { files: { "b.txt": "B\n" }, handoff: { "handoff.md": "# Handoff\nb built on a.\n", "summary.md": "b wrote b.txt\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return settled(runtime, ["a", "b"]); }, 360_000, "both tasks to settle");
      const aRun = workRuns(runtime).find((run) => run.task === "a")!.runId, bRun = workRuns(runtime).find((run) => run.task === "b")!.runId;
      const root = realpathSync(join(runtime.store.stateDir, "groups", "g", "handoffs"));
      const bPlan = w.prompts().find((p) => p.phase === "plan" && p.prompt.includes("task b."))!.prompt.split("\n");
      expect(bPlan[2]).toMatch(READ_LINE);
      expect(READ_LINE.exec(bPlan[2]!)![1]).toBe(join(root, "runs", bRun, "in"));
      expect(readFileSync(join(root, "runs", bRun, "in", "README.md"), "utf8")).toContain(`- a (run ${aRun}): handoff-a-${aRun}.md, summary-a-${aRun}.md`);
      expect(readFileSync(join(root, "runs", bRun, "in", `handoff-a-${aRun}.md`), "utf8")).toBe("# Handoff\nThe parser lives in src/p.ts.\n");
      // Only execute is told where to write; verify neither reads nor writes.
      const bExecute = w.prompts().find((p) => p.phase === "execute" && p.prompt.includes("task b."))!.prompt;
      expect(bExecute).toContain(`Handoff output directory: ${join(root, "runs", bRun, "out")}`);
      expect(w.prompts().filter((p) => p.phase === "verify").every((p) => !p.prompt.includes("Handoff"))).toBe(true);
      expect(readFileSync(join(root, `handoff-a-${aRun}.md`), "utf8")).toBe("# Handoff\nThe parser lives in src/p.ts.\n");
      expect(readFileSync(join(root, `summary-b-${bRun}.md`), "utf8")).toBe("b wrote b.txt\n");
      const view = readControlGroup(runtime.store, runtime.epoch, "g");
      expect(view.handoffs?.map((entry) => [entry.taskId, entry.runId, entry.handoff.state, entry.summaryText])).toEqual([
        ["a", aRun, "stored", "a wrote a.txt\n"], ["b", bRun, "stored", "b wrote b.txt\n"],
      ]);
      expect(view.activity?.some((row) => row.kind === "handoff-invalid")).toBe(false);
      // §7 anti-goal: never in the target repository.
      const landed = g(w.repo, "ls-tree", "-r", "--name-only", "refs/heads/orca/g").split("\n");
      expect(landed).toContain("b.txt");
      expect(landed.filter((name) => /(^|\/)(handoff|summary)\.md$/.test(name) || name.includes("live-notes"))).toEqual([]);
    } finally { await w.teardown(); }
  });

  // mutation: ccloop's collect liveNotes not handed on (or noteLiveNoteDeliveries skipped) -> the note stays queued, red
  it("a note sent while a's plan sleeps reaches a's execute prompt and shows delivered at execute", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"] }], {
      a: { files: { "a.txt": "A\n" }, delayMs: { plan: 8_000 }, handoff: { "handoff.md": "H\n", "summary.md": "S\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      // The fake logs a call before it sleeps: plan has started, so the note cannot reach it.
      await until(() => { noBlocked(runtime); return w.scripted().includes("plan a"); }, 120_000, "a's plan to start");
      const sent = runtime.service.addLiveNote(raw(runtime, "note-1", "add-live-note", { text: "the fixture lives in test/data" }, { kind: "task", groupId: "g", taskId: "a" }));
      expect("error" in sent ? sent.error : "queued").toBe("queued");
      await until(() => { noBlocked(runtime); return settled(runtime, ["a"]); }, 360_000, "a to settle");
      const prompts = w.prompts().filter((p) => p.prompt.includes("task a."));
      const note = JSON.stringify("the fixture lives in test/data");
      expect(prompts.find((p) => p.phase === "plan")!.prompt).not.toContain(note);
      const execute = prompts.find((p) => p.phase === "execute")!.prompt.split("\n");
      expect(execute).toContain(note);
      expect(execute.indexOf(note)).toBeLessThan(execute.indexOf("Your final message must be exactly one JSON object: no Markdown code fence, no text before or after it."));
      const view = readControlGroup(runtime.store, runtime.epoch, "g");
      const aRun = workRuns(runtime).find((run) => run.task === "a")!.runId;
      expect(view.liveNotes).toEqual([{ noteId: "note-1", taskId: "a", text: "the fixture lives in test/data", at: expect.any(Number), by: "human", state: "delivered",
        delivered: { runId: aRun, phase: "execute", attempt: 1, at: expect.any(String) } }]);
      expect(view.activity?.filter((row) => row.kind === "live-note-delivered").map((row) => row.body)).toEqual([{ noteId: "note-1", phase: "execute", attempt: 1 }]);
    } finally { await w.teardown(); }
  });
});
