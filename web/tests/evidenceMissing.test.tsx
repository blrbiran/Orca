// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceList, TaskDetail } from "../src/TaskDetail.js";
import { run, view, workItem } from "./fixtures/board.js";

/**
 * Tester #469, the Web half: a run whose settlement or closure evidence is gone from disk is named on its row in a
 * warn-toned line, and an evidence entry whose bytes are gone reads "missing on disk" with nothing to download. Named
 * mutations (each seen red, Rule 9) are written beside the assertion they turn red.
 */
const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("evidence gone from disk (#469)", () => {
  it("the run's row names the missing ids, warn-toned", () => {
    const item = workItem({ status: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] });
    const gone = run({ state: "settled-failed", outcome: "failed", closure: "evidence-missing", evidenceMissing: ["report-run-a-1"] });
    render(<TaskDetail view={view([item], [gone])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the evidenceMissing line from TaskDetail -> red
    const line = screen.getByTestId("run-evidence-missing");
    expect(line.getAttribute("data-tone")).toBe("warn");
    expect(line.textContent).toContain("report-run-a-1");
    expect(line.textContent).toContain("archive the group");
  });

  it("a missing manifest entry is said as missing and offers no download; a present one keeps its download", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ schema: "orca-run-evidence-v1", runId: "run-a", entries: [
      { evidenceId: "gone-1", kind: "snapshot", sha256: "a".repeat(64), byteLength: null, missing: true, downloadUrl: "/api/control/runs/run-a/evidence/gone-1" },
      { evidenceId: "kept-1", kind: "usage", sha256: "b".repeat(64), byteLength: 12, downloadUrl: "/api/control/runs/run-a/evidence/kept-1" },
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    render(<EvidenceList runId="run-a" />);
    fireEvent.click(screen.getByRole("button", { name: "List evidence of run-a" }));
    const list = await screen.findByRole("list", { name: "Evidence of run-a" });
    // mutation: render a missing entry as a present one -> "null bytes" and a download button, red
    expect(within(list).getByText(/gone-1 · snapshot · missing on disk/)).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /gone-1/ })).toBeNull();
    expect(within(list).getByRole("button", { name: /kept-1/ })).toBeTruthy();
  });
});
