// @vitest-environment jsdom
/**
 * Final review T2: each notice site's colour comes from its data-tone, and nothing pinned it per component.
 * Rendered where cheap (RefusalNotice, Overview); read from source where the component needs the whole control
 * plane or a larger harness (ControlPanel, App, MemoryView, UsageSettlement) -- the same trade web/tests/template.test.ts makes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefusalNotice } from "../src/RefusalNotice.js";
import type { ControlRefusal } from "../src/controlState.js";
import { Overview } from "../src/Overview.js";
import type { OverviewModel } from "../src/overviewModel.js";

const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const refusal: ControlRefusal = { status: 409, code: "x", message: "m", commandRevision: null };
const emptyOverview: OverviewModel = {
  progress: [],
  queue: [],
  issues: [{ groupId: "g", repoId: null, reason: "r" }],
  sources: [],
  scopeUnavailable: false,
  complete: true,
};

describe("notice tones per site (final review T2)", () => {
  it("a refusal is danger", () => {
    expect(renderToStaticMarkup(<RefusalNotice refusal={refusal} testId="refusal" />)).toContain('role="alert" data-tone="danger"');
  });
  it("an Overview issue is warn", () => {
    const html = renderToStaticMarkup(<Overview model={emptyOverview} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
    expect(html).toContain('role="alert" data-tone="warn"');
  });
  it("ControlPanel: no port is a warn note; reset and recovery-blocked are danger; refetch is info", () => {
    const s = src("../src/ControlPanel.tsx");
    expect(s).toContain('<p role="note" data-tone="warn">{t("control.noPort")}');
    expect(s).toContain('<p role="alert" data-tone="danger">{t("control.resetRequired")}');
    expect(s).toContain('<p role="alert" data-tone="info">{t("control.refetchRequired")}');
    expect(s).toContain('<p role="alert" data-tone="danger">{t("control.dispatchBlockedRecovery")}');
  });
  it("App: a recorded review is ok; a running chain banner is info", () => {
    const s = src("../src/App.tsx");
    expect(s).toMatch(/role="status" data-tone="ok">\{t\(inline\.status\.text\)\}/);
    expect(s).toMatch(/role="status" data-tone="info" className="chain-banner"/);
  });
  it("MemoryView: a missing ccmem is a warn note (spec §6 M-d)", () => {
    expect(src("../src/MemoryView.tsx")).toContain('<p role="note" data-tone="warn">{t("memory.configureHint")}');
  });
  it("UsageSettlement: a refusal reason is warn", () => {
    expect(src("../src/UsageSettlement.tsx")).toContain('<p role="status" data-tone="warn">{refusalText(');
  });
});
