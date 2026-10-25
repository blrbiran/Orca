import express from "express";
import { describe, expect, it } from "vitest";
import { commandVerbSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlCommandRoutes, registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { controlErrorCatalog } from "../../src/panel/controlErrors.js";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { may, mayDoHumanOnly, PERMISSIONS, permissionRefusal, principalLabel, hasPauseAuthority, hasPersonAuthority, type Principal } from "../../src/panel/permissions.js";
import { routedPauseAuthorityFor, withCommandContext } from "../../src/control/commandClient.js";
import { webFixture } from "../control/fixtures/web.js";

const owner = { kind: "user" as const, userId: "u1", name: "o", roles: ["owner" as const] };
const member = { kind: "user" as const, userId: "u2", name: "m", roles: ["member" as const] };
const agent = { kind: "agent" as const, client: "cli:claude" };

describe("the permission table (spec §3.5)", () => {
  // CLI v2 spec §15.1 (plan Task 10; Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)): the socket
  // agent is tiered (tests/panel/accessMatrix.test.ts has every row); a member keeps today's codes (I3).
  it("lets an owner do human-only actions, refuses a member by the human-only codes and the agent by its tier", () => {
    expect(permissionRefusal(owner, "set-limit", { limit: {} })).toBe(null);
    expect(permissionRefusal(member, "set-limit", { limit: {} })?.code).toBe("control-verb-human-only");
    expect(permissionRefusal(member, "requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-field-human-only");
    expect(permissionRefusal(agent, "set-limit", { limit: {} })?.code).toBe("control-person-token-required");
    expect(permissionRefusal(agent, "requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-person-token-required");
    for (const p of [member, agent]) expect(permissionRefusal(p, "confirm", {})).toBe(null);
    // Issue-fixes spec §6.3: archiving and unarchiving are open to every principal (access `any`).
    for (const p of [owner, member, agent]) for (const verb of ["archive-group", "unarchive-group"] as const) expect(permissionRefusal(p, verb, {})).toBe(null);
    expect([owner, member, agent].map(mayDoHumanOnly)).toEqual([true, false, false]);
    expect([owner, agent].map(principalLabel)).toEqual(["user:u1", "agent:cli:claude"]);
    // A member meets these refusals in the Web UI, so the catalog (and its Chinese copy) carries them.
    expect(controlErrorCatalog().filter((entry) => entry.code.endsWith("-human-only"))).toEqual([
      { code: "control-field-human-only", status: 403 }, { code: "control-verb-human-only", status: 403 },
    ]);
  });

  // Debug task plan Task 6: opening a correction's debug group spends nothing, so every principal may; the undo.how the
  // closing row records as the human's is an owner's field.
  // CLI v2 spec §15.1 (plan Task 10, same Ruling): undoHow is open to the socket agent -- §16 records it by the owner, via
  // the agent's channel -- and stays refused to a member.
  it("lets an agent open a debug group and send undoHow; a member may not send undoHow", () => {
    const payload = { correctionId: "c_0123456789abcdef" };
    for (const p of [owner, member, agent]) expect(permissionRefusal(p, "correction-debug-open", payload)).toBe(null);
    expect(permissionRefusal(member, "correction-debug-open", { ...payload, undoHow: "git revert --no-edit HEAD" })?.code).toBe("control-field-human-only");
    expect(permissionRefusal(agent, "correction-debug-open", { ...payload, undoHow: "git revert --no-edit HEAD" })).toBe(null);
    expect(permissionRefusal(owner, "correction-debug-open", { ...payload, undoHow: "git revert --no-edit HEAD" })).toBe(null);
  });

  it("is one row per role and one for the agent; only an owner manages accounts; several roles take the widest", () => {
    // Spec §3.1: a role is a row; the decisions above read these rows, not a role name.
    expect(Object.keys(PERMISSIONS).sort()).toEqual(["agent", "member", "owner"]);
    expect([owner, member, agent].map((p) => may(p, "accounts"))).toEqual([true, false, false]);
    expect(mayDoHumanOnly({ ...member, roles: ["member", "owner"] })).toBe(true);
  });

  // Live transcript spec §10.5.3 (T3): pause is a member's too -- any Web principal, or a socket with a verified person
  // token (a member's suffices); resume and note keep hasPersonAuthority. Never a run Orca dispatched.
  it("has pause authority: any Web principal or a socket with a person token, never a dispatched run", () => {
    const memberToken = { kind: "agent" as const, client: "cli:claude", person: { userId: "u2", name: "m", roles: ["member" as const] } };
    const ownerToken = { kind: "agent" as const, client: "cli:claude", person: { userId: "u1", name: "o", roles: ["owner" as const] } };
    const rows: Array<{ who: string; p: Principal; pause: boolean; person: boolean }> = [
      { who: "web member", p: member, pause: true, person: false },
      { who: "web owner", p: owner, pause: true, person: true },
      { who: "socket, no person", p: agent, pause: false, person: false },
      { who: "socket, member token", p: memberToken, pause: true, person: false },
      { who: "socket, owner token", p: ownerToken, pause: true, person: true },
      { who: "socket, dispatched with token", p: { kind: "agent", client: "cli:claude", dispatchedRun: "run-1", person: ownerToken.person }, pause: false, person: false },
    ];
    expect(rows.map(({ who, p, pause }) => [who, hasPauseAuthority(p)])).toEqual(rows.map(({ who, pause }) => [who, pause]));
    expect(rows.map(({ who, p, person }) => [who, hasPersonAuthority(p)])).toEqual(rows.map(({ who, person }) => [who, person]));
  });

  // T3: the fact rides beside the command (withCommandContext) and is read by the flow route's kernel work.
  it("routes pause authority beside the command, absent meaning none", () => {
    expect(withCommandContext("cmd-pause", { client: "web", principal: "web", pauseAuthority: true }, () => routedPauseAuthorityFor("cmd-pause"))).toBe(true);
    expect(withCommandContext("cmd-quiet", { client: "web", principal: "web" }, () => routedPauseAuthorityFor("cmd-quiet"))).toBe(false);
    expect(routedPauseAuthorityFor("cmd-pause")).toBe(false);
  });

  it("classifies every control verb and route: a GET reads, a POST is a command route whose verb has an entry", async () => {
    const h = await webFixture();
    try {
      // Every control route a panel can register: with a service and a port, as the socket mounts them.
      const app = express();
      const port = { listAgents: async () => ({ installations: [] }), resolveAgent: async () => ({}) } as never;
      registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: new WebControlService(h.deps), port }, "socket");
      const registered = (app.router.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>)
        .flatMap((layer) => (layer.route ? Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`) : []))
        .filter((entry) => entry.split(" ")[1]!.startsWith("/api/control"));
      const commands = controlCommandRoutes("operator-x");
      const commandPaths = commands.map((route) => `POST ${route.path}`);
      // Non-vacuous: the walk sees the reads and every command route.
      expect(registered.filter((entry) => entry.startsWith("GET ")).length).toBeGreaterThanOrEqual(12);
      // Reviewed detection and the model-list refresh are the only POST probes: no operator command result or table
      // mutation. Ruling (session 4de777f4, 2026-10-17, criteria changes authorized for this session): the refresh moved
      // from `GET ?refresh=1` to a POST so the CSRF check covers it.
      // Agent version auto-refresh spec 2026-10-20 §3.3 (human ruling, session 308b874c: 「静默更新就行」; test changes
      // authorized that session): the owner-only version refresh is a third, and it does write the agents table's
      // version fields -- outside the command ledger by that ruling, owner-only and CSRF-checked like the models refresh.
      // Gaps spec §4.7, §13 (plan Task 5; Ruling: 这次批准改写所有必要的判据 (0e13a9b7)): the feedback attachment upload is a
      // fourth -- content-addressed and idempotent, outside the command ledger as §13 names it, access as flow-message.
      expect(registered.filter((entry) => !entry.startsWith("GET ") && !commandPaths.includes(entry)).sort()).toEqual([
        "POST /api/control/agents/:installation/models/refresh",
        "POST /api/control/agents/refresh-versions",
        "POST /api/control/flows/:runId/attachments",
        "POST /api/control/operator/agent-update-preview",
      ]);
      expect(commandPaths.filter((entry) => !registered.includes(entry))).toEqual([]);
      // Every verb has an entry, and a verb a principal can send has exactly one route; a panel verb has none.
      const verbs = [...commandVerbSchema.options].sort();
      expect(Object.keys(VERB_ACCESS).sort()).toEqual(verbs);
      // Checks spec 2026-10-22 §4.4 (plan Task 4): the two settings-layer verbs have one route per layer -- the project's
      // and the global one -- and only they. Ruling: 这次批准改写所有必要的判据 (b37f7ce9).
      // Flow engine spec §11.2 (plan Task 12): set-flow-settings likewise. Ruling: 这次批准改写所有必要的判据 (b37f7ce9).
      const PER_LAYER = ["set-check-settings", "set-scheduled-check", "set-flow-settings"];
      expect(PER_LAYER.map((verb) => commands.filter((route) => route.verb === verb).length)).toEqual([2, 2, 2]);
      const routed = commands.map((route) => route.verb).filter((verb, index, all) => !PER_LAYER.includes(verb) || all.indexOf(verb) === index).sort();
      expect(routed).toEqual(verbs.filter((verb) => VERB_ACCESS[verb] !== "panel"));
      expect(new Set(routed).size).toBe(routed.length);
    } finally { await h.dispose(); }
  });
});
