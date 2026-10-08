// @vitest-environment jsdom
/**
 * Integration/panel-fixes spec §9.2 item 2. The Memory tab shows the opened memory beside its list, using the
 * shared .split / .split-list / .split-detail layout (the Decisions tab's), and selecting a memory scrolls the
 * detail into view (narrow layouts stack, so the detail would otherwise sit below a long list). jsdom cannot
 * measure layout, so the criteria are the structure and the scrollIntoView call.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { MemoryView } from "../src/MemoryView.js";

const rec = (ref: string) => ({
  ref, scope: "global", projectKey: null, kind: "rule", content: `memory ${ref}`, tags: [], pinned: false, source: "user_explicit",
  trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
});
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const scroll = vi.fn();

beforeEach(() => {
  scroll.mockReset();
  Element.prototype.scrollIntoView = scroll;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/memory/status") return json({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] });
    if (url.startsWith("/api/memory/list")) return json({ projectKey: "mem", query: "", page: { records: [rec("1"), rec("2")], total: 2, truncated: false } });
    if (url.startsWith("/api/memory/item")) return json({ record: rec(new URL(url, "http://x").searchParams.get("ref") ?? "") });
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
});
afterEach(() => cleanup());

describe("Memory split layout (spec §9.2 item 2)", () => {
  it("puts the list in .split-list and the opened detail in .split-detail, side by side in one .split", async () => {
    const { container } = render(<MemoryView active />);
    await waitFor(() => expect(container.querySelectorAll(".memory-row")).toHaveLength(2));
    const split = container.querySelector(".split");
    expect(split).not.toBeNull();
    expect(split!.querySelector(":scope > .split-list .memory-list")).not.toBeNull();
    fireEvent.click(container.querySelectorAll(".memory-row")[1]!);
    await waitFor(() => expect(screen.getByTestId("memory-content").textContent).toBe("memory 2"));
    expect(split!.querySelector(":scope > .split-detail .memory-detail")).not.toBeNull();
    expect(split!.querySelector(":scope > .split-list .memory-detail")).toBeNull();
  });

  it("scrolls the detail into view when a memory is selected, and not before", async () => {
    const { container } = render(<MemoryView active />);
    await waitFor(() => expect(container.querySelectorAll(".memory-row")).toHaveLength(2));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(container.querySelectorAll(".memory-row")[0]!);
    await waitFor(() => expect(screen.getByTestId("memory-content")).toBeTruthy());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as Element).closest(".split-detail")).not.toBeNull();
  });
});
