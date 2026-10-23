// CLI v2 spec §15.1, §15.6 criteria 6 and 9 (plan Task 10): who may do which human-only action. The socket agent gets
// two tiers (open; token = a person token, Task 11), a run Orca dispatched is refused every §15.1 entry, and Web members
// keep today's refusals (I3). Every row of the spec's table x every principal; the table's code mirror (SOCKET_TIER) must
// cover every HUMAN_ONLY_VERBS and HUMAN_ONLY_FIELDS entry, so a new human-only verb cannot fall through unclassified.
import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { DISPATCHED_RUN_REFUSED, HUMAN_ONLY_FIELDS, HUMAN_ONLY_VERBS, SOCKET_TIER, VERB_ACCESS, humanOnlyRefusal } from "../../src/panel/humanOnly.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { sessionFor } from "./fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

const LOCAL = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const PUSH = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };

/**
 * §15.1, row by row: the entry it exercises (a verb, or `verb.field`), a payload, the socket agent's tier with no token,
 * and (review M5, session b37f7ce9) a Web member's refusal code, written out here rather than read back from
 * humanOnlyRefusal, the code under test: I3 keeps today's member refusals -- a human-only verb by verb, a field by field.
 */
const V = "control-verb-human-only", F = "control-field-human-only";
const ROWS: ReadonlyArray<{ entry: string; payload: Record<string, unknown>; tier: "open" | "token"; member: typeof V | typeof F }> = [
  { entry: "correction-record", payload: {}, tier: "open", member: V },
  { entry: "correction-close", payload: {}, tier: "open", member: V },
  { entry: "correction-withdraw", payload: {}, tier: "open", member: V },
  { entry: "correction-debug-open.undoHow", payload: { correctionId: "c_1", undoHow: "git revert --no-edit HEAD" }, tier: "open", member: F },
  { entry: "approve-pending-decision", payload: {}, tier: "open", member: V },
  { entry: "reject-pending-decision", payload: {}, tier: "open", member: V },
  { entry: "ratify-flagged-decision", payload: {}, tier: "open", member: V },
  { entry: "add-group-dependency", payload: {}, tier: "open", member: V },
  { entry: "remove-group-dependency", payload: {}, tier: "open", member: V },
  { entry: "set-criteria-review", payload: { enabled: false }, tier: "open", member: V },
  { entry: "set-orchestration-settings", payload: {}, tier: "open", member: V },
  { entry: "retry-integration", payload: {}, tier: "open", member: V },
  { entry: "resolve-integration-conflict", payload: {}, tier: "open", member: V },
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): the integration-check setter is removed (checks spec 2026-10-22
  // §4.4); its tiers carry over to set-check-settings per the checks plan's access mapping. Their member code
  // is V: checks spec 2026-10-22 §4.4's table lists each new verb `human-only` (a verb, as set-integration-check was).
  { entry: "set-check-settings", payload: { kind: "integration-check", set: { enabled: true, command: null }, clear: [] }, tier: "open", member: V },
  { entry: "set-check-settings", payload: { kind: "integration-check", set: { enabled: false }, clear: ["command"] }, tier: "open", member: V },
  { entry: "set-check-settings", payload: { kind: "model-review", set: { trigger: { all: [{ any: [{ kind: "queue-idle" }] }] }, maxGroupsPerReview: 4 }, clear: [] }, tier: "open", member: V },
  { entry: "set-check-settings", payload: { kind: "integration-check", set: { enabled: true, command: "npm test" }, clear: [] }, tier: "token", member: V },
  { entry: "set-check-settings", payload: { kind: "model-review", set: { budgetTokens: 1 }, clear: [] }, tier: "token", member: V },
  { entry: "set-check-settings", payload: { kind: "model-review" }, tier: "token", member: V },
  { entry: "set-scheduled-check", payload: { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: true }, tier: "token", member: V },
  { entry: "set-scheduled-check", payload: { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: false }, tier: "open", member: V },
  { entry: "set-scheduled-check", payload: { id: "weekly", remove: true }, tier: "open", member: V },
  { entry: "set-check-locks", payload: { locks: [] }, tier: "token", member: V },
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): flow plan Global Constraints (Access) -- the human-only flow verbs are token.
  { entry: "set-flow-settings", payload: { set: { effects: { cost: "confirm" } }, clear: [] }, tier: "token", member: V },
  { entry: "set-flow-locks", payload: { locks: ["effects.cost"] }, tier: "token", member: V },
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): flow engine spec §14.2 / plan Global Constraints -- the four human-only run
  // verbs are token, and a start's pool (a budget amount) is token as requirement-open.limit.
  { entry: "flow-rerun", payload: { runId: "fr-x", planNo: 1 }, tier: "token", member: V },
  { entry: "flow-answer", payload: { runId: "fr-x", stepKey: "s", text: "t" }, tier: "token", member: V },
  { entry: "flow-effect", payload: { recordId: "eff-x", action: "enact" }, tier: "token", member: V },
  { entry: "flow-pool", payload: { runId: "fr-x", raiseTokens: 1 }, tier: "token", member: V },
  { entry: "flow-start.pool", payload: { template: "wechat-article", params: {}, pool: 1 }, tier: "token", member: F },
  // Gaps spec §13 (G10): answering a plan's question by running the step spends (token); accepting it unchanged does what
  // the timeout would do (open). A payload the predicate cannot read is token.
  { entry: "flow-plan-step", payload: { runId: "fr-x", planNo: 1, stepKey: "s", choice: "run" }, tier: "token", member: V },
  { entry: "flow-plan-step", payload: { runId: "fr-x", planNo: 1, stepKey: "s", choice: "accept-unchanged" }, tier: "open", member: V },
  { entry: "flow-plan-step", payload: {}, tier: "token", member: V },
  { entry: "run-check-now", payload: { kind: "model-review" }, tier: "open", member: V },
  { entry: "resume-check", payload: { kind: "model-review" }, tier: "open", member: V },
  { entry: "confirm.integrationHash", payload: { integrationHash: "d".repeat(64) }, tier: "open", member: F },
  { entry: "set-integration-scheme", payload: { integration: { delivery: "keep" } }, tier: "open", member: V },
  { entry: "set-group-integration", payload: { integration: { delivery: "keep" } }, tier: "open", member: V },
  { entry: "set-integration-scheme", payload: { integration: LOCAL }, tier: "token", member: V },
  { entry: "set-group-integration", payload: { integration: PUSH }, tier: "token", member: V },
  // A payload the predicate cannot read is the stricter tier (the schema refuses it later anyway).
  { entry: "set-group-integration", payload: {}, tier: "token", member: V },
  { entry: "set-limit", payload: { limit: {} }, tier: "token", member: V },
  { entry: "requirement-open.limit", payload: { groupId: "g", limit: {} }, tier: "token", member: F },
  { entry: "proposal-edit.proposedGroupLimit", payload: { proposedGroupLimit: {} }, tier: "token", member: F },
  { entry: "set-spend-cap", payload: {}, tier: "token", member: V },
  { entry: "clear-spend-cap", payload: {}, tier: "token", member: V },
  { entry: "set-usage-calendar", payload: {}, tier: "token", member: V },
  { entry: "settle-unknown-usage", payload: {}, tier: "token", member: V },
  { entry: "apply-agent-update", payload: {}, tier: "token", member: V },
];

/** Gaps spec §6.3, §13: the `any` verbs whose socket tier is a predicate on the payload (written out, not read back). */
const ANY_VERB_PREDICATES = ["flow-message"] as const;
const RUN_ID = "fr-00000000-0000-4000-8000-000000000001";
const defer = (effects?: unknown) => ({ runId: RUN_ID, kind: "command", target: { kind: "step", stepKey: "visuals" }, body: { command: "defer", ...(effects === undefined ? {} : { effects }) } });
/**
 * Gaps spec §6.3, §13 (G10): `flow-message` stays `any` (no HUMAN_ONLY_FIELDS entry); a `defer` whose `effects` holds any
 * `proceed` releases a held external effect, so it is token on the socket and refused to a dispatched run. Everything
 * else is open. Web members and owners are not tiered (an `any` verb: accepted).
 */
const ANY_ROWS: ReadonlyArray<{ name: string; payload: Record<string, unknown>; tier: "open" | "token" }> = [
  { name: "defer, proceed", payload: defer({ "to-draft-box": "proceed" }), tier: "token" },
  { name: "defer, wait and proceed", payload: defer({ "to-draft-box": "wait", publish: "proceed" }), tier: "token" },
  { name: "defer, wait", payload: defer({ "to-draft-box": "wait" }), tier: "open" },
  { name: "defer, no effects", payload: defer(), tier: "open" },
  // What the predicate cannot read is the stricter tier (the kernel refuses the shape anyway).
  { name: "defer, effects not an object", payload: defer("proceed"), tier: "token" },
  { name: "skip", payload: { runId: RUN_ID, kind: "command", target: { kind: "step", stepKey: "visuals" }, body: { command: "skip" } }, tier: "open" },
  { name: "fill", payload: { runId: RUN_ID, kind: "command", target: { kind: "step", stepKey: "visuals" }, body: { command: "fill" } }, tier: "open" },
  { name: "feedback", payload: { runId: RUN_ID, kind: "feedback", target: { kind: "run" }, body: { text: "warmer" } }, tier: "open" },
];

const PERSON = { userId: "u9", name: "ana", roles: ["owner" as const] };
const PRINCIPALS: Record<string, Principal> = {
  socket: { kind: "agent", client: "cli:claude" },
  socketToken: { kind: "agent", client: "cli:claude", person: PERSON },
  socketMarker: { kind: "agent", client: "cli:claude", dispatchedRun: "run-1" },
  socketTokenMarker: { kind: "agent", client: "cli:claude", dispatchedRun: "run-1", person: PERSON },
  webMember: { kind: "user", userId: "u2", name: "m", roles: ["member"] },
  webOwner: { kind: "user", userId: "u1", name: "o", roles: ["owner"] },
};

const allEntries = (): string[] => [
  ...HUMAN_ONLY_VERBS,
  ...Object.entries(HUMAN_ONLY_FIELDS).flatMap(([verb, fields]) => (fields ?? []).map((field) => `${verb}.${field}`)),
].sort();

describe("the socket access tiers (CLI v2 spec §15.1)", () => {
  // Ruling: 这次批准改写所有必要的判据 (0e13a9b7) -- gaps spec §6.3, §13: the table also holds a predicate on an `any`
  // verb (`flow-message`, the first); every other row is still a human-only entry.
  it("has a SOCKET_TIER row for every human-only verb and field, the any-verb predicates, and no other row (the build-time check)", () => {
    // Non-vacuous: today's table has the entries the spec names.
    expect(allEntries()).toEqual(expect.arrayContaining(["set-limit", "correction-withdraw", "confirm.integrationHash", "requirement-open.limit", "flow-plan-step"]));
    expect(Object.keys(SOCKET_TIER).sort()).toEqual([...allEntries(), ...ANY_VERB_PREDICATES].sort());
    for (const verb of ANY_VERB_PREDICATES) {
      expect(VERB_ACCESS[verb], verb).toBe("any");
      expect(typeof SOCKET_TIER[verb], verb).toBe("function");
    }
    // And every row is exercised below.
    expect([...new Set(ROWS.map((row) => row.entry))].sort()).toEqual(allEntries());
  });

  it("answers every row x {socket, socket+token, socket+marker, socket+token+marker, Web member, Web owner} as the table says", () => {
    const answers = ROWS.map(({ entry, payload }) => {
      const verb = entry.split(".")[0] as never;
      return { entry, payload, answer: Object.fromEntries(Object.entries(PRINCIPALS).map(([name, p]) => [name, permissionRefusal(p, verb, payload)?.code ?? "accepted"])) };
    });
    expect(answers).toEqual(ROWS.map(({ entry, payload, tier, member }) => ({
      entry, payload, answer: {
        socket: tier === "open" ? "accepted" : "control-person-token-required",
        socketToken: "accepted",
        socketMarker: "control-dispatched-run-refused",
        socketTokenMarker: "control-dispatched-run-refused",
        // I3: a member's refusal is today's, by today's code (the literal column above; mutation "a field refused by
        // the verb code" in humanOnlyRefusal -> red, where reading the code back from it stayed green).
        webMember: member,
        webOwner: "accepted",
      },
    })));
    // The Web member's code is also humanOnlyRefusal's (the permission table still routes a member through it).
    for (const { entry, payload, member } of ROWS) expect(humanOnlyRefusal(entry.split(".")[0] as never, payload)?.code, entry).toBe(member);
  });

  it("a command carrying an open verb and a token-tier field is the token tier; a verb outside §15.1 is open to all", () => {
    expect(permissionRefusal(PRINCIPALS.socket!, "requirement-open", { groupId: "g" })).toBe(null);
    expect(permissionRefusal(PRINCIPALS.socket!, "proposal-edit", { operations: [], proposedGroupLimit: {} })?.code).toBe("control-person-token-required");
    for (const p of Object.values(PRINCIPALS)) expect(permissionRefusal(p, "start", {})).toBe(null);
  });

  it("answers every flow-message row x every principal by its predicate (gaps spec §6.3, §13, G10)", () => {
    expect(HUMAN_ONLY_FIELDS["flow-message"]).toBeUndefined();
    const answers = ANY_ROWS.map(({ name, payload }) => ({ name, answer: Object.fromEntries(Object.entries(PRINCIPALS).map(([who, p]) => [who, permissionRefusal(p, "flow-message", payload)?.code ?? "accepted"])) }));
    expect(answers).toEqual(ANY_ROWS.map(({ name, tier }) => ({
      name, answer: {
        socket: tier === "open" ? "accepted" : "control-person-token-required",
        socketToken: "accepted",
        socketMarker: tier === "open" ? "accepted" : "control-dispatched-run-refused",
        socketTokenMarker: tier === "open" ? "accepted" : "control-dispatched-run-refused",
        webMember: "accepted",
        webOwner: "accepted",
      },
    })));
  });

  // Review finding I4 (controller's call, flagged for the human): verbs open to all that a run Orca dispatched is still
  // refused (DISPATCHED_RUN_REFUSED), a row per verb x every principal.
  it("refuses flow-start to a dispatched run only, token or not", () => {
    expect([...DISPATCHED_RUN_REFUSED].sort()).toEqual(["flow-start"]);
    expect(Object.fromEntries(Object.entries(PRINCIPALS).map(([name, p]) => [name, permissionRefusal(p, "flow-start", { template: "t", dir: "/x", params: {} })?.code ?? "accepted"]))).toEqual({
      socket: "accepted", socketToken: "accepted", socketMarker: "control-dispatched-run-refused", socketTokenMarker: "control-dispatched-run-refused", webMember: "accepted", webOwner: "accepted",
    });
  });
});

useSocketPanels();

const ids = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });

describe("R3a over the socket (CLI v2 spec §15.6 criterion 9)", () => {
  it("passes a confirm carrying integrationHash with no token to the service; refuses set-group-integration to a non-keep delivery without one", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
    const panel = await boot(w, [], { port: true });
    const socketPath = (panel as StartedPanel).socketPath!;
    const repo = controlRepoKey("proj");
    // The repository's integration is a non-keep scheme, set by the owner on the Web.
    const owner = await sessionFor(panel, w.env);
    const set = await owner.fetch(`/api/control/repositories/${repo}/integration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "int-o", expectedRevision: 0, payload: { integration: LOCAL } }) });
    expect(set.status).toBe(200);
    const payload = { planHash: "a".repeat(64), proposalVersion: 1, budgetMode: "strict", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: "b".repeat(64), worker: "b".repeat(64), handoff: "b".repeat(64), goalReview: "b".repeat(64) }, contextPolicy: { handoffAtContextTokens: null },
      selectionsHash: "c".repeat(64), integrationHash: "d".repeat(64) };
    const confirm = await overSocket(socketPath, "POST", "/api/control/groups/nogroup/confirm", { "x-orca-client": "cli:test" }, { commandId: "cf-a", expectedRevision: 0, payload });
    // Past the gate: the service answers (no such group) and the command is booked.
    expect([confirm.status, JSON.parse(confirm.text).error.code]).toEqual([404, "group-not-found"]);
    expect(ids(w.state)).toContain("cf-a");
    const group = await overSocket(socketPath, "POST", "/api/control/groups/nogroup/integration", { "x-orca-client": "cli:test" }, { commandId: "gi-a", expectedRevision: 0, payload: { integration: LOCAL } });
    expect([group.status, JSON.parse(group.text).error.code]).toEqual([403, "control-person-token-required"]);
    expect(ids(w.state).filter((id) => id.startsWith("gi-"))).toEqual([]);
  });
});

/**
 * Gaps spec §6.3, §13 (G10, and G5's socket mutation): over the real socket, the tier gate refuses before anything is
 * parsed further or booked -- a `proceed` defer and a plan step `run` without a person token, and both from a run Orca
 * dispatched -- while a `wait` defer and `accept-unchanged` (open) pass the gate to the service (this panel runs no flow
 * kernel, so the service answers `flow-unavailable`, booked).
 */
describe("the flow tiers over the socket (gaps spec §13, G10)", () => {
  it("refuses a proceed defer and a plan step run without a token and from a dispatched run; passes wait and accept-unchanged", async () => {
    const w = await workspace();
    const panel = await boot(w);
    const socketPath = (panel as StartedPanel).socketPath!;
    const send = async (id: string, route: string, payload: unknown, headers: Record<string, string> = {}) => {
      const answer = await overSocket(socketPath, "POST", `/api/control/flows/${route}`, { "x-orca-client": "cli:test", ...headers }, { commandId: id, expectedRevision: 0, payload });
      return [answer.status, (JSON.parse(answer.text) as { error?: { code: string } }).error?.code ?? "ok"];
    };
    const MARKER = { "x-orca-dispatched-run": "run-1" };
    const step = (choice: string) => ({ runId: RUN_ID, planNo: 1, stepKey: "visuals", choice });
    expect(await send("t-proceed", "messages", defer({ "to-draft-box": "proceed" }))).toEqual([403, "control-person-token-required"]);
    expect(await send("t-proceed-run", "messages", defer({ "to-draft-box": "proceed" }), MARKER)).toEqual([403, "control-dispatched-run-refused"]);
    expect(await send("t-include", "plan-step", step("run"))).toEqual([403, "control-person-token-required"]);
    expect(await send("t-include-run", "plan-step", step("run"), MARKER)).toEqual([403, "control-dispatched-run-refused"]);
    expect(await send("t-accept-run", "plan-step", step("accept-unchanged"), MARKER)).toEqual([403, "control-dispatched-run-refused"]);
    expect(ids(w.state).filter((id) => id.startsWith("t-"))).toEqual([]);
    // Past the gate: the service answers.
    expect(await send("t-wait", "messages", defer({ "to-draft-box": "wait" }))).toEqual([409, "flow-unavailable"]);
    expect(await send("t-wait-run", "messages", defer({ "to-draft-box": "wait" }), MARKER)).toEqual([409, "flow-unavailable"]);
    expect(await send("t-accept", "plan-step", step("accept-unchanged"))).toEqual([409, "flow-unavailable"]);
    expect(ids(w.state).filter((id) => id.startsWith("t-")).sort()).toEqual(["t-accept", "t-wait", "t-wait-run"]);
  });
});
