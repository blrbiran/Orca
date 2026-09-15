import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { correctionBody, failureFrom, fetchMetrics, recordCorrection } from "../src/api.js";
import type { CorrectionForm, PanelRefusal } from "../src/api.js";
import { ErrorPage } from "../src/ErrorPage.js";
import { Refusal } from "../src/Refusal.js";

/**
 * Final review I-3 / ruling R66: the page tells the person what happened.
 * Pure functions and pure components only (plan ruling 2: renderToStaticMarkup,
 * no jsdom, no clicks). Every literal is distinct, so no assertion can pass by
 * matching a different field.
 */

const target = { projectKey: "github.com/biran/orca", decisionId: "run/1" };
const form = (over: Partial<CorrectionForm> = {}): CorrectionForm => ({
  kind: "wrong",
  because: "distinct because text",
  chose_instead: "",
  ...over,
});

describe("correctionBody", () => {
  it("omits a blank chose_instead box (the person said nothing), and keeps because as written", () => {
    for (const blank of ["", "   "]) {
      const body = correctionBody(target, form({ chose_instead: blank }));
      expect("chose_instead" in body, JSON.stringify(blank)).toBe(false);
      expect(body.because).toBe("distinct because text");
    }
  });

  it("keeps a filled chose_instead box exactly as typed", () => {
    const body = correctionBody(target, form({ kind: "not_my_taste", chose_instead: "distinct chose-instead text" }));
    expect(body).toStrictEqual({
      projectKey: target.projectKey,
      decisionId: target.decisionId,
      kind: "not_my_taste",
      because: "distinct because text",
      chose_instead: "distinct chose-instead text",
    });
  });
});

const alreadyRecorded: PanelRefusal = {
  status: 409,
  code: "correction-already-recorded",
  message: "distinct panel refusal sentence",
  retry_field: "again",
};

describe("Refusal", () => {
  it("renders the server's code and message", () => {
    const html = renderToStaticMarkup(<Refusal refusal={alreadyRecorded} />);
    expect(html).toContain(alreadyRecorded.code);
    expect(html).toContain(alreadyRecorded.message);
  });

  it("offers 'record another' only when the server names `again` as the retry field", () => {
    expect(renderToStaticMarkup(<Refusal refusal={alreadyRecorded} />)).toContain("record-another");
    const { retry_field: _dropped, ...withoutRetry } = alreadyRecorded;
    expect(renderToStaticMarkup(<Refusal refusal={withoutRetry} />)).not.toContain("record-another");
    expect(renderToStaticMarkup(<Refusal refusal={{ ...alreadyRecorded, retry_field: "other" }} />)).not.toContain(
      "record-another",
    );
  });
});

describe("ErrorPage", () => {
  it("renders the E2 gate refusal's code and message, not only the status", () => {
    const gate: PanelRefusal = {
      status: 409,
      code: "unresolved-project-keys",
      message: "distinct gate message naming github.com/ghost/repo",
    };
    const html = renderToStaticMarkup(<ErrorPage failure={gate} />);
    expect(html).toContain(gate.code);
    expect(html).toContain(gate.message);
  });
});

describe("api.ts keeps the server's answer (stubbed fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("a refused GET throws an error carrying the server's code and message", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", answer(409, { code: "unresolved-project-keys", message: "distinct gate message" }));
    const failure = await fetchMetrics().then(
      () => undefined,
      (err: unknown) => failureFrom(err),
    );
    expect(failure).toStrictEqual({ status: 409, code: "unresolved-project-keys", message: "distinct gate message" });
  });

  it("a refused POST resolves to a result carrying status, code, message and retry_field", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", answer(409, { code: alreadyRecorded.code, message: alreadyRecorded.message, retry_field: "again" }));
    const result = await recordCorrection(correctionBody(target, form()));
    expect(result).toStrictEqual({
      ok: false,
      status: 409,
      code: alreadyRecorded.code,
      message: alreadyRecorded.message,
      retry_field: "again",
    });
  });
});
