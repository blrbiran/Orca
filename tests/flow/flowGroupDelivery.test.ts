/**
 * Flow engine spec §5.1 [IR-I7] (plan Task 10, C14 part): every flow group on a `dir` workspace has delivery `keep`,
 * fixed by code. The person's folder changes only by copy-back (§5.4); an integration would push or merge the vault's
 * work branch somewhere copy-back does not govern. So `set-group-integration` on such a group is refused
 * `flow-group-delivery-fixed`, and the integration pass skips it even if a record got onto its body.
 */
import { describe, expect, it } from "vitest";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { newGroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { insertFlowRun } from "../../src/flow/store.js";
import { webFixture } from "../control/fixtures/web.js";

const LOCAL: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const errorCode = (result: unknown): string => (result as { error?: { code: string } }).error?.code ?? "applied";
const body = (store: ControlStore): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

function asFlowChild(store: ControlStore, kind: "dir" | "repo"): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('parent',0,1,0,?)").run(JSON.stringify({ groupId: "parent", status: "flow" }));
  insertFlowRun(store, {
    id: "fr-1", groupId: "parent", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind }, vaultId: "f".repeat(64),
    paramsSha256: "p", poolTokens: 1, poolDrawn: 0, state: "running", revision: 0, body: {},
  });
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(store), flow: { role: "child", flowRunId: "fr-1", parentGroupId: "parent", stepKey: "write", seq: 1 } }));
}

describe("dir flow groups never integrate (C14 part)", () => {
  it("set-group-integration on a dir flow group is refused flow-group-delivery-fixed; a repo flow group still takes it", async () => {
    for (const kind of ["dir", "repo"] as const) {
      const h = await webFixture(); try {
        asFlowChild(h.store, kind);
        const service = new WebControlService({ ...h.deps, resolveRepository: () => h.root });
        const answer = await service.setGroupIntegration(h.command("set-group-integration", { integration: LOCAL }));
        if (kind === "dir") {
          expect(errorCode(answer)).toBe("flow-group-delivery-fixed");
          expect(Object.hasOwn(body(h.store), "integration")).toBe(false);
        } else expect(errorCode(answer)).toBe("applied");
      } finally { await h.dispose(); }
    }
  });

  it("the integration pass does not look at a dir flow group, even with a frozen record on its body", async () => {
    const h = await webFixture(); try {
      asFlowChild(h.store, "dir");
      const record = { ...newGroupIntegration(LOCAL)!, frozen: true };
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(h.store), integration: record }));
      const asked: string[] = [];
      const moved = await integratePendingGroups({
        store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), now: () => 0, ghBin: "gh", stopped: () => false,
        repoPathOf: (repoId) => { asked.push(repoId); throw new Error("no repository in this criterion"); },
      });
      expect(moved).toBe(false);
      expect(asked).toEqual([]);
      expect(body(h.store).integration).toEqual(record);
    } finally { await h.dispose(); }
  });
});
