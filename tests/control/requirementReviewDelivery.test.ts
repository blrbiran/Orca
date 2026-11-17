import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../../src/control/requirementReview.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { git } from "./fixtures/driverHarness.js";
import { CRITERIA, reviewWorld, type ReviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Delivery tail spec D2/D4 (tester #336, human ruling 1 of session 2026-11-17: the review does not hold integration, the
 * group is not done until reviewed, so a criterion like "merged into main" has a moment it can be true). A group that
 * delivers is reviewed once the delivery of its tip settled (and the delivered commit's acceptance, when needed), and the
 * reviewer is told what Orca recorded beyond the diff -- the acceptance commands, the delivery, the delivered acceptance.
 */
const LOCAL = { delivery: "local", trigger: "group", method: "merge", target: "main" } as const;
const body = (w: ReviewWorld) => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

async function localWorld(options: { record?: Record<string, unknown> } = {}) {
  const seen: Array<{ lastIntegrated: string | null; prompt: string }> = [];
  const holder: { w?: ReviewWorld } = {};
  const w = await reviewWorld({ harness: { integration: LOCAL },
    answer: (call) => {
      seen.push({ lastIntegrated: body(holder.w!).integration?.lastIntegrated ?? null, prompt: call.prompt });
      return { outcome: "complete", output: { criteria: CRITERIA.map((c) => ({ id: c.id, verdict: "met", evidence: [{ path: "orca:delivery", line: null }], missing: null, fixableBy: "work" })), summary: "ok" } };
    } });
  holder.w = w;
  // The harness checkout keeps untracked files; detached, main is a ref the local delivery may move (integrationPass H5).
  git(w.t.repo, "checkout", "-q", "--detach");
  if (options.record !== undefined) w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(w), integration: { ...body(w).integration, ...options.record } }));
  return { w, seen };
}

describe("the review waits for the delivery and is told about it (delivery tail D2, D4)", () => {
  it("a delivering group is reviewed after the delivery and its delivered acceptance, with both in the prompt", async () => {
    // Integration held (one backoff, below the review's threshold) until the person has moved main.
    const { w, seen } = await localWorld({ record: { retryAfter: Date.UTC(2100, 0, 1), transient: 1, transientReason: "held by the test" } });
    try {
      await w.runAll();
      // The person moves main while the group works: the merge tree differs from the tip's, so D3 runs on it.
      writeFileSync(join(w.t.repo, "person.txt"), "theirs\n");
      git(w.t.repo, "add", "person.txt"); git(w.t.repo, "commit", "-qm", "person");
      git(w.t.repo, "branch", "-f", "main", "HEAD");
      git(w.t.repo, "checkout", "-q", "--detach");
      w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(w), integration: { ...body(w).integration, retryAfter: null, transient: 0, transientReason: null } }));
      await w.t.until(w.driver, () => w.review()?.state === "passed", 150);
      const integration = body(w).integration;
      expect(seen).toHaveLength(1);
      expect(seen[0]!.lastIntegrated).toBe(integration.lastIntegrated);
      const prompt = seen[0]!.prompt;
      expect(prompt).toContain(`delivered as ${integration.integratedCommit} (2 parents) on main`);
      expect(prompt).toContain("Acceptance on the reviewed tip");
      expect(prompt).toContain("`true` -> exit 0");
      // mutation: drop the wait for the delivered acceptance -> the review runs before its record, red
      expect(prompt).toContain(`Acceptance on the delivered commit ${integration.integratedCommit.slice(0, 12)}: passed`);
      expect(prompt).toContain("orca:delivery");
      expect(w.groupStatus()).not.toBe("blocked");
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("a delivery backing off for the third time does not hold the review; the prompt says it is not delivered and why", async () => {
    const { w, seen } = await localWorld({ record: { retryAfter: Date.UTC(2100, 0, 1), transient: 3, transientReason: "the remote is asleep" } });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 150);
      // mutation: drop the transient >= 3 opening -> the review never starts, red (timeout)
      expect(seen[0]!.lastIntegrated).toBeNull();
      expect(seen[0]!.prompt).toContain("not delivered: retrying at");
      expect(seen[0]!.prompt).toContain("the remote is asleep");
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("a failed acceptance on the tip still opens the review at once, without the delivery (#314)", async () => {
    const { w, seen } = await localWorld();
    try {
      // The project's full suite: green at the group's base (no b yet), red on its tip -- a real failure, not a pre-existing one.
      const settings = readRepositorySettingsBody(w.t.h.store, "repo")!;
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1, checks: { ...settings.checks, integrationCheck: { command: "test ! -f b" } } });
      await w.runAll();
      await w.t.until(w.driver, () => w.review() !== null && w.review()!.state !== "pending" && w.review()!.state !== "reviewing", 150);
      expect(body(w).acceptance).toMatchObject({ result: "failed" });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.lastIntegrated).toBeNull();
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("the prompt frames evidence beyond the diff and no longer calls a binary file a reason for cannot-judge (#337)", () => {
    const prompt = buildReviewPrompt({ idea: "i", statement: "s", criteria: CRITERIA, openBranches: [], diff: "", truncated: false, changedFiles: [],
      facts: ["Delivery scheme: local merge into main", "- delivered as abc (2 parents) on main"] });
    expect(prompt).toContain("What Orca recorded beyond the diff:");
    expect(prompt).toContain("- delivered as abc (2 parents) on main");
    expect(prompt).not.toContain("a binary file you cannot see");
    expect(prompt).toContain("\"orca:acceptance\"");
  });
});
