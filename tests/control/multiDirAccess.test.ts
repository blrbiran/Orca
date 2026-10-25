/**
 * Multi-directory projects spec §12, criterion M14: the two answers to a stopped landing and a multi folder's folder
 * answer are the person's (the human-only table and the socket's token tier), the CLI rows carry them, and a multi id
 * takes no imported plan, no flow, no debug group and no scheduled flow or group -- refused by name.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FlowDeps } from "../../src/flow/kernel.js";
import { applyFlowCommand } from "../../src/flow/flowCommands.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import { debugGroupIdFor } from "../../src/control/debugGroup.js";
import type { ControlStore } from "../../src/control/store.js";
import { systemDebugGroupId } from "../../src/control/systemDebug.js";
import { WebControlService } from "../../src/control/webService.js";
import { WORK_ROWS } from "../../src/commands/domains/work.js";
import { HUMAN_ONLY_VERBS, SOCKET_TIER, VERB_ACCESS, socketTier } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { ccloopWorlds } from "./fixtures/ccloopWorld.js";
import { webFixture } from "./fixtures/web.js";

const { removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-multi-access-", epochPrefix: "epoch-multi-access-" });
afterAll(removeRoots);

/** A frozen two-directory body, as a multi group carries it. */
const MULTI = { project: "multi", landing: null, dirs: [
  { key: "main", repoId: "repo", kind: "repo" }, { key: "alpha", repoId: "alpha", kind: "repo" },
] };

function freezeBody(store: ControlStore, groupId: string, patch: (body: Record<string, any>) => void): void {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  patch(body);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
}

const codeOf = (answer: unknown): string => {
  const error = (answer as { error?: { code?: string } }).error;
  return error?.code ?? "no-error";
};

const OWNER: Principal = { kind: "user", userId: "u1", name: "olga", roles: ["owner"] };
const MEMBER: Principal = { kind: "user", userId: "u2", name: "amy", roles: ["member"] };
const AGENT: Principal = { kind: "agent", client: "cli:attended" };
const AGENT_OF_OWNER: Principal = { kind: "agent", client: "cli:attended", person: { userId: "u1", name: "olga", roles: ["owner"] } };
const AGENT_OF_MEMBER: Principal = { kind: "agent", client: "cli:attended", person: { userId: "u2", name: "amy", roles: ["member"] } };
const DISPATCHED: Principal = { ...AGENT_OF_OWNER, dispatchedRun: "run-1" };

describe("who may answer a multi landing and a multi folder (M14)", () => {
  relocateHome("orca-multi-access-home-");

  const CASES = [
    ["multi-dir-landing", { action: "retry-rest" }],
    ["resolve-folder-change", { action: "take-folder", dir: "alpha" }],
    ["set-group-integration", { integration: { delivery: "local" } }],
  ] as const;

  it("classifies the three verbs as the person's, on the human table", () => {
    for (const [verb] of CASES) expect([verb, VERB_ACCESS[verb], HUMAN_ONLY_VERBS.includes(verb)]).toEqual([verb, "human-only", true]);
  });

  it("answers an owner, and refuses a member, an untokened agent, a member's token and a dispatched run by name", () => {
    for (const [verb, payload] of CASES) {
      const answer = (p: Principal) => permissionRefusal(p, verb, payload)?.code ?? null;
      expect([verb, answer(OWNER)]).toEqual([verb, null]);
      expect([verb, answer(MEMBER)]).toEqual([verb, "control-verb-human-only"]);
      expect([verb, answer(AGENT)]).toEqual([verb, "control-person-token-required"]);
      expect([verb, answer(AGENT_OF_OWNER)]).toEqual([verb, null]);
      expect([verb, answer(AGENT_OF_MEMBER)]).toEqual([verb, "control-verb-human-only"]);
      expect([verb, answer(DISPATCHED)]).toEqual([verb, "control-dispatched-run-refused"]);
    }
  });

  it("puts both landing answers on the token tier, and a folder answer with it", () => {
    expect(SOCKET_TIER["multi-dir-landing"]).toBe("token");
    expect([socketTier("multi-dir-landing", { action: "retry-rest" }), socketTier("multi-dir-landing", { action: "mark-resolved" })]).toEqual(["token", "token"]);
    expect(socketTier("resolve-folder-change", { action: "withhold", dir: "alpha" })).toBe("token");
    // The session's delivery choice keeps its own rule: keep changes nothing about where work goes.
    expect([socketTier("set-group-integration", { integration: { delivery: "local" } }), socketTier("set-group-integration", { integration: { delivery: "keep" } })]).toEqual(["token", "open"]);
  });

  it("carries both answers as CLI rows", () => {
    const landing = WORK_ROWS.find((row) => row.domain === "group" && row.action === "multi-land")!;
    expect([landing.access, landing.mapsTo.kind === "verb" ? landing.mapsTo.verb : null]).toEqual(["token", "multi-dir-landing"]);
    expect(landing.flags.map((flag) => [flag.name, flag.type])).toEqual([["retry-rest", "boolean"], ["mark-resolved", "boolean"]]);
    const folder = WORK_ROWS.find((row) => row.domain === "group" && row.action === "folder-change")!;
    expect([folder.access, folder.mapsTo.kind === "verb" ? folder.mapsTo.verb : null]).toEqual(["token", "resolve-folder-change"]);
    expect(folder.flags.map((flag) => flag.name)).toContain("dir");
  });

  it("refuses an imported plan on a multi id by name, before any plan file is read", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService({ ...h.deps, multiDirRepoId: (repoId: string) => repoId === "multi" });
      const answer = await service.importPlan({
        schema: "orca-raw-command-v1", commandId: "import-multi", actorId: "human", expectedRevision: 0,
        verb: "import-plan", target: { kind: "group", groupId: "g2" },
        payload: { groupId: "g2", repoId: "multi", planId: "plan" },
      });
      expect("error" in answer ? answer.error.code : "no-error").toBe("multi-dir-plan-import-unsupported");
    } finally { await h.dispose(); }
  });

  it("refuses a flow on a multi project before the folder lookup names it unregistered", async () => {
    const h = await webFixture();
    try {
      const answer = await applyFlowCommand({
        store: h.store, flow: () => ({} as FlowDeps), projects: () => [], multiDirRepoId: (repoId: string) => repoId === "multi",
      }, {
        schema: "orca-raw-command-v1", commandId: "flow-multi", actorId: "human", expectedRevision: 0,
        verb: "flow-start", target: { kind: "flows" },
        payload: { template: "builtin/x", dir: "/nonexistent/orca-multi-folder", projectId: "multi", params: {} },
      });
      expect("error" in answer ? answer.error.code : "no-error").toBe("flow-project-multi-dir-unsupported");
    } finally { await h.dispose(); }
  });

  // Spec §5.1: a debug group imports a plan; the refusal is named before the repository lookup, whose list (the panel's
  // configured repositories) holds no multi id and would answer correction-repository-unknown instead.
  it("refuses a debug group on a correction whose project is a multi project, before its repository is read", async () => {
    const h = await webFixture();
    try {
      const correctionsDir = join(h.root, "corrections");
      await mkdir(correctionsDir);
      const correction = await recordNewCorrection(correctionsDir, correctionRowFrom({
        projectKey: "multi", decisionId: "run-1/agent-0", kind: "wrong", because: "the premise was false", by: "olga",
      } as never, () => new Date("2026-10-26T00:00:00.000Z")), { again: false });
      const service = new WebControlService({ ...h.deps, correctionsDir, correctionsBy: "olga",
        listRepositories: () => [{ repoId: "repo", path: join(h.root, "repo") }],
        repoIdOfProjectKey: (key: string) => key, multiDirRepoId: (repoId: string) => repoId === "multi" });
      const groupId = debugGroupIdFor(h.store, correction.id, false);
      const answer = await service.openCorrectionDebugGroup({ schema: "orca-raw-command-v1", commandId: "debug-multi", actorId: "human",
        expectedRevision: 0, verb: "correction-debug-open", target: { kind: "group", groupId }, payload: { correctionId: correction.id } } as never);
      expect(codeOf(answer)).toBe("debug-multi-dir-unsupported");
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id=?").get(groupId)).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("refuses a system debug group on a multi project before the repository is resolved", async () => {
    const h = await webFixture();
    try {
      const source = { kind: "ladder" as const, groupId: "g", taskId: "a", runId: null };
      const service = new WebControlService({ ...h.deps, multiDirRepoId: (repoId: string) => repoId === "multi",
        resolveRepository: () => { throw new Error("repository read"); } });
      const groupId = systemDebugGroupId(source);
      const answer = await service.openSystemDebugGroup({ schema: "orca-raw-command-v1", commandId: "sys-multi", actorId: "orca-auto",
        expectedRevision: 0, verb: "system-debug-open", target: { kind: "group", groupId },
        payload: { source, stackOn: null, repoId: "multi", facts: ["a task failed"], checks: ["true"] } } as never);
      expect(codeOf(answer)).toBe("debug-multi-dir-unsupported");
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id=?").get(groupId)).toBeUndefined();
    } finally { await h.dispose(); }
  });

  // Spec §5.1: "a scheduled flow / group on one"; the source group's own body names it before the plan's repoId (which
  // knownRepository accepts) could reach the folder lookup.
  it("refuses a scheduled flow or group on a multi project, and a scheduled group from a multi group", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService({ ...h.deps,
        knownRepository: (repoId: string) => repoId === "multi",
        multiDirRepoId: (repoId: string) => repoId === "multi" });
      const set = (scheduleId: string, start: unknown) => service.scheduleCommand({ schema: "orca-raw-command-v1", commandId: scheduleId, actorId: "human",
        expectedRevision: 0, verb: "schedule-set", target: { kind: "schedule", scheduleId },
        payload: { projectId: "multi", name: "nightly", cron: "0 3 * * *", enabled: false, start } } as never);
      expect(codeOf(set("sch-flow", { kind: "flow", template: "builtin/review", params: {} }))).toBe("flow-project-multi-dir-unsupported");
      expect(codeOf(set("sch-group", { kind: "group", entryId: "lib-x", sha256: "a".repeat(64), tokenLimit: null, integration: null })))
        .toBe("flow-project-multi-dir-unsupported");
      freezeBody(h.store, "g", (body) => { body.multiDir = MULTI; });
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const fromGroup = service.scheduleCommand({ schema: "orca-raw-command-v1", commandId: "sch-from", actorId: "human",
        expectedRevision: revision, verb: "schedule-from-group", target: { kind: "group", groupId: "g" },
        payload: { scheduleId: "sch-from", name: "weekly", cron: "0 9 * * *", enabled: false } } as never);
      expect(codeOf(fromGroup)).toBe("flow-project-multi-dir-unsupported");
      expect(h.store.db.prepare("SELECT id FROM schedules WHERE id IN ('sch-flow','sch-group','sch-from')").all()).toEqual([]);
    } finally { await h.dispose(); }
  });
});
