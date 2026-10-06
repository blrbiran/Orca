// @vitest-environment jsdom
/**
 * Project filtering spec §11 R3 (plan Task 9): an Agree or Correct POST is a request record -- owner, verb, an
 * independent copy of its payload, a browser correlation id -- and its answer updates only that record. The detail's
 * inline outcome shows only the selected owner's ACTIVE request; every other owner's pending/results appear in a global,
 * notice (every other record, owner-labelled) that outlives sections and scope changes. "Record another" re-sends the exact refused request's
 * payload with again:true, never whatever form is on screen. Also the R2 carry-over: a correction's success clears its
 * draft only when unchanged since it was submitted; a failure keeps it. Fake fetch only (Rule 17); every POST is held
 * until the test answers it.
 *
 * Mutations (spec §11 R3) and the criteria measured red (task-9-report.md): unconditional inline outcome on POST
 * return -> 1; guard owner but not request identity -> 3 and pure startRequest/settleRequest/inlineRequest; retry reads
 * the current form -> 2; remove the old-owner notice -> 1-5; discard records on scope change -> 1-5; clear the
 * correction draft unconditionally on success -> 6; an Agree refusal keeps its retry field inline -> 5.
 * Fix round 1: notice excludes the whole open owner -> 8; evict a pending record -> pure "never a pending one";
 * Dismiss on a pending line -> 4; dismissed record shown inline again -> 4; Record another without retry_field
 * "again" -> 9.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { RecordCorrectionInput } from "../src/api.js";
import { rowKey } from "../src/DecisionList.js";
import {
  EMPTY_REQUESTS, MAX_RECORDS, dismissRequest, inlineRequest, noticeRequests, retryPayload, settleRequest, startRequest,
} from "../src/decisionRequests.js";
import type { DecisionRequests } from "../src/decisionRequests.js";
import { decisionRow, installFakePanel } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

interface Held { url: string; body: unknown; resolve: (answer: Response) => void; reject: (err: Error) => void }
let panel: FakePanel;
let held: Held[];
beforeEach(() => {
  panel = installFakePanel();
  held = [];
  panel.onPost = (url, body) => new Promise<Response>((resolve, reject) => { held.push({ url, body, resolve, reject }); });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); window.location.hash = ""; });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const recorded = (): Response => json({ recorded: true });
const exists = (): Response => json({ code: "correction-exists", message: "a correction of this decision exists", retry_field: "again" }, 409);

/** alpha/d1 and beta/d1 share their id, so anything keyed by id alone shows one under the other. */
function seed(): void {
  panel.todo = [decisionRow("alpha", "d1"), decisionRow("beta", "d1")];
  for (const row of panel.todo) {
    panel.decisions[rowKey(row)] = { id: row.id, question: `question of ${row.projectKey}/${row.id}`, chose: "c", because: "b", alternatives: [] };
  }
}

const projectSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
const ready = async (): Promise<void> => { await screen.findByRole("combobox", { name: "Project" }); };
const switchTo = async (projectKey: string, name: string): Promise<void> => {
  fireEvent.change(projectSelect(), { target: { value: projectKey } });
  await waitFor(() => expect(projectSelect().selectedOptions[0]?.textContent).toBe(name));
  await waitFor(() => expect(screen.queryByTestId("decision-question")).toBeNull());
};
const openDecision = async (projectKey: string): Promise<HTMLElement> => {
  const button = (await screen.findAllByRole("button")).find((candidate) => candidate.closest(".decision-list") !== null && candidate.textContent?.includes("d1"));
  fireEvent.click(button!);
  await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(`question of ${projectKey}/d1`));
  return document.querySelector(".decision-detail") as HTMLElement;
};
const becauseBox = (): HTMLTextAreaElement => within(document.querySelector(".decision-detail") as HTMLElement).getByRole("textbox", { name: "Because" }) as HTMLTextAreaElement;
const correct = (because: string): void => {
  fireEvent.change(becauseBox(), { target: { value: because } });
  fireEvent.submit(document.querySelector("form.correction-form")!);
};
/** The detail column: the open decision and its inline outcome. */
const slot = (): HTMLElement => document.querySelector(".split-detail") as HTMLElement;
const notice = (): HTMLElement | null => screen.queryByRole("region", { name: "Decision operations" });
const noticeLines = (): string[] => [...(notice()?.querySelectorAll('[data-testid="operation-line"]') ?? [])].map((line) => line.textContent ?? "");
const answer = async (index: number, response: Response): Promise<void> => {
  await act(async () => { held[index]!.resolve(response); });
};

describe("decision requests keep their owner (spec §11 R3)", () => {
  it("1: A's late success or refusal never lands in B's detail; the notice names Alpha / d1", async () => {
    for (const late of [recorded, exists]) {
      seed();
      render(<App />);
      await ready();
      await openDecision("alpha");
      correct("alpha because");
      await waitFor(() => expect(held).toHaveLength(1));
      await switchTo("beta", "Beta");
      await openDecision("beta");
      expect(noticeLines()).toEqual(["Alpha / d1 · Correct: sending…"]);

      await answer(0, late());
      const expected = late === recorded ? "Alpha / d1 · Correct: Correction recorded." : "Alpha / d1 · Correct: refused";
      await waitFor(() => expect(noticeLines()).toEqual([expected]));
      expect(within(slot()).queryByRole("status")).toBeNull();
      expect(within(slot()).queryByRole("alert")).toBeNull();
      expect(within(slot()).queryByTestId("record-another")).toBeNull();
      // B stays open; nothing reopened A.
      expect(screen.getByTestId("decision-question").textContent).toBe("question of beta/d1");
      if (late === exists) {
        expect(within(notice()!).getByText("correction-exists")).toBeTruthy();
        expect(within(notice()!).getByRole("button", { name: "Record another for Alpha / d1" })).toBeTruthy();
      }
      cleanup();
      held = [];
      panel = installFakePanel();
      panel.onPost = (url, body) => new Promise<Response>((resolve, reject) => { held.push({ url, body, resolve, reject }); });
      window.localStorage.clear();
    }
  });

  it("2: Record another for A sends A's exact payload with again:true, not B's form", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("alpha because");
    await waitFor(() => expect(held).toHaveLength(1));
    await switchTo("beta", "Beta");
    await openDecision("beta");
    await answer(0, exists());
    await waitFor(() => expect(noticeLines()).toEqual(["Alpha / d1 · Correct: refused"]));
    // B submits its own correction and it stays pending: B's form still holds B's text.
    correct("beta because");
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[1]!.body).toEqual({ projectKey: "beta", decisionId: "d1", kind: "wrong", because: "beta because" });

    fireEvent.click(within(notice()!).getByRole("button", { name: "Record another for Alpha / d1" }));
    await waitFor(() => expect(held).toHaveLength(3));
    expect(held[2]!.url).toBe("/api/corrections");
    expect(held[2]!.body).toEqual({ projectKey: "alpha", decisionId: "d1", kind: "wrong", because: "alpha because", again: true });
    // The retry is a new request of the same owner: it shows as A's, pending.
    await waitFor(() => expect(noticeLines()).toEqual(["Alpha / d1 · Correct: refused", "Alpha / d1 · Correct: sending…"]));
  });

  it("3: two requests for alpha/d1 answered in reverse order -- the inline outcome stays the latest request's", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("first reason");
    await waitFor(() => expect(held).toHaveLength(1));
    correct("second reason");
    await waitFor(() => expect(held).toHaveLength(2));

    await answer(1, recorded());
    await waitFor(() => expect(within(slot()).queryByRole("status")?.textContent).toBe("Correction recorded."));
    await answer(0, exists());
    // Close A: the notice then shows both of A's records, so the late refusal has certainly been applied.
    await switchTo("beta", "Beta");
    await waitFor(() => expect([...noticeLines()].sort()).toEqual(["Alpha / d1 · Correct: Correction recorded.", "Alpha / d1 · Correct: refused"]));
    await switchTo("alpha", "Alpha");
    await openDecision("alpha");
    expect(within(slot()).queryByRole("status")?.textContent).toBe("Correction recorded.");
    expect(within(slot()).queryByRole("alert")).toBeNull();
  });

  it("4: a scope switch with nothing selected keeps A's pending request, and its result, visible in every section", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("alpha because");
    await waitFor(() => expect(held).toHaveLength(1));
    await switchTo("beta", "Beta");
    expect(screen.queryByTestId("decision-question")).toBeNull();
    expect(noticeLines()).toEqual(["Alpha / d1 · Correct: sending…"]);
    // A pending request cannot be dismissed: its answer must still be seen.
    expect(within(notice()!).queryByRole("button", { name: "Dismiss" })).toBeNull();

    await answer(0, recorded());
    await waitFor(() => expect(noticeLines()).toEqual(["Alpha / d1 · Correct: Correction recorded."]));
    // Outside every section pane, so Metrics (or any section) shows it too.
    await act(async () => { window.location.hash = "#metrics"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(notice()!.closest(".section-pane")).toBeNull();
    expect(noticeLines()).toEqual(["Alpha / d1 · Correct: Correction recorded."]);
    // Dismissed explicitly, it goes.
    fireEvent.click(within(notice()!).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(notice()).toBeNull());
    // ...and stays gone when its owner is opened again: not shown inline either.
    await act(async () => { window.location.hash = "#decisions"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await switchTo("alpha", "Alpha");
    await openDecision("alpha");
    expect(within(slot()).queryByRole("status")).toBeNull();
    expect(within(slot()).queryByRole("alert")).toBeNull();
    expect(notice()).toBeNull();
  });

  it("8: the open owner's older request refused while its newer one is pending shows in the notice", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("first reason");
    await waitFor(() => expect(held).toHaveLength(1));
    correct("second reason");
    await waitFor(() => expect(held).toHaveLength(2));
    await answer(0, exists());
    await waitFor(() => expect(noticeLines()).toEqual(["Alpha / d1 · Correct: refused"]));
    // A is still open and its active request (#2) is pending: nothing inline yet.
    expect(screen.getByTestId("decision-question").textContent).toBe("question of alpha/d1");
    expect(within(slot()).queryByRole("alert")).toBeNull();
    expect(within(slot()).queryByRole("status")).toBeNull();
    expect(notice()!.getAttribute("aria-live")).toBe("polite");
  });

  it("9: a correction refused without retry_field again, or lost in transport, offers no Record another in the notice", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("alpha because");
    await waitFor(() => expect(held).toHaveLength(1));
    await switchTo("beta", "Beta");
    await openDecision("beta");
    correct("beta because");
    await waitFor(() => expect(held).toHaveLength(2));
    await switchTo("alpha", "Alpha");
    await answer(0, json({ code: "decision-not-found", message: "no such decision" }, 404));
    await act(async () => { held[1]!.reject(new Error("network down")); });
    await waitFor(() => expect([...noticeLines()].sort()).toEqual(["Alpha / d1 · Correct: refused", "Beta / d1 · Correct: refused"]));
    expect(within(notice()!).getByText("decision-not-found")).toBeTruthy();
    expect(within(notice()!).getByText("panel-unreachable")).toBeTruthy();
    expect(within(notice()!).queryByRole("button", { name: /^Record another/ })).toBeNull();
  });

  it("5: an Agree refusal never offers Record another, even beside a correction refusal", async () => {
    seed();
    render(<App />);
    await ready();
    await switchTo("beta", "Beta");
    await openDecision("beta");
    correct("beta because");
    await waitFor(() => expect(held).toHaveLength(1));
    await answer(0, exists());
    await waitFor(() => expect(within(slot()).queryByTestId("record-another")).not.toBeNull());

    await switchTo("alpha", "Alpha");
    await openDecision("alpha");
    fireEvent.click(within(slot()).getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[1]!.url).toBe("/api/reviews");
    await answer(1, json({ code: "review-refused", message: "the review was refused", retry_field: "again" }, 409));
    await waitFor(() => expect(within(slot()).queryByRole("alert")).not.toBeNull());
    expect(within(slot()).getByTestId("refusal-code").textContent).toBe("review-refused");
    expect(within(slot()).queryByTestId("record-another")).toBeNull();

    await switchTo("beta", "Beta");
    await waitFor(() => expect([...noticeLines()].sort()).toEqual(["Alpha / d1 · Agree: refused", "Beta / d1 · Correct: refused"]));
    expect(within(notice()!).getByRole("button", { name: "Record another for Beta / d1" })).toBeTruthy();
    expect(within(notice()!).queryByRole("button", { name: "Record another for Alpha / d1" })).toBeNull();
    expect(held).toHaveLength(2);
  });
});

describe("a correction's draft and its request (spec §11 R2 carried into R3)", () => {
  it("6: a late success keeps text typed after the submit; an unchanged draft is cleared by its success", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("first reason");
    await waitFor(() => expect(held).toHaveLength(1));
    fireEvent.change(becauseBox(), { target: { value: "newer reason" } });
    await answer(0, recorded());
    await waitFor(() => expect(within(slot()).queryByRole("status")?.textContent).toBe("Correction recorded."));
    expect(becauseBox().value).toBe("newer reason");

    fireEvent.submit(document.querySelector("form.correction-form")!);
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[1]!.body).toMatchObject({ because: "newer reason" });
    await answer(1, recorded());
    await waitFor(() => expect(becauseBox().value).toBe(""));
  });

  it("7: a refusal or a transport error keeps the submitted draft", async () => {
    seed();
    render(<App />);
    await ready();
    await openDecision("alpha");
    correct("kept reason");
    await waitFor(() => expect(held).toHaveLength(1));
    await answer(0, exists());
    await waitFor(() => expect(within(slot()).queryByRole("alert")).not.toBeNull());
    expect(becauseBox().value).toBe("kept reason");

    fireEvent.submit(document.querySelector("form.correction-form")!);
    await waitFor(() => expect(held).toHaveLength(2));
    await act(async () => { held[1]!.reject(new Error("network down")); });
    await waitFor(() => expect(within(slot()).getByTestId("refusal-code").textContent).toBe("panel-unreachable"));
    expect(within(slot()).queryByTestId("record-another")).toBeNull();
    expect(becauseBox().value).toBe("kept reason");
  });
});

// ---- Pure: decisionRequests.ts ----

const A = { projectKey: "alpha", decisionId: "d1" };
const B = { projectKey: "beta", decisionId: "d1" };
const payloadOf = (owner: typeof A, because: string): RecordCorrectionInput => ({ ...owner, kind: "wrong", because });
const refused = { kind: "refused" as const, refusal: { status: 409, code: "correction-exists", message: "m", retry_field: "again" } };
const done = { kind: "recorded" as const, text: "decisions.correctionRecorded" as const };

describe("decisionRequests (pure)", () => {
  it("startRequest: pending, active for its owner, with its own copy of the payload", () => {
    const input = payloadOf(A, "original");
    const all = startRequest(EMPTY_REQUESTS, { requestId: "r1", owner: A, verb: "correct", payload: input });
    input.because = "edited after the submit";
    expect(all.records).toEqual([{ requestId: "r1", owner: A, verb: "correct", payload: payloadOf(A, "original"), status: { kind: "pending" }, dismissed: false }]);
    expect(inlineRequest(all, { projectKey: "alpha", id: "d1" })?.requestId).toBe("r1");
    expect(inlineRequest(all, { projectKey: "beta", id: "d1" })).toBeNull();
    expect(EMPTY_REQUESTS).toEqual({ records: [], active: {} });
  });

  it("settleRequest touches its own record only; an unknown id changes nothing", () => {
    let all = startRequest(EMPTY_REQUESTS, { requestId: "r1", owner: A, verb: "correct", payload: payloadOf(A, "a") });
    all = startRequest(all, { requestId: "r2", owner: B, verb: "agree", payload: null });
    const settled = settleRequest(all, "r1", refused);
    expect(settled.records[0]!.status).toEqual(refused);
    expect(settled.records[1]).toEqual(all.records[1]);
    expect(all.records[0]!.status).toEqual({ kind: "pending" });
    expect(settleRequest(all, "nope", done)).toEqual(all);
  });

  it("inlineRequest is the owner's ACTIVE request, not its latest settled one", () => {
    let all = startRequest(EMPTY_REQUESTS, { requestId: "r1", owner: A, verb: "correct", payload: payloadOf(A, "1") });
    all = startRequest(all, { requestId: "r2", owner: A, verb: "correct", payload: payloadOf(A, "2") });
    all = settleRequest(settleRequest(all, "r2", done), "r1", refused);
    expect(inlineRequest(all, { projectKey: "alpha", id: "d1" })?.requestId).toBe("r2");
    expect(inlineRequest(all, null)).toBeNull();
  });

  it("noticeRequests: every record but the one shown inline, dismissed ones left out", () => {
    let all = startRequest(EMPTY_REQUESTS, { requestId: "r1", owner: A, verb: "correct", payload: payloadOf(A, "1") });
    all = startRequest(all, { requestId: "r2", owner: B, verb: "agree", payload: null });
    all = startRequest(all, { requestId: "r3", owner: B, verb: "correct", payload: payloadOf(B, "3") });
    expect(noticeRequests(all, { projectKey: "alpha", id: "d1" }).map((r) => r.requestId)).toEqual(["r2", "r3"]);
    expect(noticeRequests(all, null).map((r) => r.requestId)).toEqual(["r1", "r2", "r3"]);
    all = dismissRequest(all, "r2");
    expect(noticeRequests(all, null).map((r) => r.requestId)).toEqual(["r1", "r3"]);
    // The open owner's older request is not inline, so the notice keeps it (fix round 1, I1).
    all = startRequest(all, { requestId: "r4", owner: A, verb: "correct", payload: payloadOf(A, "4") });
    expect(noticeRequests(all, { projectKey: "alpha", id: "d1" }).map((r) => r.requestId)).toEqual(["r1", "r3"]);
  });

  it("retryPayload: this record's payload with again:true; none for an Agree; the record is untouched", () => {
    let all = startRequest(EMPTY_REQUESTS, { requestId: "r1", owner: A, verb: "correct", payload: payloadOf(A, "a") });
    all = startRequest(all, { requestId: "r2", owner: A, verb: "agree", payload: null });
    const retry = retryPayload(all.records[0]!);
    expect(retry).toEqual({ ...payloadOf(A, "a"), again: true });
    retry!.because = "changed by a stale handler";
    expect(all.records[0]!.payload).toEqual(payloadOf(A, "a"));
    expect(retryPayload(all.records[1]!)).toBeNull();
  });

  it(`keeps at most MAX_RECORDS (${MAX_RECORDS}) by dropping the oldest settled record, never a pending one`, () => {
    let all: DecisionRequests = EMPTY_REQUESTS;
    all = startRequest(all, { requestId: "p0", owner: B, verb: "agree", payload: null }); // stays pending
    for (let index = 1; index <= MAX_RECORDS + 4; index += 1) {
      all = startRequest(all, { requestId: `s${index}`, owner: { projectKey: "alpha", decisionId: `d${index}` }, verb: "agree", payload: null });
      all = settleRequest(all, `s${index}`, done);
    }
    expect(all.records).toHaveLength(MAX_RECORDS);
    expect(all.records[0]!.requestId).toBe("p0");
    expect(all.records.map((r) => r.requestId).slice(1)).toEqual(Array.from({ length: MAX_RECORDS - 1 }, (_, i) => `s${i + 6}`));
    // A dropped record is no longer anyone's active request.
    expect(inlineRequest(all, { projectKey: "alpha", id: "d1" })).toBeNull();
    expect(Object.values(all.active)).not.toContain("s1");
  });

  it("evicts dismissed records first, then recorded ones, then refusals", () => {
    let all: DecisionRequests = EMPTY_REQUESTS;
    const add = (id: string, status: typeof done | typeof refused, dismiss = false): void => {
      all = startRequest(all, { requestId: id, owner: { projectKey: "alpha", decisionId: id }, verb: "agree", payload: null });
      all = settleRequest(all, id, status);
      if (dismiss) all = dismissRequest(all, id);
    };
    add("refused-old", refused);
    add("recorded-old", done);
    add("dismissed", refused, true);
    for (let index = 0; index < MAX_RECORDS - 3; index += 1) add(`f${index}`, refused);
    expect(all.records).toHaveLength(MAX_RECORDS);
    add("n1", refused);
    expect(all.records.map((r) => r.requestId)).not.toContain("dismissed");
    expect(all.records.map((r) => r.requestId)).toContain("recorded-old");
    add("n2", refused);
    expect(all.records.map((r) => r.requestId)).not.toContain("recorded-old");
    expect(all.records.map((r) => r.requestId)).toContain("refused-old");
    add("n3", refused);
    expect(all.records.map((r) => r.requestId)).not.toContain("refused-old");
  });

  it("never evicts a pending record: 21 pending, the first one's answer still lands", () => {
    let all: DecisionRequests = EMPTY_REQUESTS;
    for (let index = 0; index <= MAX_RECORDS; index += 1) {
      all = startRequest(all, { requestId: `p${index}`, owner: { projectKey: "alpha", decisionId: `d${index}` }, verb: "agree", payload: null });
    }
    expect(all.records).toHaveLength(MAX_RECORDS + 1);
    all = settleRequest(all, "p0", refused);
    expect(all.records.find((r) => r.requestId === "p0")?.status).toEqual(refused);
    expect(inlineRequest(all, { projectKey: "alpha", id: "d0" })?.status).toEqual(refused);
  });
});
