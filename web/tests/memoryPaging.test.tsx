// @vitest-environment jsdom
/**
 * Tester #258 (spec 2026-11-11-tester-followup-e-design.md §10) and #281 (2): the Memory page says which matches it shows
 * ("1–2 of 5") and pages them -- a page size (10/25/50/100, the server's 50 first), Previous / Next and "Page X of Y".
 * Each page REPLACES the list: page 2 holds only page 2's records, and page 1 is one click back, without a reload. A
 * search pages the same way, with its query. A newer list or search wins over a page still on its way.
 *
 * Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据」 -- #281 replaces #258's "Load more" (append) with
 * page-by-page reading, so this file's criteria are rewritten whole for it.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { MemoryView } from "../src/MemoryView.js";
import type { MemoryRecord } from "../src/memoryTypes.js";
import { pickOption } from "./selectControl.js";

const rec = (ref: string): MemoryRecord => ({ ref, scope: "global", projectKey: null, kind: "rule", content: `memory ${ref}`, tags: [], pinned: false, source: "user_explicit", trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" });
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const STATUS = { adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] };
let requests: string[];
let all: MemoryRecord[];
let hold: Record<string, Promise<void>>;

beforeEach(() => {
  requests = []; all = Array.from({ length: 30 }, (_, n) => rec(String(n + 1))); hold = {};
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/memory/status") return json(STATUS);
    const params = new URL(url, "http://x").searchParams;
    const query = params.get("q") ?? "";
    const offset = Number(params.get("offset") ?? "0");
    const limit = Number(params.get("limit") ?? "50");
    const held = hold[`${query}@${offset}`];
    if (held) await held;
    const hits = all.filter((r) => r.content.includes(query));
    const records = hits.slice(offset, offset + limit);
    return json({ projectKey: "mem", query, page: { records, total: hits.length, truncated: hits.length > records.length, offset, hasMore: offset + records.length < hits.length } });
  }) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const rows = () => within(screen.getByRole("navigation", { name: i18n.t("memory.list") })).queryAllByTestId("memory-excerpt").map((el) => el.textContent);
const names = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, n) => `memory ${from + n}`);
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

it("reads the server's default page first; a page size of 10 pages by 10, each page replacing the last, and back", async () => {
  render(<MemoryView active />);
  // The first page keeps the server's default size: the request is unchanged and all 30 fit.
  await waitFor(() => expect(rows()).toEqual(names(1, 30)));
  expect(requests).toEqual(["/api/memory/status", "/api/memory/list?projectKey=mem"]);
  expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  expect(button("Next").disabled).toBe(true);
  await pickOption(screen.getByRole("combobox", { name: "Per page" }), "10");
  // mutation: drop `limit` from the request -> the server answers 30, red here
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/list?projectKey=mem&limit=10"));
  await waitFor(() => expect(rows()).toEqual(names(1, 10)));
  expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  // mutation: Previous enabled on the first page -> red here
  expect(button("Previous").disabled).toBe(true);
  fireEvent.click(button("Next"));
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/list?projectKey=mem&offset=10&limit=10"));
  // mutation: append the page instead of replacing the list -> memory 1-20, red here
  await waitFor(() => expect(rows()).toEqual(names(11, 20)));
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  expect(screen.getByText("11–20 of 30")).toBeTruthy();
  fireEvent.click(button("Next"));
  await waitFor(() => expect(rows()).toEqual(names(21, 30)));
  // mutation: Next enabled regardless of hasMore -> red here
  expect(button("Next").disabled).toBe(true);
  // Back to page 1 without a reload.
  fireEvent.click(button("Previous"));
  await waitFor(() => expect(rows()).toEqual(names(11, 20)));
  fireEvent.click(button("Previous"));
  await waitFor(() => expect(rows()).toEqual(names(1, 10)));
  expect(requests.filter((url) => url === "/api/memory/status")).toHaveLength(1);
});

it("pages a search with its query", async () => {
  all = all.concat([{ ...rec("other"), content: "unrelated" }]);
  render(<MemoryView active />);
  await waitFor(() => expect(rows()).toHaveLength(31));
  await pickOption(screen.getByRole("combobox", { name: "Per page" }), "25");
  await waitFor(() => expect(rows()).toHaveLength(25));
  const box = screen.getByRole("searchbox", { name: "Search memory" });
  fireEvent.change(box, { target: { value: "memory" } });
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/search?projectKey=mem&q=memory&limit=25"));
  await screen.findByText("Page 1 of 2");
  fireEvent.click(button("Next"));
  // mutation: Next always reads the plain list -> red here
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/search?projectKey=mem&q=memory&offset=25&limit=25"));
  await waitFor(() => expect(rows()).toEqual(names(26, 30)));
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
});

it("drops a page that answers after a newer search", async () => {
  let release!: () => void;
  hold = { "@10": new Promise<void>((r) => { release = r; }) };
  render(<MemoryView active />);
  await waitFor(() => expect(rows()).toHaveLength(30));
  await pickOption(screen.getByRole("combobox", { name: "Per page" }), "10");
  await waitFor(() => expect(rows()).toEqual(names(1, 10)));
  fireEvent.click(button("Next"));
  await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/list?projectKey=mem&offset=10&limit=10"));
  const box = screen.getByRole("searchbox", { name: "Search memory" });
  fireEvent.change(box, { target: { value: "memory 5" } });
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(rows()).toEqual(["memory 5"]));
  release();
  await new Promise((r) => setTimeout(r, 30));
  // mutation: show a page without checking it is still the newest request -> rows 11-20 replace it, red here
  expect(rows()).toEqual(["memory 5"]);
});

it("speaks Chinese", async () => {
  await i18n.changeLanguage("zh");
  render(<MemoryView active />);
  expect(await screen.findByText("第 1 / 1 页")).toBeTruthy();
  expect(screen.getByRole("button", { name: "下一页" })).toBeTruthy();
});
