import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");
const refused = run({ runId: "run-m", state: "blocked", outcome: "failed", stopReason: "codex-exit-error",
  failureCause: { cause: "model-unavailable", phase: "plan", retries: 0, detail: "unexpected status 404 Not Found" } });

// Tester follow-up J (#299): the panel words ccloop's `model-unavailable` (it read as "unknown") and says Orca does not
// retry it or switch the model, in English and Chinese.
describe("a run whose model the provider does not serve (#299)", () => {
  it("names the cause and the person's next step", async () => {
    // mutation: model-unavailable missing from KNOWN_FAILURE_CAUSES -> "the cause is unknown", red
    expect(text(renderToStaticMarkup(<RunReason run={refused} />))).toContain("Why it stopped: the provider does not serve this model for the agent. Orca does not retry it or switch the model by itself.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={refused} />))).toContain("provider 不为这个 agent 提供该模型");
  });
});
