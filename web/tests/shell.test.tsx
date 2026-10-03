import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTIONS, hashFor, sectionFromHash } from "../src/sections.js";
import { SectionPane, Shell, controlAlert } from "../src/Shell.js";
import type { ControlAlertInput } from "../src/Shell.js";

/** Panel UI redesign spec §5.1 (ruling U2): a sidebar of sections, one visible at a time, none unmounted. */
describe("sections (ruling U2)", () => {
  // Rewritten under the human's 2026-10-03 request to reorder the tabs (session 9d95e6c8): the default is the first section.
  it("round-trips every section through its hash and sends an empty or unknown hash to requirements", () => {
    for (const s of SECTIONS) expect(sectionFromHash(hashFor(s))).toBe(s);
    expect(sectionFromHash("")).toBe("requirements");
    expect(sectionFromHash("#")).toBe("requirements");
    expect(sectionFromHash("#nope")).toBe("requirements");
    // Review Focus 5: a link is a bare hash, so the ?token= query of the page URL survives a click.
    for (const s of SECTIONS) expect(hashFor(s)).toMatch(/^#[a-z]+$/);
  });
});

const quiet: ControlAlertInput = {
  executionPort: "configured", resetRequired: false, refetchRequired: false, dispatchBlocked: false, blockers: 0, refusal: false,
};

describe("controlAlert (spec §5.1, the six alert conditions ControlPanel renders)", () => {
  it("is false when nothing is wrong and when the control plane is not mounted", () => {
    expect(controlAlert(quiet)).toBe(false);
    expect(controlAlert(null)).toBe(false);
  });

  it("is true for each condition on its own", () => {
    expect(controlAlert({ ...quiet, executionPort: "unconfigured" })).toBe(true);
    expect(controlAlert({ ...quiet, resetRequired: true })).toBe(true);
    expect(controlAlert({ ...quiet, refetchRequired: true })).toBe(true);
    expect(controlAlert({ ...quiet, dispatchBlocked: true })).toBe(true);
    expect(controlAlert({ ...quiet, blockers: 1 })).toBe(true);
    expect(controlAlert({ ...quiet, refusal: true })).toBe(true);
  });
});

describe("Shell and SectionPane", () => {
  const render = (badges: { unreviewed: number; chainRunning: boolean; controlAlert: boolean }): string =>
    renderToStaticMarkup(
      <Shell active="chains" badges={badges} footer={["epoch e-1 · dispatch live"]} theme="system">
        <SectionPane section="decisions" active="chains"><p>pane-d</p></SectionPane>
        <SectionPane section="chains" active="chains"><p>pane-c</p></SectionPane>
      </Shell>,
    );

  it("marks only the active pane and nav item, and still renders every pane", () => {
    const html = render({ unreviewed: 118, chainRunning: false, controlAlert: false });
    expect(html).toContain('data-section="decisions" data-active="false"');
    expect(html).toContain('data-section="chains" data-active="true"');
    expect(html).toContain("pane-d");
    expect(html).toContain("pane-c");
    expect(html).toMatch(/href="#chains"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="#decisions"[^>]*aria-current/);
    expect(html).not.toMatch(/\shidden(=|\s|>)/);
    expect(html).toContain("epoch e-1 · dispatch live");
  });

  it("shows the unreviewed count, and the chain and task dots only when they apply", () => {
    const off = render({ unreviewed: 118, chainRunning: false, controlAlert: false });
    expect(off).toMatch(/data-testid="nav-count-decisions"[^>]*>118</);
    expect(off).not.toContain('data-testid="nav-dot-chains"');
    expect(off).not.toContain('data-testid="nav-dot-tasks"');
    const on = render({ unreviewed: 0, chainRunning: true, controlAlert: true });
    expect(on).toContain('data-testid="nav-dot-chains"');
    expect(on).toContain('data-testid="nav-dot-tasks"');
  });
});

// N1 spec §11.2 (Task 13): a fifth section, Requirements, between Task control and Metrics, mounted like the others.
describe("the Requirements section in the shell (N1 spec §11.2)", () => {
  it("lists Requirements in the nav after Task control and keeps its pane mounted while another is active", () => {
    // Rewritten again under the human's 2026-10-03 request to reorder the tabs (session 9d95e6c8); earlier under the OK at memory-tab plan review (plan D10).
    expect(SECTIONS).toEqual(["requirements", "tasks", "decisions", "memory", "metrics", "chains"]);
    const html = renderToStaticMarkup(
      <Shell active="tasks" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]} theme="system">
        <SectionPane section="requirements" active="tasks"><p>pane-r</p></SectionPane>
      </Shell>,
    );
    expect(html).toMatch(/href="#requirements"[^>]*><span>Requirements<\/span>/);
    expect(html).toContain('data-section="requirements" data-active="false"');
    expect(html).toContain("pane-r");
  });
});
