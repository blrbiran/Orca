// @vitest-environment jsdom
/**
 * Parked finding N-1 (E3 final review, ruling R71), fixed in the round after
 * Session 4. `App` is the only component in this package with side effects,
 * and these are the only criteria that drive it: they need `useEffect` to run
 * and a real DOM to hold an uncontrolled form's text, and
 * `renderToStaticMarkup` gives neither (see App.tsx's own header comment).
 * Every other web criterion stays on the `node` environment; this file opts
 * itself into jsdom through the docblock above, so nothing else changes.
 *
 * What N-1 was: the `[selected]` effect cleared the fetched decision only when
 * the selection became null. Switching rows therefore left the PREVIOUS
 * decision on screen while `onAgree` / `onCorrect` already closed over the NEW
 * row, so one fast click recorded against a decision the person was not
 * looking at -- and a correction is append-only, so it cannot be taken back.
 *
 * Each `it` names the production line whose removal reddens it, for this
 * round's mutation brief.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { Decision } from "../src/DecisionDetail.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

const ROW_A: DecisionListRow = {
  projectKey: "project-key-of-row-a",
  id: "run-a/1",
  at: "2026-09-16T00:00:00.000Z",
  kind: "interface",
  scope: "repo",
  verdict: "ok",
};

const ROW_B: DecisionListRow = {
  projectKey: "project-key-of-row-b",
  id: "run-b/2",
  at: "2026-09-16T00:00:01.000Z",
  kind: "scheduling",
  scope: "task",
  verdict: "ok",
};

/**
 * Every string is distinct, so no assertion below can pass by matching a
 * neighbouring field (the same reason decisionDetail.test.tsx's fixture is
 * built this way).
 */
const DECISION_A: Decision = {
  id: ROW_A.id,
  question: "the question that belongs to row A only",
  chose: "what row A chose",
  because: "why row A chose it",
  alternatives: [{ option: "row A's alternative", why_not: "why row A rejected it" }],
};

const DECISION_B: Decision = {
  id: ROW_B.id,
  question: "the question that belongs to row B only",
  chose: "what row B chose",
  because: "why row B chose it",
  alternatives: [{ option: "row B's alternative", why_not: "why row B rejected it" }],
};

const REPORT: MetricsReport = {
  as_of: "2026-09-16T00:00:00.000Z",
  as_of_mode: "wall_clock",
  repos: [],
  correction_rate: {
    numerator_corrections_excluding_stale: 0,
    denominator_decisions: 0,
    rate_excluding_stale: null,
    corrections_total_including_stale: 0,
    by_decision_kind: [],
    buckets: [],
    caveats: [],
  },
  repair_rate: {
    numerator_overturned: 0,
    denominator_corrections_including_stale: 0,
    rate: null,
    stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" },
    buckets: [],
    caveats: [],
  },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "no producer has run yet" },
  excluded_as_future: 0,
  unresolved_decisions: [],
  unkeyable_repos: [],
  malformed_lines: [],
};

const COVERAGE: PanelCoverage = {
  reviewed_high_tier: 0,
  high_tier_total: 2,
  rate: 0,
  caveat: "the coverage caveat",
};

interface Gate {
  decision: Decision;
  release: () => void;
  released: Promise<void>;
}

function gateFor(decision: Decision): Gate {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { decision, release, released };
}

/** Every POST /api/corrections body the page sent, in order. */
let posted: unknown[] = [];
/** Held open until the test releases them, so a switch can be observed mid-flight. */
let gates: Map<string, Gate>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  posted = [];
  gates = new Map([
    [DECISION_A.id, gateFor(DECISION_A)],
    [DECISION_B.id, gateFor(DECISION_B)],
  ]);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("/api/todo")) return jsonResponse({ rows: [ROW_A, ROW_B] });
    if (url.startsWith("/api/metrics")) return jsonResponse({ report: REPORT, panel_review_coverage: COVERAGE });
    if (url.startsWith("/api/corrections")) {
      posted.push(JSON.parse(String(init?.body ?? "null")));
      return jsonResponse({ recorded: true });
    }
    if (url.startsWith("/api/decision")) {
      const id = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("decisionId") ?? "";
      const gate = gates.get(id);
      if (gate === undefined) throw new Error(`no gate for ${id}`);
      await gate.released;
      return jsonResponse({ decision: gate.decision });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
});

/** Opens the home view and returns the two row buttons, in list order. */
async function openHome(): Promise<HTMLElement[]> {
  render(<App />);
  await screen.findByText("Unreviewed high-tier decisions");
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".decision-list li button"));
}

describe("App's selection (parked finding N-1, ruling R71)", () => {
  it("takes the previous decision off the screen the moment another row is opened", async () => {
    const [openA, openB] = await openHome();
    fireEvent.click(openA!);
    gates.get(DECISION_A.id)!.release();
    await screen.findByText(DECISION_A.question);

    // Row B is opened while its own fetch is still in flight. This is the
    // window N-1 lived in: the screen still said A, and the buttons already
    // meant B.
    fireEvent.click(openB!);

    // Load-bearing assertion: A must be gone. It goes red if App stops
    // clearing what it loaded when the selection changes.
    expect(screen.queryByText(DECISION_A.question)).toBeNull();
    // And with nothing on screen there is no form to submit against B while
    // A's text is still being read.
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });

  it("does not show a decision that finished loading after the person moved on", async () => {
    const [openA, openB] = await openHome();
    // Both fetches are started and neither has answered; A is the slow one.
    fireEvent.click(openA!);
    fireEvent.click(openB!);

    gates.get(DECISION_B.id)!.release();
    await screen.findByText(DECISION_B.question);

    // A's answer arrives late. The bounded window here is the flush that
    // follows the release: a stale `setState` would land inside it, and there
    // is no timer anywhere in this path for it to land after.
    gates.get(DECISION_A.id)!.release();
    await waitFor(() => expect(screen.queryByText(DECISION_B.question)).not.toBeNull());
    expect(screen.queryByText(DECISION_A.question)).toBeNull();
  });

  it("gives the next decision an empty correction form, not the half-typed one from the last", async () => {
    const [openA, openB] = await openHome();
    fireEvent.click(openA!);
    gates.get(DECISION_A.id)!.release();
    await screen.findByText(DECISION_A.question);

    const typed = "half-written reason that belongs to row A";
    const becauseOfA = document.querySelector('textarea[name="because"]');
    expect(becauseOfA).not.toBeNull();
    fireEvent.change(becauseOfA!, { target: { value: typed } });
    expect((becauseOfA as HTMLTextAreaElement).value).toBe(typed);

    fireEvent.click(openB!);
    gates.get(DECISION_B.id)!.release();
    await screen.findByText(DECISION_B.question);

    const becauseOfB = document.querySelector('textarea[name="because"]');
    expect(becauseOfB).not.toBeNull();
    expect((becauseOfB as HTMLTextAreaElement).value).toBe("");
  });

  it("posts a correction against the decision that is on the screen", async () => {
    const [openA, openB] = await openHome();
    fireEvent.click(openA!);
    gates.get(DECISION_A.id)!.release();
    await screen.findByText(DECISION_A.question);

    fireEvent.click(openB!);
    gates.get(DECISION_B.id)!.release();
    await screen.findByText(DECISION_B.question);

    const because = document.querySelector('textarea[name="because"]') as HTMLTextAreaElement;
    fireEvent.change(because, { target: { value: "the reason the person actually wrote" } });
    fireEvent.submit(document.querySelector("form.correction-form")!);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ projectKey: ROW_B.projectKey, decisionId: ROW_B.id });
  });
});
