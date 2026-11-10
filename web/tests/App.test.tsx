import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

// web's `check` script (package.json) runs `vitest run` after `tsc`, and Task 1
// ships zero real UI. A bare `vitest run` with no test files exits non-zero
// ("No test files found"), and `--passWithNoTests` would turn that into a gate
// that passes on nothing — a silent gate, per the plan's ruling C4. This is the
// one real criterion that keeps `check` honest until Task 8 gives App real
// content: renderToStaticMarkup, not jsdom, per plan ruling 2.
describe("App", () => {
  it("renders the placeholder markup", () => {
    // Ruling: R1 (plan 2026-11-10-tester-followup-b T8, #219): only the current section renders, so the Metrics pane's loading line
    // ("orca panel loading…") is no longer in the markup; the default section's own heading is.
    expect(renderToStaticMarkup(<App />)).toMatch(/data-section="overview" data-active="true"><section aria-label="Overview">.*<h2>Overview<\/h2>/);
  });
});
