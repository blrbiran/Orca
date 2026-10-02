// @vitest-environment jsdom
/**
 * Memory tab spec §5.2, plan D8. Every request starts ccmem twice, so the view asks for nothing until it is opened,
 * reads the list once, searches only when the person submits, and never offers a write. Memory content is shown as
 * text, cut at 200 code points in the list, whole in the detail.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { MemoryView } from "../src/MemoryView.js";
import type { MemoryRecord } from "../src/memoryTypes.js";

const rec = (ref: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ref, scope: "global", projectKey: null, kind: "rule", content: `memory ${ref}`, tags: [], pinned: false, source: "user_explicit",
  trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ...over,
});
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK_STATUS = { adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] };
let requests: string[];
let status: unknown;
let records: MemoryRecord[];
let truncated: { total: number } | null;

beforeEach(() => {
  requests = []; status = OK_STATUS; records = [rec("1"), rec("2", { scope: "project", projectKey: "example.invalid/o/r" })]; truncated = null;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/memory/status") return json(status);
    if (url.startsWith("/api/memory/list") || url.startsWith("/api/memory/search")) {
      const query = new URL(url, "http://x").searchParams.get("q") ?? "";
      return json({ projectKey: "mem", query, page: { records, total: truncated?.total ?? records.length, truncated: truncated !== null } });
    }
    if (url.startsWith("/api/memory/item")) {
      const ref = new URL(url, "http://x").searchParams.get("ref");
      const found = records.find((r) => r.ref === ref);
      return found ? json({ record: found }) : json({ code: "memory-not-found", message: `memory ${ref} is not visible` }, 404);
    }
    return json({ code: "unexpected", message: url }, 500);
  }) as typeof fetch;
});
afterEach(() => cleanup());

describe("MemoryView (spec §5.2, W1)", () => {
  it("asks for nothing while the section has never been opened", async () => {
    const { rerender } = render(<MemoryView active={false} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toEqual([]);
    expect(screen.getByText("Memory is read when this section is opened.")).toBeTruthy();
    rerender(<MemoryView active />);
    await waitFor(() => expect(requests).toEqual(["/api/memory/status", "/api/memory/list?projectKey=mem"]));
    rerender(<MemoryView active={false} />);
    rerender(<MemoryView active />);
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toHaveLength(2); // opened again: nothing re-read
  });

  it("shows the refusal and the hint, and lists nothing, when ccmem is not configured", async () => {
    status = { ...OK_STATUS, health: { status: "unavailable", code: "ccmem-missing", message: "ORCA_CCMEM_BIN is not set" } };
    render(<MemoryView active />);
    expect(await screen.findByTestId("refusal-code")).toHaveProperty("textContent", "ccmem-missing");
    expect(screen.getByText(/Set ORCA_CCMEM_BIN/)).toBeTruthy();
    expect(requests).toEqual(["/api/memory/status"]);
  });

  it("searches only when the person submits", async () => {
    render(<MemoryView active />);
    await screen.findByRole("navigation", { name: "Memory list" });
    const box = screen.getByRole("searchbox", { name: "Search memory" });
    fireEvent.change(box, { target: { value: "pnpm" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(requests.filter((u) => u.includes("search"))).toEqual([]);
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/search?projectKey=mem&q=pnpm"));
  });

  it("says how much was cut, and that a remote-less repository may show no project memory", async () => {
    records = [rec("1")]; truncated = { total: 7 };
    render(<MemoryView active />);
    expect(await screen.findByText("Showing 1 of 7; narrow the search.")).toBeTruthy();
    expect(screen.getByText(/No project memory/)).toBeTruthy();
  });

  it("opens one memory in full, markup as text, and cuts the list at 200 code points (Review Focus 4)", async () => {
    const long = `<b>x</b>${"\u{1F600}".repeat(250)}`;
    records = [rec("5", { content: long, tags: ["a", "b"], pinned: true })];
    render(<MemoryView active />);
    const list = within(await screen.findByRole("navigation", { name: "Memory list" }));
    const row = list.getByRole("button");
    const shown = row.querySelector("[data-testid='memory-excerpt']")!.textContent!;
    expect([...shown].length).toBe(201); // 200 code points and the ellipsis
    expect(shown.startsWith("<b>x</b>")).toBe(true);
    expect(shown).not.toMatch(/[\uD800-\uDBFF]…$/); // no lone high surrogate before the ellipsis
    fireEvent.click(row);
    await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/item?projectKey=mem&ref=5"));
    expect((await screen.findByTestId("memory-content")).textContent).toBe(long);
    expect(document.querySelector("b")).toBeNull(); // markup never became an element
  });

  it("shows a refused detail by its code", async () => {
    render(<MemoryView active />);
    const list = within(await screen.findByRole("navigation", { name: "Memory list" }));
    records = [];
    fireEvent.click(list.getAllByRole("button")[0]!);
    expect(await screen.findByTestId("refusal-code")).toHaveProperty("textContent", "memory-not-found");
  });

  it("offers no write: its only buttons are search and the rows (G9)", async () => {
    render(<MemoryView active />);
    await screen.findByRole("navigation", { name: "Memory list" });
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toBe("Search");
    expect(names.slice(1).every((n) => n.includes("memory "))).toBe(true);
    expect(names).toHaveLength(1 + records.length);
  });

  it("speaks Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<MemoryView active />);
    expect(await screen.findByRole("navigation", { name: "记忆列表" })).toBeTruthy();
    expect(screen.getByText("全局")).toBeTruthy();
  });
});
