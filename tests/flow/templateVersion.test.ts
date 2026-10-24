/**
 * Scheduled flows and groups spec 2026-10-24 §8 step 2 (I-1), §20 item 9, criterion C6v and plan B8: a start that names
 * `builtin/<id>@<n>` runs only the version the build ships. Any other version is refused `flow-template-version-missing`
 * before anything is written -- no vault import, no group, no run row; a schedule pinned to a version this build does not
 * ship records one failed fire with that code.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import type { ScheduleBody } from "../../src/control/schedules/model.js";
import { schedulesPass } from "../../src/control/schedules/pass.js";
import { readSchedule, type ScheduleFire } from "../../src/control/schedules/store.js";
import { FlowRefusal, startFlowRun } from "../../src/flow/kernel.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = {
  yaml: `format: orca-flow-v1
id: t
version: 3
workspace: {kind: dir}
steps:
  - {id: write, kind: draft, prompt: write.md}
`,
  assets: { "write.md": "Write.\n" },
};
const WECHAT = {
  yaml: `format: orca-flow-v1
id: wechat-article
version: 3
workspace: {kind: dir}
params:
  idea: {type: longtext, required: true}
steps:
  - {id: write, kind: draft, prompt: write.md}
`,
  assets: { "write.md": "Write.\n" },
};
const REPO = "repo";
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
const at = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 9, 24 + day, hour, minute, 0);
const count = (w: Awaited<ReturnType<typeof flowWorld>>, table: "groups" | "flow_runs"): number =>
  Number(w.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

describe("C6v the shipped template version", () => {
  it("starts at the shipped version; a version the build does not ship is refused before anything is written", async () => {
    const w = await flowWorld({ t: TPL }); try {
      expect((await w.start({ templateRef: "builtin/t@3" })).flowRunId).toMatch(/^fr-/);
      const other = join(w.root, "other");
      mkdirSync(other);
      const vaultRoot = w.deps.env.ORCA_VAULT_DIR!;
      const before = { groups: count(w, "groups"), runs: count(w, "flow_runs"), vaults: readdirSync(vaultRoot) };
      const refused = await startFlowRun(w.deps, { templateRef: "builtin/t@4", dir: other, params: {}, by: "ann", via: "cli:test" })
        .then(() => null, (error: unknown) => error);
      expect(refused).toBeInstanceOf(FlowRefusal);
      expect((refused as FlowRefusal).code).toBe("flow-template-version-missing");
      expect((refused as FlowRefusal).message).toContain("4");
      expect((refused as FlowRefusal).message).toContain("3");
      expect({ groups: count(w, "groups"), runs: count(w, "flow_runs"), vaults: readdirSync(vaultRoot) }).toEqual(before);
    } finally { await w.dispose(); }
  });

  it("a schedule pinned to a version the build does not ship records one failed fire with that code", async () => {
    const w = await flowWorld({ "wechat-article": WECHAT }); try {
      w.store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
      const clock = { at: at(0, 10, 30) };
      const created = withCommandContext("create-1", ANA, () => applyScheduleCommand({
        store: w.store, flowProjects: () => [{ repoId: REPO, path: w.folder }], knownRepository: () => true,
        now: () => new Date(clock.at),
      }, {
        schema: "orca-raw-command-v1", commandId: "create-1", actorId: "human", expectedRevision: 0, verb: "schedule-set",
        target: { kind: "schedule", scheduleId: "sch-a" },
        payload: {
          projectId: REPO, name: "daily", cron: "0 9 * * *", enabled: true,
          start: { kind: "flow", template: "wechat-article@4", params: { idea: "a topic" } },
        },
      } as ScheduleCommand)) as { error?: { code: string } };
      expect(created.error).toBeUndefined();
      expect(readSchedule(w.store, "sch-a")!.body.start).toMatchObject({ template: "builtin/wechat-article@4" });
      const startFlow = async (fire: ScheduleFire, schedule: ScheduleBody): Promise<{ flowRunId: string }> => {
        if (schedule.start.kind !== "flow") throw new Error("not a flow schedule");
        return startFlowRun(w.deps, {
          templateRef: schedule.start.template, dir: w.folder, projectId: schedule.projectId, params: schedule.start.params,
          by: "orca-auto", via: `schedule:${schedule.id}`, operatorId: schedule.enabledBy, idempotencyKey: fire.body.commandId!,
          origin: { kind: "schedule", scheduleId: schedule.id, slot: fire.slot },
        });
      };
      const when = at(1, 9);
      const { crashes } = await schedulesPass({ store: w.store, now: () => when, startFlow }, when);
      expect(crashes).toEqual([]);
      const fires = w.store.db.prepare("SELECT outcome,reason FROM schedule_fires WHERE schedule_id='sch-a' ORDER BY seq").all()
        .map((row) => ({ ...row }));
      expect(fires).toEqual([{ outcome: "failed", reason: "flow-template-version-missing" }]);
      expect(readSchedule(w.store, "sch-a")!.body.state.failureStreak).toBe(1);
      expect(count(w, "groups")).toBe(0);
      expect(count(w, "flow_runs")).toBe(0);
    } finally { await w.dispose(); }
  });
});
