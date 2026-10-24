// Scheduled flows and groups spec 2026-10-24 §11.1, criterion C9 (plan Task 3: the library rows; P2 adds the schedule
// rows): every library verb's VERB_ACCESS and SOCKET_TIER entry, and each principal's answer. A Web member is refused each
// human-only verb, the socket agent without a person token the `token` rows, and a run Orca dispatched every row --
// by the existing rule, because each row is a human-only entry (permissions.ts), not by a list of its own.
import { describe, expect, it } from "vitest";
import { HUMAN_ONLY_FIELDS, SOCKET_TIER, VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { controlCommandRoutes } from "../../src/panel/controlApi.js";

const PERSON = { userId: "u9", name: "ana", roles: ["owner" as const] };
const PRINCIPALS: Record<string, Principal> = {
  socket: { kind: "agent", client: "cli:claude" },
  socketToken: { kind: "agent", client: "cli:claude", person: PERSON },
  dispatched: { kind: "agent", client: "cli:claude", dispatchedRun: "run-1" },
  dispatchedToken: { kind: "agent", client: "cli:claude", dispatchedRun: "run-1", person: PERSON },
  webMember: { kind: "user", userId: "u2", name: "m", roles: ["member"] },
  webOwner: { kind: "user", userId: "u1", name: "o", roles: ["owner"] },
};
const NEW = { source: { kind: "group", groupId: "g" }, name: "weekly" };
const LIB = { entryId: "pl-0123456789abcdef", sha256: "a".repeat(64) };
const LOCAL = { delivery: "local", trigger: "group", method: "merge", target: "main" };

/** §11.1's library rows: the verb, a payload, the socket agent's tier with no token, and a Web member's answer. */
const ROWS: ReadonlyArray<{ name: string; verb: "plan-library-save" | "plan-library-import" | "plan-library-archive" | "import-plan"; payload: Record<string, unknown>; socket: string; member: string; dispatched: string }> = [
  { name: "save, a new entry", verb: "plan-library-save", payload: NEW, socket: "accepted", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "save, a version appended", verb: "plan-library-save", payload: { ...NEW, entryId: LIB.entryId }, socket: "control-person-token-required", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "import a file", verb: "plan-library-import", payload: { projectId: "repo", name: "p", doc: {}, provenance: {} }, socket: "control-person-token-required", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "archive", verb: "plan-library-archive", payload: { entryId: LIB.entryId }, socket: "accepted", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "import-plan from an entry", verb: "import-plan", payload: { groupId: "g", repoId: "repo", libraryEntry: LIB }, socket: "accepted", member: "accepted", dispatched: "accepted" },
  { name: "import-plan with tokenLimit", verb: "import-plan", payload: { groupId: "g", repoId: "repo", libraryEntry: LIB, tokenLimit: 500_000 }, socket: "control-person-token-required", member: "control-field-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "import-plan with integration", verb: "import-plan", payload: { groupId: "g", repoId: "repo", libraryEntry: LIB, integration: LOCAL }, socket: "control-person-token-required", member: "control-field-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "import-plan with integration null (keep)", verb: "import-plan", payload: { groupId: "g", repoId: "repo", libraryEntry: LIB, integration: null }, socket: "control-person-token-required", member: "control-field-human-only", dispatched: "control-dispatched-run-refused" },
];

describe("plan library access (§11.1, C9 library rows)", () => {
  it("classifies each library verb human-only, its socket tiers as the table says, and the two import-plan fields human-only", () => {
    expect([VERB_ACCESS["plan-library-save"], VERB_ACCESS["plan-library-import"], VERB_ACCESS["plan-library-archive"], VERB_ACCESS["import-plan"]])
      .toEqual(["human-only", "human-only", "human-only", "any"]);
    expect(HUMAN_ONLY_FIELDS["import-plan"]).toEqual(["tokenLimit", "integration"]);
    expect([SOCKET_TIER["plan-library-import"], SOCKET_TIER["plan-library-archive"], SOCKET_TIER["import-plan.tokenLimit"], SOCKET_TIER["import-plan.integration"]])
      .toEqual(["token", "open", "token", "token"]);
  });

  it.each(ROWS)("$name: answers each principal as the table says", ({ verb, payload, socket, member, dispatched }) => {
    const answer = (p: Principal) => permissionRefusal(p, verb, payload)?.code ?? "accepted";
    expect(Object.fromEntries(Object.entries(PRINCIPALS).map(([name, p]) => [name, answer(p)]))).toEqual({
      socket, socketToken: "accepted", dispatched, dispatchedToken: dispatched, webMember: member, webOwner: "accepted",
    });
  });

  it("routes each library verb to the @plan-library scope", () => {
    const routes = controlCommandRoutes("operator").filter((r) => r.verb.startsWith("plan-library-"));
    expect(routes.map((r) => [r.path, r.verb, r.target({}, {}, undefined as never, "c")])).toEqual([
      ["/api/control/plan-library/save", "plan-library-save", { groupId: "@plan-library", target: { kind: "plan-library" } }],
      ["/api/control/plan-library/import", "plan-library-import", { groupId: "@plan-library", target: { kind: "plan-library" } }],
      ["/api/control/plan-library/archive", "plan-library-archive", { groupId: "@plan-library", target: { kind: "plan-library" } }],
    ]);
  });
});

/** §11.1's schedule rows (plan Task 5): a verb, a payload, the socket agent's tier with no token, and a Web member's answer. */
const SCHEDULE_ROWS: ReadonlyArray<{ name: string; verb: "schedule-set" | "schedule-enable" | "schedule-remove" | "schedule-resume" | "schedule-from-group"; payload: Record<string, unknown>; socket: string; member: string; dispatched: string }> = [
  { name: "set", verb: "schedule-set", payload: { projectId: "repo", name: "weekly", cron: "0 9 * * 1", enabled: false, start: { kind: "flow", template: "wechat-article", params: { idea: "t" } } }, socket: "control-person-token-required", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "enable, true", verb: "schedule-enable", payload: { enabled: true }, socket: "control-person-token-required", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "enable, false", verb: "schedule-enable", payload: { enabled: false }, socket: "accepted", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "remove", verb: "schedule-remove", payload: {}, socket: "accepted", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "resume", verb: "schedule-resume", payload: {}, socket: "accepted", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
  { name: "from a group", verb: "schedule-from-group", payload: { scheduleId: "sch-a", name: "weekly", cron: "0 9 * * 1", enabled: false }, socket: "control-person-token-required", member: "control-verb-human-only", dispatched: "control-dispatched-run-refused" },
];

describe("schedule access (§11.1, C9 schedule rows)", () => {
  it("classifies all five schedule verbs human-only, with the table's socket tiers", () => {
    expect(SCHEDULE_ROWS.map(({ verb }) => VERB_ACCESS[verb])).toEqual(Array(6).fill("human-only"));
    const tier = (verb: string, payload: Record<string, unknown>): unknown => {
      const rule = SOCKET_TIER[verb];
      return typeof rule === "function" ? rule(payload) : rule;
    };
    expect([tier("schedule-set", {}), tier("schedule-enable", { enabled: true }), tier("schedule-enable", { enabled: false }),
      tier("schedule-remove", {}), tier("schedule-resume", {}), tier("schedule-from-group", {})])
      .toEqual(["token", "token", "open", "open", "open", "token"]);
  });

  it.each(SCHEDULE_ROWS)("$name: answers each principal as the table says", ({ verb, payload, socket, member, dispatched }) => {
    // §11.1: a dispatched run is refused every row by the existing rule, because the row is a human-only entry.
    expect(VERB_ACCESS[verb], verb).toBe("human-only");
    const answer = (p: Principal) => permissionRefusal(p, verb, payload)?.code ?? "accepted";
    expect(Object.fromEntries(Object.entries(PRINCIPALS).map(([name, p]) => [name, answer(p)]))).toEqual({
      socket, socketToken: "accepted", dispatched, dispatchedToken: dispatched, webMember: member, webOwner: "accepted",
    });
  });

  it("routes the four own-scope verbs to @schedule:<id> and schedule-from-group to its group", () => {
    const routes = controlCommandRoutes("operator").filter((r) => r.verb.startsWith("schedule-"));
    const params = { scheduleId: "sch-a", groupId: "g-1" };
    expect(routes.map((r) => [r.path, r.verb, r.target(params as never, {}, undefined as never, "c")])).toEqual([
      ["/api/control/schedules/:scheduleId", "schedule-set", { groupId: "@schedule:sch-a", target: { kind: "schedule", scheduleId: "sch-a" } }],
      ["/api/control/schedules/:scheduleId/enable", "schedule-enable", { groupId: "@schedule:sch-a", target: { kind: "schedule", scheduleId: "sch-a" } }],
      ["/api/control/schedules/:scheduleId/remove", "schedule-remove", { groupId: "@schedule:sch-a", target: { kind: "schedule", scheduleId: "sch-a" } }],
      ["/api/control/schedules/:scheduleId/resume", "schedule-resume", { groupId: "@schedule:sch-a", target: { kind: "schedule", scheduleId: "sch-a" } }],
      ["/api/control/groups/:groupId/schedule", "schedule-from-group", { groupId: "g-1", target: { kind: "group", groupId: "g-1" } }],
    ]);
  });
});
