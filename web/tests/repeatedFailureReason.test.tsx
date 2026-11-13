import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");
const repeated = run({ runId: "run-r", state: "blocked", outcome: "exhausted", stopReason: "repeated failure pattern detected",
  failureCause: { cause: "verifier-rejected", phase: "verify", retries: 0, detail: null } });

// Tester #235 (follow-up K): ccloop stops a run whose failure repeats (outcome `exhausted`) while attempts remain; its reason
// showed only the raw text beside "exhausted", which reads as the budget or attempts running out. It now says, in English
// and Chinese, that the same failure repeated, so it stopped. Wording only: the ladder is unchanged.
describe("a run ccloop stopped on a repeated failure (#235)", () => {
  it("says the same failure repeated, so it stopped", async () => {
    // mutation: no words for the repeated-failure stop -> only the raw reason, red
    expect(text(renderToStaticMarkup(<RunReason run={repeated} />))).toContain("The same failure repeated, so it stopped.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={repeated} />))).toContain("同样的失败重复出现，所以停下了。");
  });
  it("gives other stop reasons no such words", () => {
    expect(text(renderToStaticMarkup(<RunReason run={{ ...repeated, stopReason: "attempt budget exhausted" }} />))).not.toContain("same failure repeated");
  });
});
