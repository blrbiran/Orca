import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NAV_BANDS, SECTIONS, hashFor, sectionFromHash } from "../src/sections.js";
import { SectionPane, Shell, controlAlert } from "../src/Shell.js";
import type { ControlAlertInput } from "../src/Shell.js";

/** Panel UI redesign spec §5.1 (ruling U2): a sidebar of sections, one visible at a time, none unmounted. */
describe("sections (ruling U2)", () => {
  // Rewritten under the human's 2026-10-03 request to reorder the tabs (session 9d95e6c8): the default is the first section.
  it("round-trips every section through its hash and sends an empty or unknown hash to overview", () => {
    for (const s of SECTIONS) expect(sectionFromHash(hashFor(s))).toBe(s);
    expect(sectionFromHash("")).toBe("overview");
    expect(sectionFromHash("#")).toBe("overview");
    expect(sectionFromHash("#nope")).toBe("overview");
    // Review Focus 5: a link is a bare hash, so the page URL's path and query survive a click.
    for (const s of SECTIONS) expect(hashFor(s)).toMatch(/^#[a-z-]+$/);
  });
});

const quiet: ControlAlertInput = {
  // REWRITTEN (human authorisation, session 1f3cceb2): executionPort is no longer an alert input.
  // REWRITTEN (human authorisation, session fb98aa31): refetchRequired is no longer an alert input.
  resetRequired: false, dispatchBlocked: false, blockers: 0, refusal: false,
};

// REWRITTEN (human authorisation, session 1f3cceb2): five alert conditions now, not six.
// REWRITTEN (human authorisation, session fb98aa31): four, not five.
describe("controlAlert (the four alert conditions that light the red nav dot)", () => {
  it("is false when nothing is wrong and when the control plane is not mounted", () => {
    expect(controlAlert(quiet)).toBe(false);
    expect(controlAlert(null)).toBe(false);
  });

  it("is true for each condition on its own", () => {
    // REWRITTEN (human authorisation, session 1f3cceb2): "no execution port" is an amber role="note"
    // (taste refinement P1-1), not an alert, so it must not light the red nav dot.
    expect(controlAlert({ ...quiet, executionPort: "unconfigured" } as ControlAlertInput)).toBe(false);
    expect(controlAlert({ ...quiet, resetRequired: true })).toBe(true);
    // REWRITTEN (human authorisation, session fb98aa31): "projection refetch required" is an info-toned,
    // self-clearing re-read, not an alert, so it must not light the red nav dot either.
    expect(controlAlert({ ...quiet, refetchRequired: true } as ControlAlertInput)).toBe(false);
    expect(controlAlert({ ...quiet, dispatchBlocked: true })).toBe(true);
    expect(controlAlert({ ...quiet, blockers: 1 })).toBe(true);
    expect(controlAlert({ ...quiet, refusal: true })).toBe(true);
  });
});

describe("Shell and SectionPane", () => {
  const render = (badges: { unreviewed: number; chainRunning: boolean; controlAlert: boolean }): string =>
    renderToStaticMarkup(
      <Shell active="chains" badges={badges} footer={["epoch e-1 · dispatch live"]}>
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
    // Rewritten under the session grant (human, session 9ec98639: 「这次批准改写所有必要的判据」): kanban spec §4 adds the board tab after Task control.
    // Rewritten for ruling H6 (one Settings section replaces global and project settings). Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
    expect(SECTIONS).toEqual(["overview", "requirements", "tasks", "board", "decisions", "memory", "metrics", "chains", "settings"]);
    const html = renderToStaticMarkup(
      <Shell active="tasks" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]}>
        <SectionPane section="requirements" active="tasks"><p>pane-r</p></SectionPane>
      </Shell>,
    );
    expect(html).toMatch(/href="#requirements"[^>]*><span>Requirements<\/span>/);
    expect(html).toContain('data-section="requirements" data-active="false"');
    expect(html).toContain("pane-r");
  });
});

// Ruling H6(a) (2026-10-27, session 7753e97d; tester issues #42, #43): the sidebar reads as the work, the tools that read
// across it, and Settings alone at the bottom -- so a person finds the daily pages first and the settings in one place.
describe("the sidebar's three bands (H6a)", () => {
  it("bands every section once, in SECTIONS order, with Settings alone last", () => {
    expect(NAV_BANDS).toEqual([["overview", "requirements", "tasks", "board", "decisions"], ["memory", "metrics", "chains"], ["settings"]]);
    expect(NAV_BANDS.flat()).toEqual([...SECTIONS]);
  });

  it("draws a rule above the first item of each later band and puts Settings last", () => {
    const html = renderToStaticMarkup(
      <Shell active="settings" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]} showAdvanced><p /></Shell>,
    );
    const items = [...html.matchAll(/<li data-band="(\d)"( class="nav-band-start")?><a class="nav-item" href="#([a-z-]+)"/g)].map((m) => [m[3], m[1], m[2] !== undefined]);
    // mutation: render SECTIONS in one flat run (no data-band / band-start) -> no item matches, red
    expect(items).toEqual([
      ["overview", "0", false], ["requirements", "0", false], ["tasks", "0", false], ["board", "0", false], ["decisions", "0", false],
      ["memory", "1", true], ["metrics", "1", false], ["chains", "1", false], ["settings", "2", true],
    ]);
    expect(html).toMatch(/href="#settings"[^>]*aria-current="page"><span>Settings<\/span>/);
  });
});
