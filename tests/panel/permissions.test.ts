import express from "express";
import { describe, expect, it } from "vitest";
import { commandVerbSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlCommandRoutes, registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { controlErrorCatalog } from "../../src/panel/controlErrors.js";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { may, mayDoHumanOnly, PERMISSIONS, permissionRefusal, principalLabel } from "../../src/panel/permissions.js";
import { webFixture } from "../control/fixtures/web.js";

const owner = { kind: "user" as const, userId: "u1", name: "o", roles: ["owner" as const] };
const member = { kind: "user" as const, userId: "u2", name: "m", roles: ["member" as const] };
const agent = { kind: "agent" as const, client: "cli:claude" };

describe("the permission table (spec §3.5)", () => {
  it("lets an owner do human-only actions and refuses member and agent by the same codes", () => {
    expect(permissionRefusal(owner, "set-limit", { limit: {} })).toBe(null);
    for (const p of [member, agent]) {
      expect(permissionRefusal(p, "set-limit", { limit: {} })?.code).toBe("control-verb-human-only");
      expect(permissionRefusal(p, "requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-field-human-only");
      expect(permissionRefusal(p, "confirm", {})).toBe(null);
    }
    expect([owner, member, agent].map(mayDoHumanOnly)).toEqual([true, false, false]);
    expect([owner, agent].map(principalLabel)).toEqual(["user:u1", "agent:cli:claude"]);
    // A member meets these refusals in the Web UI, so the catalog (and its Chinese copy) carries them.
    expect(controlErrorCatalog().filter((entry) => entry.code.endsWith("-human-only"))).toEqual([
      { code: "control-field-human-only", status: 403 }, { code: "control-verb-human-only", status: 403 },
    ]);
  });

  it("is one row per role and one for the agent; only an owner manages accounts; several roles take the widest", () => {
    // Spec §3.1: a role is a row; the decisions above read these rows, not a role name.
    expect(Object.keys(PERMISSIONS).sort()).toEqual(["agent", "member", "owner"]);
    expect([owner, member, agent].map((p) => may(p, "accounts"))).toEqual([true, false, false]);
    expect(mayDoHumanOnly({ ...member, roles: ["member", "owner"] })).toBe(true);
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
      expect(registered.filter((entry) => !entry.startsWith("GET ") && !commandPaths.includes(entry))).toEqual([]);
      expect(commandPaths.filter((entry) => !registered.includes(entry))).toEqual([]);
      // Every verb has an entry, and a verb a principal can send has exactly one route; a panel verb has none.
      const verbs = [...commandVerbSchema.options].sort();
      expect(Object.keys(VERB_ACCESS).sort()).toEqual(verbs);
      const routed = commands.map((route) => route.verb).sort();
      expect(routed).toEqual(verbs.filter((verb) => VERB_ACCESS[verb] !== "panel"));
      expect(new Set(routed).size).toBe(routed.length);
    } finally { await h.dispose(); }
  });
});
