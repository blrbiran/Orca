import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySetAgentPreferences, readAgentPreferences, type SetAgentPreferencesCommand } from "../../src/control/agentPreferences.js";
import type { OperatorPreferences } from "../../src/control/agentSelection.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import { openControlStore } from "../../src/control/store.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { openTestStore } from "./fixtures/store.js";

// Agent selection spec §6.2 layer 1 and §12 I10: operator preferences are a setting with their own revision
// in the ledger's `operator` scope, keyed by operatorId, and never move a group's revision or projection.

const preferences: OperatorPreferences = { defaultAgent: "claude", perAgent: { claude: { model: "claude-opus-5-5", contextWindow: 1_000_000 }, codex: { model: "gpt-6-sol" } }, reconcile: { agent: "codex" } };
const command = (commandId: string, expectedRevision: number, value: OperatorPreferences = preferences, operatorId = "human", actorId = "human"): SetAgentPreferencesCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId, verb: "set-agent-preferences",
  target: { kind: "operator", operatorId }, payload: { preferences: value },
});

describe("operator agent preferences (spec §6.2 layer 1)", () => {
  it("reads an empty preference document at revision 0 when nothing was ever set", async () => {
    const h = await openTestStore(); try {
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
    } finally { await h.dispose(); }
  });

  it("sets under the operator's own revision, in the operator ledger scope, with no group revision or projection", async () => {
    const h = await openTestStore(); try {
      const changeSeq = readProjectionState(h.store).changeSeq;
      const result = applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      expect(result).toMatchObject({ schema: "orca-command-success-v1", verb: "set-agent-preferences", commandRevision: 1, projectionSeq: null,
        result: { kind: "agent-preferences-set", operatorId: "human", revision: 1 } });
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences, revision: 1 });
      expect(h.store.db.prepare("SELECT group_id,scope_kind,scope_id FROM commands WHERE id='prefs-1'").get())
        .toEqual({ group_id: "@operator:human", scope_kind: "operator", scope_id: "human" });
      expect(lookupCommandResult(h.store, "@operator:human", "prefs-1")).toMatchObject({ originalStatus: 200, body: result });
      expect(readProjectionState(h.store).changeSeq).toBe(changeSeq);
      // The stored document is the canonical bytes of what was sent: a reader can recompute its identity.
      expect(String(h.store.db.prepare("SELECT doc_json FROM agent_preferences WHERE operator_id='human'").get()!.doc_json))
        .toBe(JSON.stringify({ defaultAgent: "claude", perAgent: { claude: { contextWindow: 1_000_000, model: "claude-opus-5-5" }, codex: { model: "gpt-6-sol" } }, reconcile: { agent: "codex" } }));
    } finally { await h.dispose(); }
  });

  it("advances by the preference revision and refuses a stale one without touching the stored document", async () => {
    const h = await openTestStore(); try {
      applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      const second = { ...preferences, defaultAgent: "codex" };
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-2", 1, second))).toMatchObject({ commandRevision: 2, result: { revision: 2 } });
      const stale = applySetAgentPreferences({ store: h.store }, command("prefs-3", 1, preferences));
      expect(stale).toMatchObject({ error: { code: "revision-conflict", commandRevision: 2, retryable: false } });
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: second, revision: 2 });
    } finally { await h.dispose(); }
  });

  it("replays a repeated command id and refuses setting the document it already holds", async () => {
    const h = await openTestStore(); try {
      const first = applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-1", 0))).toEqual(first);
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-2", 1))).toMatchObject({ error: { code: "no-op-command" } });
      expect(readAgentPreferences(h.store, "human").revision).toBe(1);
    } finally { await h.dispose(); }
  });

  it("lets an actor set only its own preferences (identity is an interface for now, spec §2)", async () => {
    const h = await openTestStore(); try {
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-1", 0, preferences, "someone-else", "human")))
        .toMatchObject({ error: { code: "control-target-not-allowed" } });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM agent_preferences").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("carries the revision only on the envelope (controller ruling W6-8) and refuses unknown fields and a zero window", () => {
    const valid = command("prefs-1", 0);
    expect(rawAuthorityCommandSchema.safeParse(valid).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, expectedRevision: 0 } }).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, preferences: { ...preferences, secret: "x" } } }).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, preferences: { perAgent: { claude: { contextWindow: 0 } } } } }).success).toBe(false);
  });

  it("migrates a version 4 store by adding the preferences table", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-migrate-5-")));
    try {
      const first = await openControlStore({ stateDir: join(root, "state") });
      first.db.exec("DROP TABLE agent_preferences");
      first.db.prepare("UPDATE meta SET value='4' WHERE key='schemaVersion'").run();
      first.close();
      const second = await openControlStore({ stateDir: join(root, "state") });
      expect(second.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("5");
      expect(readAgentPreferences(second, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
      second.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
