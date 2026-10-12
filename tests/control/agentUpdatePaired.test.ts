import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { applyAgentUpdate, hasPendingAgentUpdate, pendingAgentUpdateCommand, reconcilePendingAgentUpdates } from "../../src/control/agentUpdates.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { openControlStore } from "../../src/control/store.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { openTestStore } from "./fixtures/store.js";
import { readAgentPreferences } from "../../src/control/agentPreferences.js";

const pairedBinary = process.env.ORCA_TASK9_CCLOOP_BIN;
const oldBinary = process.env.ORCA_TASK9_OLD_CCLOOP_BIN;

describe.skipIf(!pairedBinary || !oldBinary)("paired reviewed installation update CLI", () => {
  it("observes, previews, and applies one accepted version while preserving custom table fields", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agent-paired-")));
    const h = await openTestStore();
    try {
      const cli = join(root, "fake-claude");
      await writeFile(cli, '#!/bin/sh\n[ "$1" = "--custom" ] && [ "$2" = "--version" ] && echo "2.1.283"\n', { mode: 0o700 });
      await chmod(cli, 0o700);
      const custom = { kind: "claude", command: [cli, "--custom"], version: "2.1.282", configDir: join(root, "config"), timeoutMs: 1234, killGraceMs: 77 };
      const alias = { ...custom, version: "2.1.283" };
      const table = join(root, "agents.json");
      await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { custom, alias } }), { mode: 0o600 });
      const port = createCcloopExecutionPort({ binary: pairedBinary!, agentsTablePath: table, timeoutMs: 10_000 });
      const observation = await port.observeAgentInstallations!();
      expect(observation.installed.find((row) => row.id === "custom")).toMatchObject({ status: "changed", recordedVersion: "2.1.282", observedVersion: "2.1.283" });
      const preview = await port.previewAgentInstallations!();
      const choice = preview.changes.find((change) => change.kind === "version" && change.installationId === "custom");
      expect(choice).toBeDefined();
      const acceptedChangeIds = [choice!.changeId];
      const command = { schema: "orca-raw-command-v1" as const, commandId: "paired-apply", expectedRevision: 0, actorId: "human",
        verb: "apply-agent-update" as const, target: { kind: "operator" as const, operatorId: "human" },
        payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds } };
      const answer = await applyAgentUpdate({ store: h.store, port }, command, { client: "web", principal: "user:owner" });
      expect(answer).toMatchObject({ status: 200, body: { commandRevision: 1, result: { kind: "agent-installations-updated" } } });
      const after = JSON.parse(await readFile(table, "utf8")) as { installations: { custom: typeof custom; alias: typeof alias } };
      expect(after.installations.custom).toEqual({ ...custom, version: "2.1.283" });
      expect(after.installations.alias).toEqual(alias);
      expect(readAgentPreferences(h.store, "human").revision).toBe(0);
      expect((await port.listAgents()).installations.find((row) => row.id === "custom")?.version).toBe("2.1.283");
    } finally { await h.dispose(); await rm(root, { recursive: true, force: true }); }
  });

  it("keeps the pinned old peer usable for ordinary agents while refusing update observation", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agent-old-peer-")));
    try {
      const table = join(root, "agents.json");
      const cli = join(root, "fake-claude");
      await writeFile(cli, '#!/bin/sh\necho "2.1.283"\n', { mode: 0o700 });
      await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { custom: { kind: "claude", command: [cli], version: "2.1.283", configDir: null, timeoutMs: 1234, killGraceMs: 77 } } }), { mode: 0o600 });
      const old = createCcloopExecutionPort({ binary: oldBinary!, agentsTablePath: table, timeoutMs: 10_000 });
      expect((await old.listAgents()).installations.map((row) => row.id)).toEqual(["custom"]);
      await expect(old.observeAgentInstallations!()).rejects.toMatchObject({ code: "control-agent-update-unsupported" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("keeps an unknown Task 9 apply pending when the configured peer becomes old, then accepts the original receipt", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agent-peer-switch-")));
    const h = await openTestStore();
    let reopened: Awaited<ReturnType<typeof openControlStore>> | null = null;
    try {
      const cli = join(root, "fake-claude");
      await writeFile(cli, '#!/bin/sh\n[ "$1" = "--custom" ] && [ "$2" = "--version" ] && echo "2.1.283"\n', { mode: 0o700 });
      const table = join(root, "agents.json");
      await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
        custom: { kind: "claude", command: [cli, "--custom"], version: "2.1.282", configDir: join(root, "config"), timeoutMs: 1234, killGraceMs: 77 },
      } }), { mode: 0o600 });
      const newPort = createCcloopExecutionPort({ binary: pairedBinary!, agentsTablePath: table, timeoutMs: 10_000 });
      const preview = await newPort.previewAgentInstallations!();
      const choice = preview.changes.find((change) => change.kind === "version" && change.installationId === "custom");
      expect(choice).toBeDefined();
      const command = { schema: "orca-raw-command-v1" as const, commandId: "unknown-switch-1", expectedRevision: 0, actorId: "human",
        verb: "apply-agent-update" as const, target: { kind: "operator" as const, operatorId: "human" },
        payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: [choice!.changeId] } };
      await expect(withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () =>
        applyAgentUpdate({ store: h.store, port: newPort }, command, { client: "web", principal: "user:owner" }, () => { throw new Error("lost-after-receipt"); })))
        .rejects.toThrow("lost-after-receipt");
      const changed = await readFile(table);
      expect(JSON.parse(changed.toString()).installations.custom.version).toBe("2.1.283");
      h.store.close();
      reopened = await openControlStore({ stateDir: join(h.root, "state") });
      const oldPort = createCcloopExecutionPort({ binary: oldBinary!, agentsTablePath: table, timeoutMs: 10_000 });
      await expect(applyAgentUpdate({ store: reopened, port: oldPort }, command, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-agent-update-unsupported" });
      expect(hasPendingAgentUpdate(reopened, "human")).toBe(true);
      expect(lookupCommandResult(reopened, "@operator:human", command.commandId)).toBeNull();
      await expect(reconcilePendingAgentUpdates(reopened, oldPort)).rejects.toMatchObject({ code: "control-agent-update-unsupported" });
      expect(hasPendingAgentUpdate(reopened, "human")).toBe(true);
      expect(pendingAgentUpdateCommand(reopened, "human")?.commandId).toBe(command.commandId);
      expect(lookupCommandResult(reopened, "@operator:human", command.commandId)).toBeNull();
      expect(await readFile(table)).toEqual(changed);
      const manual = await withCommandContext(command.commandId, { client: "web", principal: "user:other-owner" }, () =>
        applyAgentUpdate({ store: reopened!, port: newPort }, command, { client: "web", principal: "user:other-owner" }));
      expect(manual.status).toBe(200);
      const booked = lookupCommandResult(reopened, "@operator:human", command.commandId);
      expect(booked).toMatchObject({ originalStatus: 200, body: { commandId: command.commandId, commandRevision: 1 } });
      const receipt = JSON.parse(String(reopened.db.prepare("SELECT receipt_json FROM agent_update_outbox WHERE operator_id='human' AND command_id=?").get(command.commandId)?.receipt_json)) as
        { opId: string; previewId: string; acceptedChangeIds: string[]; afterHash: string };
      expect(receipt).toMatchObject({ opId: command.commandId, previewId: preview.previewId, acceptedChangeIds: [choice!.changeId] });
      expect(booked?.body).toMatchObject({ result: { afterHash: receipt.afterHash } });
      expect(reopened.db.prepare("SELECT client,principal FROM commands WHERE group_id='@operator:human' AND id=?").get(command.commandId))
        .toEqual({ client: "web", principal: "user:owner" });
      expect(hasPendingAgentUpdate(reopened, "human")).toBe(false);
      expect(await readFile(table)).toEqual(changed);
    } finally { reopened?.close(); h.store.close(); await rm(h.root, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
  });
});
