import { describe, expect, it } from "vitest";
import { getFlowRun } from "../../src/flow/store.js";
import { builtinKinds, createKindRegistry } from "../../src/flow/kinds/registry.js";
import { FlowRefusal } from "../../src/flow/kernel.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §4.1 and §12.3 (plan Task 8): each kind registers once (a duplicate fails at start-up, R §6); a run
 * starts only from a template that passes the checklist, with every required command's check passing and every role
 * resolved (never borrowed: `role-unresolved:<role>`), and its expanded template is stored once by hash.
 */
describe("kind registry", () => {
  it("refuses a second registration of a kind", () => {
    const registry = createKindRegistry();
    const kind = { kind: "draft", kindVersion: 1, interactive: false, start: async () => ({ failed: { reason: "x" } }) } as const;
    registry.register(kind);
    expect(() => registry.register(kind)).toThrow(/duplicate kind draft/);
  });

  it("the built-in registry holds the phase-1 record kinds, each with its version", () => {
    const kinds = builtinKinds();
    for (const name of ["clarify", "draft", "check", "review"]) expect(kinds.get(name)?.kindVersion).toBe(1);
    expect(kinds.get("nope")).toBeUndefined();
  });
});

const tpl = (roles: string, extra = "") => ({
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
roles:
${roles}
${extra}steps:
  - {id: outline, kind: draft, role: writer, prompt: p.md}
`,
  assets: { "p.md": "Write.\n" },
});

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try { await promise; } catch (error) { if (error instanceof FlowRefusal) return error.code; throw error; }
  throw new Error("expected a refusal");
};

describe("startFlowRun", () => {
  it("refuses a reviewer that cannot be distinct from the writer on this machine", async () => {
    const w = await flowWorld({ t: tpl("  writer: {tier: high, suggest: {agent: claude}}\n  reviewer: {tier: high, distinctFrom: writer}") }, {
      agents: [{ agent: "claude", model: "opus", tier: "high" }],
    }); try {
      expect(await refusal(w.start({ templateRef: "builtin/t" }))).toBe("role-unresolved:reviewer");
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM flow_runs").get()).toMatchObject({ n: 0 });
    } finally { await w.dispose(); }
  });

  it("refuses a role whose tier no available agent meets", async () => {
    const w = await flowWorld({ t: tpl("  writer: {tier: high}") }, { agents: [{ agent: "codex", model: "mini", tier: "low" }] }); try {
      expect(await refusal(w.start({ templateRef: "builtin/t" }))).toBe("role-unresolved:writer");
    } finally { await w.dispose(); }
  });

  it("resolves roles in order template suggestion, then the default, recording the source", async () => {
    const w = await flowWorld({ t: tpl("  writer: {tier: high, suggest: {agent: codex}}\n  reviewer: {tier: mid, distinctFrom: writer}") }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      const body = getFlowRun(w.store, flowRunId)!.body as { roles: Record<string, unknown> };
      expect(body.roles).toEqual({
        writer: { agent: "codex", model: "gpt", source: "template" },
        reviewer: { agent: "claude", model: "opus", source: "default" },
      });
    } finally { await w.dispose(); }
  });

  it("refuses to start when a required command's check fails, naming the command", async () => {
    const w = await flowWorld({ t: tpl("  writer: {tier: high}", "requires:\n  commands:\n    - {name: md2wechat, check: \"exit 3\"}\n") }); try {
      expect(await refusal(w.start({ templateRef: "builtin/t" }))).toBe("flow-command-missing:md2wechat");
    } finally { await w.dispose(); }
  });

  it("refuses a template that fails the checklist", async () => {
    const w = await flowWorld({ t: { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n  - {id: a, kind: draft, prompt: missing.md}\n" } }); try {
      expect(await refusal(w.start({ templateRef: "builtin/t" }))).toBe("flow-template-invalid");
    } finally { await w.dispose(); }
  });

  it("stores the expanded template once by hash and opens the parent group", async () => {
    const w = await flowWorld({ t: tpl("  writer: {tier: high}") }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/t" });
      const run = getFlowRun(w.store, flowRunId)!;
      expect(run.groupId).toBe(groupId);
      const stored = JSON.parse(readCanonicalRecord(w.store, run.templateSha256)) as { template: { id: string }; assets: Record<string, string> };
      expect(stored.template.id).toBe("t");
      expect(stored.assets).toEqual({ "p.md": "Write.\n" });
      const group = JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as { flow: unknown };
      expect(group.flow).toMatchObject({ role: "parent", flowRunId, workspaceKind: "dir" });
    } finally { await w.dispose(); }
  });
});
