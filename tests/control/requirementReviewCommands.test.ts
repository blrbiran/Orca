import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { reviewWorld, verdicts, type ReviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester follow-up G spec §3.5: a requirement review that did not pass waits for a person or an orchestrating agent --
 * accept the group as it is (it is then done), run the review again with a note for the reviewer, or open a fix task by
 * hand (which does not use up an automatic round). Each is refused by name unless the review did not pass.
 */
const asAgent = <T>(commandId: string, fn: () => T): T => withCommandContext(commandId, { client: "cli", principal: "agent:cli" }, fn);
const refusal = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;

async function notPassed(answers: Array<Record<string, unknown>> = [verdicts({ AC1: "met", AC2: "cannot-judge" })], files?: (id: string) => Record<string, string | null>): Promise<ReviewWorld> {
  const queue = [...answers];
  const w = await reviewWorld({ ...(files === undefined ? {} : { harness: { files } }), answer: () => ({ outcome: "complete", output: queue.shift() ?? verdicts({ AC1: "met", AC2: "met" }) }) });
  await w.runAll();
  await w.t.until(w.driver, () => w.review()?.state === "not-passed", 120);
  return w;
}

describe("the requirement review's exits (tester follow-up G §3.5)", () => {
  it("accept as is makes a not-passed group done, by an agent too", async () => {
    const w = await notPassed();
    try {
      const command = w.t.h.command("review-accept", { note: "AC2 is checked by hand" });
      expect(asAgent(command.commandId, () => w.t.service.reviewAccept(command))).toMatchObject({ result: { kind: "review-accepted" } });
      // mutation M10a: accept without setting the state -> never done, red
      expect(w.review()).toMatchObject({ state: "accepted", accepted: { by: "agent:cli", note: "AC2 is checked by hand" } });
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("rerun carries the note into the next review prompt", async () => {
    const w = await notPassed();
    try {
      const command = w.t.h.command("review-rerun", { note: "look at b.txt line 1 again" });
      expect(w.t.service.reviewRerun(command)).toMatchObject({ result: { kind: "review-rerun-requested" } });
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.prompt).toContain("look at b.txt line 1 again");
      expect(w.review()!.rounds[1]).toMatchObject({ result: "passed", note: "look at b.txt line 1 again" });
      expect(w.review()!.rerun).toBeUndefined();
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("review-fix by hand opens a task that does not use up an automatic round", async () => {
    const w = await notPassed([verdicts({ AC1: "met", AC2: "cannot-judge" })], (id) => (id.startsWith("review-fix-") ? { "notes.md": `${id}\n` } : { [id]: `${id}\n` }));
    try {
      const command = w.t.h.command("review-fix", { goal: "write notes.md", paths: ["notes.md"] });
      expect(w.t.service.reviewFix(command)).toMatchObject({ result: { kind: "review-fix-opened", taskId: "review-fix-1" } });
      // mutation M10b: count a hand fix in autoFixRounds -> 1, red
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 0 });
      expect(w.review()!.rounds.at(-1)).toMatchObject({ fixTaskId: "review-fix-1", fixBy: "human" });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("each is refused unless the review is not-passed", async () => {
    const w = await reviewWorld();
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(refusal(w.t.service.reviewAccept(w.t.h.command("review-accept", { note: "n" })))).toMatchObject({ code: "requirement-review-not-open", message: "requirement-review-not-open:passed" });
      expect(refusal(w.t.service.reviewRerun(w.t.h.command("review-rerun", { note: "n" })))).toMatchObject({ code: "requirement-review-not-open" });
      expect(refusal(w.t.service.reviewFix(w.t.h.command("review-fix", { goal: "g" })))).toMatchObject({ code: "requirement-review-not-open" });
      expect(w.review()!.state).toBe("passed");
    } finally { await w.t.h.dispose(); }
  }, 240000);
});
