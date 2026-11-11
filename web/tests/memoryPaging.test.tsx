// @vitest-environment jsdom
/**
 * Tester #258 (spec 2026-11-11-tester-followup-e-design.md §10; memory tab spec, 2026-11-11 addition): the Memory page
 * says which matches it shows ("1–2 of 5") and offers "Load more" while the server says more follow; each further page
 * is read from where the list ends, for the same list or search, and appended. A newer list or search wins over a page
 * still on its way.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { MemoryView } from "../src/MemoryView.js";
import type { MemoryRecord } from "../src/memoryTypes.js";

const PAGE = 2;
const rec = (ref: string): MemoryRecord => ({ ref, scope: "global", projectKey: null, kind: "rule", content: `memory ${ref}`, tags: [], pinned: false, source: "user_explicit", trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" });
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const STATUS = { adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] };
let requests: string[];
let all: MemoryRecord[];
let hold: Record<string, Promise<void>>;

beforeEach(() => {
  requests = []; all = ["1", "2", "3", "4", "5"].map(rec); hold = {};
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/memory/status") return json(STATUS);
    const params = new URL(url, "http://x").searchParams;
    const query = params.get("q") ?? "";
    const offset = Number(params.get("offset") ?? "0");
    const held = hold[`${query}@${offset}`];
    if (held) await held;
    const hits = all.filter((r) => r.content.includes(query));
    const records = hits.slice(offset, offset + PAGE);
    return json({ projectKey: "mem", query, page: { records, total: hits.length, truncated: hits.length > records.length, offset, hasMore: offset + records.length < hits.length } });
  }) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const rows = () => within(screen.getByRole("navigation", { name: i18n.t("memory.list") })).queryAllByTestId("memory-excerpt").map((el) => el.textContent);

it("loads further pages from where the list ends and says which matches it shows", async () => {
  render(<MemoryView active />);
  // mutation: drop the range line -> red here
  expect(await screen.findByText("1–2 of 5")).toBeTruthy();
  expect(requests).toEqual(["/api/memory/status", "/api/memory/list?projectKey=mem"]);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  // mutation: ask for offset 0 again (or omit it) -> the request differs, red here
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/list?projectKey=mem&offset=2"));
  // mutation: replace the list with the new page instead of appending -> red here
  await waitFor(() => expect(rows()).toEqual(["memory 1", "memory 2", "memory 3", "memory 4"]));
  // mutation: count the range from the last page only -> "3–4 of 5", red here
  expect(screen.getByText("1–4 of 5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rows()).toEqual(["memory 1", "memory 2", "memory 3", "memory 4", "memory 5"]));
  // mutation: offer Load more regardless of hasMore -> red here
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(screen.queryByText(/ of 5$/)).toBeNull();
});

it("pages a search with the same query", async () => {
  all = ["1", "2", "3", "4", "5"].map(rec).concat([{ ...rec("6"), content: "other" }]);
  render(<MemoryView active />);
  await screen.findByText("1–2 of 6");
  const box = screen.getByRole("searchbox", { name: "Search memory" });
  fireEvent.change(box, { target: { value: "memory" } });
  fireEvent.submit(box.closest("form")!);
  await screen.findByText("1–2 of 5");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  // mutation: Load more always reads the plain list -> red here
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/search?projectKey=mem&q=memory&offset=2"));
  expect(await screen.findByText("1–4 of 5")).toBeTruthy();
});

it("drops a further page that answers after a newer search", async () => {
  let release!: () => void;
  hold = { "@2": new Promise<void>((r) => { release = r; }) };
  render(<MemoryView active />);
  await screen.findByText("1–2 of 5");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/list?projectKey=mem&offset=2"));
  const box = screen.getByRole("searchbox", { name: "Search memory" });
  fireEvent.change(box, { target: { value: "memory 5" } });
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(rows()).toEqual(["memory 5"]));
  release();
  await new Promise((r) => setTimeout(r, 30));
  // mutation: append a further page without checking it is still the newest request -> rows 3 and 4 join, red here
  expect(rows()).toEqual(["memory 5"]);
});

it("speaks Chinese", async () => {
  await i18n.changeLanguage("zh");
  render(<MemoryView active />);
  expect(await screen.findByText("第 1–2 条，共 5 条")).toBeTruthy();
  expect(screen.getByRole("button", { name: "加载更多" })).toBeTruthy();
});
