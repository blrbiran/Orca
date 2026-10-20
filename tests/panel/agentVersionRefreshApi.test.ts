/**
 * Agent version auto-refresh spec 2026-10-20 §3.3 (human ruling, session 308b874c: 「不用看版本号变化，静默更新就行」):
 * `POST /api/control/agents/refresh-versions` over a real Panel. It spawns the agents' CLIs and rewrites the user's
 * agents table, so it is an owner-only POST under the session's CSRF check, like the models refresh. The refreshed
 * observation replaces the panel's stored one, so the Agents page's detection list does not keep showing a version
 * as "changed" after the table already records it.
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentObservation } from "../../src/control/agentInstallationProtocol.js";
import { createHarness, get, json, type BootOptions } from "./fixtures/controlPanel.js";
import { login, seedUser } from "./fixtures/auth.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const boot = async (epoch: string, options: BootOptions) => h.boot(epoch, await h.workspace(), options);
const errorOf = async (response: Response) => ((await json(response)) as { error: { code: string } }).error;
const observation = (recordedVersion: string): AgentObservation => ({ schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-20T00:00:00.000Z",
  installed: [{ id: "codex", kind: "codex", command: ["/opt/codex"], recordedVersion, observedVersion: "0.41.0", realpath: "/opt/codex", status: recordedVersion === "0.41.0" ? "current" : "changed" }] });

describe("the version refresh route (agent version auto-refresh spec §3.3)", () => {
  it("answers each installation's outcome to an owner, refuses a member and a forged POST, and replaces the stored observation", async () => {
    let asked = 0;
    const panel = await boot("epoch-version-refresh", {
      agentUpdatePort: { observeAgentInstallations: async () => observation("0.40.0") },
      refreshAgentVersions: async () => { asked += 1; return { rows: [{ id: "codex", recorded: "0.40.0", observed: "0.41.0", outcome: "updated" }], observation: observation("0.41.0") }; },
    });
    const refreshed = await panel.session.fetch("/api/control/agents/refresh-versions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect([refreshed.status, await json(refreshed)]).toEqual([200, { schema: "orca-agent-version-refresh-v1", rows: [{ id: "codex", recorded: "0.40.0", observed: "0.41.0", outcome: "updated" }] }]);
    const state = (await json(await get(panel, "/api/control/operator/agent-installations"))) as { observation: AgentObservation };
    expect(state.observation.installed[0]).toMatchObject({ recordedVersion: "0.41.0", status: "current" });
    const forged = await fetch(`${panel.url}/api/control/agents/refresh-versions`, { method: "POST", headers: { cookie: panel.session.cookie } });
    expect([forged.status, (await errorOf(forged)).code]).toEqual([403, "csrf-required"]);
    seedUser(join(panel.root, "accounts"), "member", "member");
    const member = await login(panel.url, "member");
    const denied = await member.fetch("/api/control/agents/refresh-versions", { method: "POST" });
    expect([denied.status, (await errorOf(denied)).code]).toEqual([403, "owner-required"]);
    expect(asked).toBe(1);
  });

  it("refuses with control-protocol-unavailable when the port cannot refresh versions", async () => {
    const panel = await boot("epoch-version-refresh-none", {});
    const refused = await panel.session.fetch("/api/control/agents/refresh-versions", { method: "POST" });
    expect([refused.status, (await errorOf(refused)).code]).toEqual([422, "control-protocol-unavailable"]);
  });
});
