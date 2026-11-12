import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const FIELD = "commandOutputs: expected array, received string";
const formatFailed = (formatField?: string) => run({ runId: "run-f", state: "blocked", outcome: "failed", stopReason: `Error: codex-result-invalid: /runs/run-f/call: ${FIELD}`,
  failureCause: { cause: "unknown", phase: "execute", retries: 0, detail: `execution-format-invalid: ${FIELD}` },
  diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 1, ...(formatField === undefined ? {} : { formatField }) } });
const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

// Tester #274: ccloop names the field its strict execute shape refused; the run's reason says it in words, so a person does
// not have to dig it out of the evidence.
describe("a run whose execute answer did not fit the format names the refused field (#274)", () => {
  it("says the answer did not fit and which field was refused, in English and Chinese", async () => {
    // mutation: formatLine left out of the rendered reason -> red
    expect(text(renderToStaticMarkup(<RunReason run={formatFailed(FIELD)} />))).toContain(`The agent's answer did not fit the execute format; refused: ${FIELD}.`);
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={formatFailed(FIELD)} />))).toContain(`被拒的字段：${FIELD}`);
  });

  it("says nothing of the format when the diagnosis names no field", () => {
    expect(renderToStaticMarkup(<RunReason run={formatFailed()} />)).not.toContain("run-format-field");
  });
});
