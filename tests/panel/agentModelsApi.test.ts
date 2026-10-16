/**
 * Spec 2026-10-15 §5 (part C, R3, R4): `GET /api/control/agents/:installation/models[?refresh=1]` over a real Panel.
 * Owner and member read; refresh=1 spawns the agent's CLI, so it is owner-only; Orca keeps no cache, so every read
 * reaches the port with the refresh flag the caller sent. RF5: an installation removed from the table is a named,
 * determinate refusal the selection editor can explain.
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { createHarness, get, json, type BootOptions } from "./fixtures/controlPanel.js";
import { login, seedUser } from "./fixtures/auth.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const boot = async (epoch: string, options: BootOptions) => h.boot(epoch, await h.workspace(), options);
const errorOf = async (response: Response) => ((await json(response)) as { error: { code: string; message: string } }).error;

describe("the model list route (spec 2026-10-15 §5)", () => {
  // Spec 2026-10-15 §5 (R3, R4): owner and member read; refresh=1 is owner-only (it spawns the CLI); no Orca-side cache.
  it("serves the view to a session, refuses refresh to a member, and passes refresh to the port", async () => {
    const seen: Array<[string, boolean]> = [];
    const panel = await boot("epoch-models", { listModels: async (installation, refresh) => { seen.push([installation, refresh]);
      return { installation, kind: "codex", source: "cache", observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] }; } });
    expect(await json(await get(panel, "/api/control/agents/codex/models"))).toEqual({ schema: "orca-agent-models-v1", installation: "codex", kind: "codex", source: "cache",
      observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] });
    expect((await get(panel, "/api/control/agents/codex/models?refresh=1")).status).toBe(200);
    expect((await get(panel, "/api/control/agents/codex/models", "none")).status).toBe(401);
    expect((await get(panel, "/api/control/agents/codex/models?refresh=yes")).status).toBe(400);
    expect((await get(panel, "/api/control/agents/codex/models?other=1")).status).toBe(400);
    // An installation id the table could never hold is refused before ccloop is asked (`seen` below stays three reads).
    expect((await get(panel, "/api/control/agents/-codex/models")).status).toBe(400);
    seedUser(join(panel.root, "accounts"), "member", "member");
    const member = await login(panel.url, "member");
    expect((await member.fetch("/api/control/agents/codex/models")).status).toBe(200);
    const denied = await member.fetch("/api/control/agents/codex/models?refresh=1");
    expect([denied.status, (await errorOf(denied)).code]).toEqual([403, "owner-required"]);
    expect(seen).toEqual([["codex", false], ["codex", true], ["codex", false]]);
  });

  it("names ccloop's failure (424 ccloop-failed) and a missing installation (RF5)", async () => {
    const panel = await boot("epoch-models-fail", { listModels: async (installation) => {
      if (installation === "gone") throw new ControlError("agent-installation-missing", "gone");
      throw new ControlError("control-peer-exit", "1:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12"); } });
    const failed = await get(panel, "/api/control/agents/codex/models");
    expect([failed.status, await errorOf(failed)]).toEqual([424, expect.objectContaining({ code: "ccloop-failed", message: "ccloop-failed:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12" })]);
    // RF5: ccloop's named refusal keeps its own code (not ccloop-failed) and a determinate status (< 500, not "uncertain").
    const gone = await get(panel, "/api/control/agents/gone/models");
    expect([gone.status, (await errorOf(gone)).code]).toEqual([422, "agent-installation-missing"]);
  });

  // listModels is optional on the port (an older port lacks it): the route names that, rather than failing as a 500.
  it("refuses with control-protocol-unavailable when the port cannot list models", async () => {
    const panel = await boot("epoch-models-none", {});
    const refused = await get(panel, "/api/control/agents/codex/models");
    expect([refused.status, (await errorOf(refused)).code]).toEqual([422, "control-protocol-unavailable"]);
  });
});
