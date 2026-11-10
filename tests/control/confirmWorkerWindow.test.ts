// Tester follow-up B T3 (#203): a worker profile that declares no context window used to refuse every handoff threshold
// with a bare execution-policy-unrepresentable, though each task's frozen selection names a window. Confirm now falls back
// to the frozen worker selections' numeric window, and the refusal says which case it is.
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

const nullWindowProfile = () => {
  const snapshot = profileSnapshot();
  snapshot.profile.capabilities = { ...snapshot.profile.capabilities, contextWindowTokens: null };
  return snapshot;
};
const confirmAt = async (h: Awaited<ReturnType<typeof webFixture>>, threshold: number | null) =>
  new WebControlService(h.deps).confirm(h.command("confirm", { ...(await h.confirmPayload()), contextPolicy: { handoffAtContextTokens: threshold } }));

describe("confirm's handoff threshold against the worker window (#203)", () => {
  it("a null profile window takes the smallest frozen task selection window: below it confirms", async () => {
    const h = await webFixture(nullWindowProfile(), [{ taskId: "a", agent: { contextWindow: 272_000 } }, { taskId: "b", agent: { contextWindow: 400_000 } }]);
    try {
      // Mutation "profile window only" -> red: execution-policy-unrepresentable.
      expect(await confirmAt(h, 200_000)).toMatchObject({ result: { kind: "confirmed" } });
    } finally { await h.dispose(); }
  });

  it("above the smallest frozen window it is refused naming that window", async () => {
    const h = await webFixture(nullWindowProfile(), [{ taskId: "a", agent: { contextWindow: 272_000 } }, { taskId: "b", agent: { contextWindow: 400_000 } }]);
    try {
      expect(await confirmAt(h, 300_000)).toMatchObject({ error: { code: "execution-policy-unrepresentable", message: "execution-policy-unrepresentable:threshold-above-window:272000" } });
    } finally { await h.dispose(); }
  });

  it("a task whose selection leaves the window to the agent makes the window unknown", async () => {
    const h = await webFixture(nullWindowProfile(), [{ taskId: "a", agent: { contextWindow: 272_000 } }, { taskId: "b" }]);
    try {
      expect(await confirmAt(h, 200_000)).toMatchObject({ error: { code: "execution-policy-unrepresentable", message: "execution-policy-unrepresentable:worker-window-unknown" } });
      // No threshold under an unknown window confirms, as before.
      expect(await confirmAt(h, null)).toMatchObject({ result: { kind: "confirmed" } });
    } finally { await h.dispose(); }
  });

  it("a declared profile window still bounds the threshold, and the refusal names it", async () => {
    const h = await webFixture();
    try {
      expect(await confirmAt(h, 1_000_001)).toMatchObject({ error: { code: "execution-policy-unrepresentable", message: "execution-policy-unrepresentable:threshold-above-window:1000000" } });
    } finally { await h.dispose(); }
  });
});
