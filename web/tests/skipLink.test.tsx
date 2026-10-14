// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "../src/Shell.js";

describe("skip link (audit C P2)", () => {
  it("is the first focusable control and moves focus to the content without touching the section hash", () => {
    window.location.hash = "#decisions";
    render(<Shell active="decisions" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]}><p>pane</p></Shell>);
    const skip = screen.getByRole("button", { name: "Skip to content" });
    expect(document.querySelector("button, a, select, input")).toBe(skip);
    fireEvent.click(skip);
    expect(document.activeElement?.id).toBe("main-content");
    expect(window.location.hash).toBe("#decisions");
  });
});
