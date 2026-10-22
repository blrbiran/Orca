/**
 * Found in the Task 18 acceptance: the `voice` step (check: `python3 '{{skill.tech-writer-voice.dir}}/scripts/fidelity.py'
 * '<base copy>' '<slug>.md'`) edited the article its check names, so protect-acceptance-criteria read the article as a
 * "check-defining file", re-ran the check against the base with the contract as confirmed -- `{{skill.<name>.dir}}`
 * still a literal token, since only the driver's A2 fills it for the run -- saw it fail, flagged "Only the changed checks
 * pass", and opened a paid `criteria-review` system debug group on the run's vault, outside the run's pool and budget cap.
 * A flow step's checks are the template's (code-owned, not files in the folder); the files they name are the step's own
 * inputs and outputs. So a flow run's hidden child is not judged for criteria changes: no base re-run, no flag, no review.
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const EDITS_ITS_CHECKED_FILE = {
  yaml: `format: orca-flow-v1
id: edit
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
steps:
  - id: write
    kind: work
    role: writer
    prompt: prompts/write.md
    acceptance: {checks: [{id: answered, run: "grep -q 42 answer.txt", role: gate}]}
`,
  assets: { "prompts/write.md": "Rewrite answer.txt.\n" },
};

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-child-criteria-", epochPrefix: "epoch-child-criteria-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("a flow child is not judged for criteria changes (T18 acceptance finding)", { timeout: 300_000 }, () => {
  relocateHome("orca-child-criteria-home-");

  it("a step that rewrites the file its check reads lands with no criteria flag and no criteria-review group", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-child-criteria-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    // The folder already holds answer.txt, so the attempt modifies (not adds) the file the check names.
    const f = await flowRunWorld(w, { templates: { edit: EDITS_ITS_CHECKED_FILE }, folder: { "answer.txt": "old\n" } });
    try {
      const { runtime, flowRunId } = await f.start("builtin/edit");
      runtime.startPump(50);
      await until(() => {
        const stuck = listExecutions(runtime.store, flowRunId).find((e) => e.state === "failed" || e.state === "parked");
        if (stuck !== undefined) throw new Error(`${stuck.stepKey}#${stuck.seq} ${stuck.state}: ${JSON.stringify(stuck.body)}`);
        return getFlowRun(runtime.store, flowRunId)!.state === "done";
      }, 180_000, "the run to complete", 100);
      expect(runtime.store.db.prepare("SELECT decision_id FROM flagged_decisions").all()).toEqual([]);
      expect(runtime.store.db.prepare("SELECT id FROM groups WHERE substr(id,1,9)='sysdebug-'").all()).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
