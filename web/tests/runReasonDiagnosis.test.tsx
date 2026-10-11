import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

describe("run failure diagnosis", () => {
  it("shows typed phase and decode cause before the raw code and identity", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-a", providerAttemptOrdinal: 2, state: "blocked", outcome: "failed", stopReason: "Error: codex-execution-format-invalid", diagnosis: { phase: "work", step: "executing", cause: "execution-format-invalid", attempt: 2 } })} />);
    expect(html).toContain("Execution output could not be decoded");
    expect(html).toContain("executing");
    expect(html).toContain("attempt 2");
    expect(html.indexOf("Execution output could not be decoded")).toBeLessThan(html.indexOf("codex-execution-format-invalid"));
    expect(html).toContain("run-a");
  });

  it("names an old unknown cause without inventing a token diagnosis", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-old", state: "blocked", outcome: "failed", stopReason: "Error: strange-old-error", diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 1 } })} />);
    expect(html).toContain("Cause unknown");
    expect(html).toContain("strange-old-error");
    expect(html).not.toMatch(/token budget|token exhaustion/i);
  });

  it("keeps the diagnosis for a settled failed run with no raw reason or code", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-silent", providerAttemptOrdinal: 3, state: "settled-failed", outcome: "failed", stopReason: null, blockedReason: null, failureCode: null, diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 3 } })} />);
    expect(html).toContain("Cause unknown");
    expect(html).toContain("attempt 3");
    expect(html).toContain("run-silent");
  });
});
