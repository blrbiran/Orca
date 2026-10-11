import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { applyAgentUpdate } from "../../src/control/agentUpdates.js";
import { openTestStore } from "./fixtures/store.js";
import { readAgentPreferences } from "../../src/control/agentPreferences.js";

const pairedBinary = process.env.ORCA_TASK9_CCLOOP_BIN;

describe.skipIf(!pairedBinary)("paired reviewed installation update CLI", () => {
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
      const old = createCcloopExecutionPort({ binary: realpathSync(resolve("node_modules/ccloop/dist/cli.js")), agentsTablePath: table, timeoutMs: 10_000 });
      expect((await old.listAgents()).installations.map((row) => row.id)).toEqual(["custom"]);
      await expect(old.observeAgentInstallations!()).rejects.toMatchObject({ code: "control-agent-update-unsupported" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
