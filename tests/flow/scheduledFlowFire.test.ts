/**
 * Scheduled flows and groups spec 2026-10-24 §8 step 2, §10 items 1-3, criterion C6 and plan B9: a scheduled fire is an
 * ordinary flow run whose body carries `origin.kind = "schedule"`, started by `orca-auto` with the schedule's `enabledBy`
 * as its operator. In such a run `resolveLevel` clamps `external` and `irreversible` to at least `confirm` (last: it beats
 * configured delivery and keeps the lock), while `stage-only` is not loosened and `local`/`cost` are untouched. The
 * confirm card is the person's: `flow-effect` is human-only.
 */
import { describe, expect, it } from "vitest";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import type { ControlStore } from "../../src/control/store.js";
import { enactEffect } from "../../src/flow/effects.js";
import { openAsks, startFlowRun, type FlowDeps } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, listEffects } from "../../src/flow/store.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const template = (cls: string) => ({
  yaml: `format: orca-flow-v1
id: t
version: 3
workspace: {kind: dir}
effects:
  push: {class: ${cls}}
steps:
  - {id: act, kind: work, prompt: act.md, effect: push}
`,
  assets: { "act.md": "Act.\n" },
});
const REPO = "repo";
const SLOT = 1_760_000_000_000;
const ORIGIN = { kind: "schedule" as const, scheduleId: "sch-a", slot: SLOT };
const scheduled = (deps: FlowDeps, dir: string) => startFlowRun(deps, {
  templateRef: "builtin/t@3", dir, projectId: REPO, params: {}, by: "orca-auto", via: "schedule:sch-a",
  operatorId: "ana", idempotencyKey: "fire-cmd-1", origin: ORIGIN,
});
const projectEffects = (store: ControlStore, effects: Record<string, string>) =>
  store.transaction(() => writeRepositorySettingsBody(store, REPO, { workspaceMode: "worktree", revision: 1, flows: { effects } }));

describe("C6 a scheduled flow fire", () => {
  it("stores by/via/origin/params/templateRef and the operator; the external step parks; the person's confirm runs it", async () => {
    const children = fakeChildPort();
    const asked: Array<{ by: string; operatorId: string }> = [];
    const w = await flowWorld({ t: template("external") }, {
      children: children.port,
      confirmParent: async (input) => { asked.push({ by: input.by, operatorId: input.operatorId }); return { call: null, children: null }; },
    }); try {
      projectEffects(w.store, { external: "apply-flag" });
      const { flowRunId } = await scheduled(w.deps, w.folder);
      await w.advance();
      expect(getFlowRun(w.store, flowRunId)!.body).toMatchObject({
        templateRef: "builtin/t@3", params: {}, by: "orca-auto", via: "schedule:sch-a", origin: ORIGIN,
      });
      expect(asked).toEqual([{ by: "orca-auto", operatorId: "ana" }]);
      const [record] = listEffects(w.store, flowRunId);
      expect(record).toMatchObject({ state: "staged", level: "confirm", class: "external", policy: { value: "confirm", source: "schedule", lockedBy: null } });
      expect(openAsks(w.store, flowRunId)).toEqual([{ stepKey: "act", seq: 1, ask: expect.objectContaining({ kind: "effect-confirm", recordId: record!.id }) }]);
      expect(children.counts().dispatches).toBe(0);
      const command = { action: "confirm", recordId: record!.id };
      expect(permissionRefusal({ kind: "agent", client: "orca-auto" }, "flow-effect", command)?.code).toBe("control-person-token-required");
      expect(permissionRefusal({ kind: "user", userId: "m1", name: "mel", roles: ["member"] }, "flow-effect", command)?.code).toBe("control-verb-human-only");
      expect(permissionRefusal({ kind: "user", userId: "o1", name: "ann", roles: ["owner"] }, "flow-effect", command)).toBe(null);
      expect(await enactEffect(w.deps, record!.id, "ann", "web", "confirm")).toEqual({ state: "running", recordId: record!.id });
      expect(children.counts().dispatches).toBe(1);
    } finally { await w.dispose(); }
  });

  it("the same template started by hand (no origin) runs the external step apply-flag", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: template("external") }, { children: children.port }); try {
      projectEffects(w.store, { external: "apply-flag" });
      const { flowRunId } = await w.start({ templateRef: "builtin/t@3", projectId: REPO });
      await w.advance();
      expect(getFlowRun(w.store, flowRunId)!.body).not.toHaveProperty("origin");
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "confirmed", level: "apply-flag", policy: { value: "apply-flag", source: "project", lockedBy: null } });
      expect(children.counts().dispatches).toBe(1);
    } finally { await w.dispose(); }
  });

  it("an irreversible step is held at confirm; a stage-only setting stays stage-only (not loosened)", async () => {
    const children = fakeChildPort();
    const irreversible = await flowWorld({ t: template("irreversible") }, { children: children.port }); try {
      const { flowRunId } = await scheduled(irreversible.deps, irreversible.folder);
      await irreversible.advance();
      expect(listEffects(irreversible.store, flowRunId)[0]).toMatchObject({
        state: "staged", level: "confirm", class: "irreversible", policy: { value: "confirm", source: "builtin", lockedBy: null },
      });
      expect(irreversible.latest(flowRunId, "act")!.state).toBe("needs-person");
      expect(children.counts().dispatches).toBe(0);
    } finally { await irreversible.dispose(); }
    const staged = await flowWorld({ t: template("external") }, { children: children.port }); try {
      projectEffects(staged.store, { external: "stage-only" });
      const { flowRunId } = await scheduled(staged.deps, staged.folder);
      await staged.advance();
      expect(listEffects(staged.store, flowRunId)[0]).toMatchObject({
        state: "staged", level: "stage-only", policy: { value: "stage-only", source: "project", lockedBy: null },
      });
      expect(staged.latest(flowRunId, "act")!.state).toBe("staged");
      expect(children.counts().dispatches).toBe(0);
    } finally { await staged.dispose(); }
  });

  it("a cost step is not clamped: it runs apply-flag and is flagged red", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: template("cost") }, { children: children.port }); try {
      const { flowRunId } = await scheduled(w.deps, w.folder);
      await w.advance();
      const [record] = listEffects(w.store, flowRunId);
      expect(record).toMatchObject({ state: "confirmed", level: "apply-flag", class: "cost", policy: { value: "apply-flag", source: "builtin", lockedBy: null } });
      children.land(childGroupIdOf(flowRunId, "act", 1), { "out.txt": "done\n" }, { flow: { effect: { remoteId: "image-1" } } });
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "applied", remoteRef: "image-1" });
      expect((w.latest(flowRunId, "act")!.body as { flags?: string[] }).flags).toContain("effect-applied");
    } finally { await w.dispose(); }
  });
});
