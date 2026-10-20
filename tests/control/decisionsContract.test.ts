import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { savedReport } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { reportedDebugOf, reportedDecisionsOf } from "../../src/control/reportedDecisions.js";
import { ccloopWorlds, g, noBlocked, realBinary, startGroup, until, versionOf, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Control run decisions plan Task 12 (and its "Cross-plan resolutions" item 6: `debug` travels with `decisions`): the
 * contract between what the real ccloop build (ORCA_CCLOOP_BIN) answers and what Orca's control path does with it.
 * ccloop spec 2026-10-20 "reported decisions and debug" §4: the execute answer may carry top-level `decisions` and
 * `debug`, and `control collect` hands them back beside the candidate. Orca's side (that spec §6, this repo's
 * ccloopPort.collect) must keep both on the saved ExecutionReport, and the landing must write the decisions into the
 * landed commit's `.decisions/<runId>.jsonl` under Orca's ids with each entry's `importance` kept.
 *
 * Why it matters: every unit criterion on either side runs against a hand-written answer; only this file proves the
 * two halves agree on the field path. If ccloop stops carrying them, or Orca's parser or mapper drops them, an agent's
 * decisions silently never reach the ledger and the panel shows nothing to review -- no other test turns red.
 *
 * The agent is the build's fake codex in its `reported` mode, which answers as `integration` (writes answer.txt) and
 * adds the fields of `<marker>.reported.json` to its execute answer. The values below are this file's literals, so a
 * pass cannot come from the fake's own defaults.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-dc-", epochPrefix: "epoch-dc-" });
afterAll(removeRoots);

const MAJOR = {
  question: "Cache the parsed contract per task or per group?", chose: "per task",
  alternatives: [{ option: "per group", why_not: "a stale entry would outlive its task" }], because: "tasks are the unit that retries",
  undo: { how: "move the cache back to src/contractCache.ts groupCache", cost: "small", blast_radius: "src/contractCache.ts" },
  scope: "repo", kind: "interface", importance: "major",
};
const MINOR = {
  question: "Name the cache helper?", chose: "taskContractCache",
  alternatives: [{ option: "cache", why_not: "says nothing" }], because: "names its key",
  undo: { how: "rename taskContractCache back in src/contractCache.ts", cost: "trivial", blast_radius: "src/contractCache.ts" },
  scope: "file", kind: "implementation", importance: "minor",
};
// Codex's strict wire schema makes every debug member present, null when unreported; ccloop drops the nulls (its spec
// §4.1) -- Orca's debug schema refuses a null member, so the drop is part of the contract this file pins.
const DEBUG_SENT = { choseInstead: "fix the contract parser", reproTests: ["tests/contract.test.ts"], reproCommand: "npx vitest run tests/contract.test.ts", reproduction: null, reproductionReason: null };
const DEBUG_EXPECTED = { choseInstead: "fix the contract parser", reproTests: ["tests/contract.test.ts"], reproCommand: "npx vitest run tests/contract.test.ts" };

describe.skipIf(!realBinary)("ccloop's reported decisions and debug reach Orca's report and ledger (control run decisions Task 12)", { timeout: 300_000 }, () => {
  relocateHome("orca-dc-home-");

  it("a run whose agent reports one major and one minor decision and a debug object lands them", async () => {
    // fake codex in `reported` mode always reports a change to answer.txt, so the task targets it (ccloop handoff note).
    const w = await world([{ taskId: "a", targetPaths: ["answer.txt"] }], {});
    const marker = join(w.root, "reported-marker");
    await writeFile(`${marker}.reported.json`, JSON.stringify({ decisions: [MAJOR, MINOR], debug: DEBUG_SENT }));
    const fakeCodex = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs");
    const command = [process.execPath, fakeCodex, "reported", marker];
    w.agentsTable.installations.codex = { ...w.agentsTable.installations.codex, command, version: versionOf(command) };
    await writeFile(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });

    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); const run = workRuns(runtime)[0]; return run?.body.state === "settled" && run.body.drive?.cleanedUp === true; }, 240_000, "the run to settle");
      const run = workRuns(runtime)[0]!;
      const runId = run.runId;
      // (1) The report Orca saved from `control collect` (the same read the landing and the panel make) carries the
      // agent's decisions at the one place reportedDecisions.ts looks. Old ccloop / a dropped pass-through: `absent`.
      const report = await savedReport(runtime.store, runId);
      expect(reportedDecisionsOf(report)).toEqual({ kind: "array", entries: [MAJOR, MINOR] });

      // (3) `debug` reaches ExecutionReport.debug, nulls dropped, and is a value Orca's debug schema accepts.
      expect(report.debug).toEqual(DEBUG_EXPECTED);
      expect(reportedDebugOf(report)).toEqual({ kind: "object", value: DEBUG_EXPECTED });

      // The agent really ran in `reported` mode: execute wrote the fake's answer, and it landed. Checked after (1) and (3)
      // on purpose: against a ccloop build whose fake has no `reported` mode the run still settles, without answer.txt, and
      // the first red must be the contract itself (measured: such a build reds here first if this comes first).
      expect(g(w.repo, "show", "refs/heads/orca/g:answer.txt")).toBe("42");

      // (2) The landed commit holds them in `.decisions/<runId>.jsonl`, under Orca's ids, with their grade kept;
      // neither was refused into the pending list.
      const landed = String(run.body.drive.landedCommit);
      expect(g(w.repo, "merge-base", "--is-ancestor", landed, "refs/heads/orca/g")).toBe("");
      const lines = g(w.repo, "show", `${landed}:.decisions/${runId}.jsonl`).split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.map((line) => [line.ev, line.id, line.run, line.question, line.kind, line.scope, line.importance])).toEqual([
        ["decision", `${runId}/agent-0`, runId, "Cache the parsed contract per task or per group?", "interface", "repo", "major"],
        ["decision", `${runId}/agent-1`, runId, "Name the cache helper?", "implementation", "file", "minor"],
      ]);
      expect(listPendingDecisions(runtime.store, "g")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
