// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import i18n from "../src/i18n.js";
import { config, view } from "./fixtures/board.js";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

it("opens a failed criteria review from its parent group and shows the reason (#179)", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const parent = view([]);
  parent.summary.criteriaReviews = [{ taskId: "t-doc", debugGroupId: "judge-7", state: "failed", reason: "check did not run" }];
  const onSelectGroup = vi.fn();
  render(<ControlGroupView view={parent} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={onSelectGroup} />);
  expect(screen.getByText(/check did not run/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Open criteria review judge-7/i }));
  expect(onSelectGroup).toHaveBeenCalledExactlyOnceWith("judge-7");
});

it("shows an ongoing review without inventing a failure and no review entry when absent", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const parent = view([]);
  parent.summary.criteriaReviews = [{ taskId: "t-doc", debugGroupId: "judge-8", state: "debugging", reason: null }];
  const mounted = render(<ControlGroupView view={parent} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Open criteria review judge-8/i })).toBeTruthy();
  expect(screen.queryByText(/check did not run/)).toBeNull();
  mounted.rerender(<ControlGroupView view={{ ...parent, summary: { ...parent.summary, criteriaReviews: [] } }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Open criteria review/i })).toBeNull();
});
