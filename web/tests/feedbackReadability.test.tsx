// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import i18n from "../src/i18n.js";
import { amount, config, run, view } from "./fixtures/board.js";
afterEach(cleanup);
describe("feedback run readability", () => {
  it.each(["en", "zh"])("shows compact token units with exact values available in %s", async (language) => {
    await i18n.changeLanguage(language);
    const r = run({ used: amount(1234567), remaining: amount(45678) });
    render(<ControlGroupView view={view([], [r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText("1.2M").getAttribute("title")).toBe("1,234,567");
    expect(screen.getByText("45.7K").getAttribute("title")).toBe("45,678");
  });
  it("keeps identifiers available inside collapsed diagnostics and preserves evidence access", () => {
    const r = run({ taskId: null, runId: "uuid-unfriendly", evidenceIds: ["evidence-unfriendly"] });
    const { container } = render(<ControlGroupView view={view([], [r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    for (const id of [r.runId, r.profile.profileHash, "evidence-unfriendly"]) {
      const text = screen.getByText(id); const detail = text.closest("details");
      expect(detail).not.toBeNull(); expect(detail!.open).toBe(false);
    }
    expect(screen.getByRole("button", { name: /^Evidence$/i })).toBeTruthy();
    const rows = container.querySelectorAll("tbody tr"); expect(rows.length).toBeGreaterThan(0);
  });
});
