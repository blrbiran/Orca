import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentSelection } from "../../src/control/agentSelection.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readControlGroup, readSelectionPreview } from "../../src/panel/controlViews.js";
import { ccloopWorlds, raw, realBinary, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * N1 paid run finding R-A (ledger .superpowers/sdd/2026-10-02-requirement-to-split/progress.md): claude was reinstalled
 * while a run was in flight, the execute spawn hit ENOENT, ccloop booked that phase's usage as unknown, and an unknown
 * usage can never be cleared from a group (version 1 has no command for it) -- one transient binary swap stopped the
 * whole group for good. ccloop's crash-resume round (its spec 2026-10-02-crash-resume-and-orphan-reaping-design.md
 * §3.2) books a claude that provably never started as 0. This pins what Orca needs from that: the run's work usage
 * and the group's ledger stay known. Against a ccloop without that round (99054f2) usageUnknown is true here.
 *
 * The world's claude installation is a wrapper that answers `--version` (ccloop's accept-time drift probe) and deletes
 * itself on its first real call, the plan phase -- so execute, and only execute, finds no binary.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-never-started-", epochPrefix: "epoch-never-started-" });
afterAll(removeRoots);

const CLAUDE: AgentSelection = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };

describe.skipIf(!realBinary)("a claude that never started leaves the group's usage known (R-A)", { timeout: 240_000 }, () => {
  relocateHome("orca-never-started-home-");

  it("books the never-started execute as 0: the run's work usage and the group's ledger stay known", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], {}, { claudeScript: { a: { files: { "shared.txt": "A\n" } } } });
    const claude = w.agentsTable.installations.claude!;
    const wrapper = join(w.root, "claude-wrapper.sh");
    const quoted = (claude.command as string[]).map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
    writeFileSync(wrapper, `#!/bin/sh\n[ "$1" = "--version" ] || rm -f "$0"\nexec ${quoted} "$@"\n`);
    chmodSync(wrapper, 0o700);
    claude.command = [wrapper];
    writeFileSync(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });

    const runtime = await w.boot(); try {
      const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId: w.repoId, planId: "plan" }));
      expect(imported).toMatchObject({ result: { kind: "imported" } });
      const preferences = await runtime.service.setAgentPreferences(raw(runtime, "preferences", "set-agent-preferences", { preferences: { defaultAgent: "claude", perAgent: {} } }, { kind: "operator", operatorId: "human" }));
      expect("error" in preferences ? preferences.error : "set").toBe("set");
      const preview = await readSelectionPreview(runtime.store, runtime.port, "human", "g");
      if (preview.selectionsHash === null) throw new Error(`preview rejected: ${JSON.stringify(preview.slots)}`);
      const hash = runtime.router.list()[0]!.profileHash;
      const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", {
        planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: preview.proposalVersion, budgetMode: "soft",
        profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: null }, selectionsHash: preview.selectionsHash,
      }));
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      const started = await runtime.service.start(raw(runtime, "start", "start", {}));
      expect("error" in started ? started.error : "started").toBe("started");
      runtime.startPump(50);

      // The run stops moving once C has collected ccloop's terminal report and booked its usage.
      const collected = (): boolean => workRuns(runtime).some((run) => run.body.state === "blocked" || run.body.drive?.cleanedUp === true);
      await until(collected, 180_000, "the run to be collected");
      const [run] = workRuns(runtime);

      // The premise, measured: the plan call reached the fake and removed the binary; execute never reached it.
      expect(existsSync(wrapper)).toBe(false);
      expect(w.scriptedOf("claude")).toEqual(["plan a"]);
      // What R-A broke.
      expect(run!.body.unknown).toEqual({ work: false, handoff: false });
      expect(readControlGroup(runtime.store, runtime.epoch, "g").ledger.usageUnknown).toBe(false);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
