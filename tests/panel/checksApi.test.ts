// Checks spec 2026-10-22 §4.3 / §7: the effective check settings over HTTP, per field with its source layer and lock,
// for one project (`?repoId=`) or the global layer alone. A read: open to the Web and to an agent on the socket (P6).
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { BUILTIN_TRIGGERS } from "../../src/control/checks/trigger.js";
import { checksReadSchema } from "../../src/control/checks/settings.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { sessionFor } from "./fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });

describe("GET /api/control/checks", () => {
  it("answers the effective settings with their sources for a project and for the global layer; an unknown project is 404", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
    const panel = await boot(w, [], { port: true });
    const repo = controlRepoKey("proj");
    const owner = await sessionFor(panel, w.env);

    const project = await owner.fetch(`/api/control/checks?repoId=${repo}`);
    expect(project.status).toBe(200);
    const body = checksReadSchema.parse(await project.json());
    expect(body.repoId).toBe(repo);
    expect(body.kinds["model-review"].enabled).toEqual({ value: true, source: "builtin", lockedBy: null });
    expect(body.kinds["integration-check"].trigger).toEqual({ value: BUILTIN_TRIGGERS["integration-check"], source: "builtin", lockedBy: null });
    expect(body.state).toEqual([]);

    const global = checksReadSchema.parse(await (await owner.fetch("/api/control/checks")).json());
    expect(global.repoId).toBeNull();

    // An agent on the socket reads the same answer (reads are open, §7).
    const socket = await overSocket((panel as StartedPanel).socketPath!, "GET", `/api/control/checks?repoId=${repo}`, { "x-orca-client": "cli:test" });
    expect(socket.status).toBe(200);
    expect(checksReadSchema.parse(JSON.parse(socket.text))).toEqual(body);

    const unknown = await owner.fetch("/api/control/checks?repoId=nope");
    expect([unknown.status, ((await unknown.json()) as { error: { code: string } }).error.code]).toEqual([404, "control-target-not-allowed"]);
  });
});
