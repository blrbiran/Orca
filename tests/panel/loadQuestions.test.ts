import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisionRow, loadQuestions, loadQuestionsOrEmpty } from "../../src/panel/decisionSource.js";

/**
 * Panel UI redesign spec §4 (human ruling U1, session a50f4d80): list rows carry the
 * decision's question. The ledger is written as raw lines on purpose -- the ledger
 * writer validates, and a real ledger can still hold a line it would refuse.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(join(root, ".decisions", "a.jsonl"), 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function repoWith(files: Record<string, unknown[]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orca-questions-"));
  roots.push(root);
  await mkdir(join(root, ".decisions"));
  for (const [name, rows] of Object.entries(files)) {
    await writeFile(join(root, ".decisions", name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return root;
}

describe("loadQuestions (panel UI redesign spec §4)", () => {
  it("maps each decision id to its question and leaves out a question that is missing, empty or not a string", async () => {
    const repo = await repoWith({
      "a.jsonl": [
        { ev: "decision", id: "r/1", question: "which lock" },
        { ev: "decision", id: "r/2", question: 42 },
        { ev: "decision", id: "r/3", question: "" },
        { ev: "decision", id: "r/4" },
        { ev: "bound", id: "r/5", question: "not a decision line" },
      ],
    });
    const questions = await loadQuestions(repo);
    expect([...questions.entries()]).toStrictEqual([["r/1", "which lock"]]);
  });

  it("lets the first line win for a repeated id, the same line loadDecisionRow opens", async () => {
    const repo = await repoWith({
      "a.jsonl": [{ ev: "decision", id: "r/1", question: "first" }],
      "b.jsonl": [{ ev: "decision", id: "r/1", question: "second" }],
    });
    const questions = await loadQuestions(repo);
    const detail = (await loadDecisionRow(repo, "r/1")) as { question: string };
    expect(questions.get("r/1")).toBe("first");
    expect(questions.get("r/1")).toBe(detail.question);
  });

  it("does not borrow a later line's question when the first line for the id has none", async () => {
    const repo = await repoWith({
      "a.jsonl": [{ ev: "decision", id: "r/1", question: 7 }],
      "b.jsonl": [{ ev: "decision", id: "r/1", question: "later" }],
    });
    expect((await loadQuestions(repo)).has("r/1")).toBe(false);
  });

  it("answers an empty map, not a failure, when a ledger file cannot be read", async () => {
    const repo = await repoWith({ "a.jsonl": [{ ev: "decision", id: "r/1", question: "which lock" }] });
    await chmod(join(repo, ".decisions", "a.jsonl"), 0o000);
    await expect(loadQuestions(repo)).rejects.toBeDefined();
    const questions = await loadQuestionsOrEmpty(repo);
    expect(questions.size).toBe(0);
  });
});
