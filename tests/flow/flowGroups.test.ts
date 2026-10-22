/**
 * Flow engine spec §5.2, §5.3, §6.2 (plan Task 10, C14 part): a `dir` flow group's target repository is its run's vault
 * and never the person's folder, whatever its plan names; a child's work branch starts at the composition it was opened
 * on. Without these the driver would run the agent in (and land on) the person's own repository, or start the step from
 * the vault's HEAD instead of the outputs it was composed from.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupRepoId } from "../../src/control/executionDriver.js";
import { stackBaseOf } from "../../src/control/groupEdges.js";
import { flowVaultRepoId, vaultPathOfRepoId } from "../../src/flow/groups.js";
import { getFlowRun } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TEMPLATE = { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };
const BASE = "a".repeat(40);

describe("flow groups resolve to the vault (C14 part)", () => {
  it("a dir child resolves to its run's vault id even when its plan names another repository; its branch starts at baseCommit", async () => {
    const w = await flowWorld({ one: TEMPLATE }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/one" });
      const vaultId = getFlowRun(w.store, flowRunId)!.vaultId!;
      const child = `flow-${flowRunId}-write-1`;
      w.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,0,1,0,?)").run(child, JSON.stringify({
        groupId: child, plan: { repoId: "repo-person" }, flow: { role: "child", flowRunId, parentGroupId: groupId, stepKey: "write", seq: 1, baseCommit: BASE },
      }));
      expect(groupRepoId(w.store, child)).toBe(flowVaultRepoId(vaultId));
      expect(groupRepoId(w.store, groupId)).toBe(flowVaultRepoId(vaultId));
      expect(stackBaseOf(w.store, child)).toBe(BASE);
      // Not a flow group: unchanged.
      w.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('plain',0,1,0,?)").run(JSON.stringify({ groupId: "plain", plan: { repoId: "repo-person" } }));
      expect(groupRepoId(w.store, "plain")).toBe("repo-person");
      expect(stackBaseOf(w.store, "plain")).toBe(null);
    } finally { await w.dispose(); }
  });

  it("the vault id resolves under ORCA_VAULT_DIR; nothing else is the vault resolver's", () => {
    const id = "0123456789abcdef".repeat(4);
    expect(vaultPathOfRepoId({ ORCA_VAULT_DIR: "/v" }, flowVaultRepoId(id))).toBe(join("/v", `${id}.git`));
    expect(vaultPathOfRepoId({ ORCA_VAULT_DIR: "/v" }, "repo-person")).toBe(null);
    expect(vaultPathOfRepoId({ ORCA_VAULT_DIR: "/v" }, "flow-vault:../x")).toBe(null);
  });
});
