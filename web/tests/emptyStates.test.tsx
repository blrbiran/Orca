// @vitest-environment jsdom
/**
 * Tester #87: an empty list or Board said only that it was empty. Both now say where to go next: the Requirements page,
 * which is where a group comes from.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import { GroupList } from "../src/GroupList.js";
import { view } from "./fixtures/board.js";

afterEach(cleanup);
const scope = { kind: "all" } as const;
const REQUIREMENTS = "#requirements";
const board = (groups: ReturnType<typeof view>["summary"][]) => render(<BoardView groups={groups} scope={scope} onOpen={vi.fn()} onCommand={vi.fn()} />);

describe("empty states say what to do next (tester #87)", () => {
  // mutation: the link is dropped from the group list -> "No control groups yet." and nowhere to go -> red
  it("links from an empty group list to Requirements", () => {
    render(<GroupList groups={[]} selected={null} scope={scope} onSelect={vi.fn()} />);
    expect(screen.getByText(/No control groups yet\./).textContent).toContain("Start one from a requirement");
    expect(screen.getByRole("link", { name: "Start one from a requirement" }).getAttribute("href")).toBe(REQUIREMENTS);
  });

  // mutation: the empty line is rendered unconditionally -> it nags a Board that has work on it -> red
  it("links from an empty Board to Requirements, once, with its columns quiet", () => {
    board([]);
    expect(screen.getAllByRole("link", { name: "Start one from a requirement" }).map((link) => link.getAttribute("href"))).toEqual([REQUIREMENTS]);
    expect(within(screen.getByRole("region", { name: "Running" })).queryByRole("link")).toBeNull();
    cleanup();
    board([view([]).summary]);
    expect(screen.queryByTestId("board-empty")).toBeNull();
    cleanup();
    // A Board holding only a flow run is not empty either.
    render(<BoardView groups={[]} flows={[{ flowRunId: "f", state: "running", projectId: null, templateRef: "builtin/t@1", dir: null } as never]} scope={scope} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("board-empty")).toBeNull();
  });
});
