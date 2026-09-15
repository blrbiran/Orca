/**
 * Every function here is a thin wrapper over one `fetch` call. task 8 ruling
 * K7: click handlers stay thin by calling into this module rather than
 * building requests inline, so App.tsx's event handlers are one line each.
 *
 * The token reaches the page via `window.__ORCA_TOKEN__`, injected into
 * index.html by `TOKEN_ANCHOR` (src/panel/staticFiles.ts). Every `/api` call
 * carries it as `x-orca-token` (src/panel/api.ts's token middleware).
 *
 * Final review I-3 / ruling R66: nothing here throws a server's answer away.
 * A GET that is refused throws a `PanelRequestError` carrying the server's
 * `code` and `message` (the E2 gate's refusal has to be readable by the
 * person, not just "answered 409"); a POST resolves to a typed `PostResult`
 * the page must look at, instead of a promise it could `void`.
 */
import type { CorrectionKind, DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

declare global {
  interface Window {
    __ORCA_TOKEN__?: string;
  }
}

function token(): string {
  return window.__ORCA_TOKEN__ ?? "";
}

/** A named refusal as the page shows it. `status` is null when no HTTP answer arrived at all. */
export interface PanelRefusal {
  status: number | null;
  code: string;
  message: string;
  retry_field?: string;
}

export type PostResult<T> = { ok: true; body: T } | ({ ok: false; status: number } & Omit<PanelRefusal, "status">);

/** Reads a non-2xx answer's `{ code, message, retry_field? }`; a body without that shape still yields something readable. */
export function refusalFrom(what: string, status: number, body: unknown): { status: number } & PanelRefusal {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return {
    status,
    code: typeof fields.code === "string" ? fields.code : `http-${status}`,
    message: typeof fields.message === "string" ? fields.message : `${what} answered ${status}`,
    ...(typeof fields.retry_field === "string" ? { retry_field: fields.retry_field } : {}),
  };
}

export class PanelRequestError extends Error {
  constructor(readonly refusal: PanelRefusal) {
    super(`${refusal.code}: ${refusal.message}`);
    this.name = "PanelRequestError";
  }
}

/** What the page shows for anything a request threw: the server's refusal when there was one. */
export function failureFrom(err: unknown): PanelRefusal {
  if (err instanceof PanelRequestError) return err.refusal;
  return { status: null, code: "panel-unreachable", message: err instanceof Error ? err.message : String(err) };
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-orca-token": token() } });
  const body = await readBody(res);
  if (!res.ok) throw new PanelRequestError(refusalFrom(`GET ${path}`, res.status, body));
  return body as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<PostResult<T>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-orca-token": token(), "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok) return { ok: false, ...refusalFrom(`POST ${path}`, res.status, body) };
  return { ok: true, body: body as T };
}

export interface MetricsResponse {
  report: MetricsReport;
  panel_review_coverage: PanelCoverage;
}

/** GET /api/metrics -- src/panel/api.ts. */
export const fetchMetrics = (): Promise<MetricsResponse> => getJson<MetricsResponse>("/api/metrics");

/** GET /api/todo -- src/panel/api.ts, task 8 ruling K5. */
export const fetchTodo = (): Promise<{ rows: DecisionListRow[] }> =>
  getJson<{ rows: DecisionListRow[] }>("/api/todo");

/**
 * GET /api/decision -- same URL spelling as src/panel/listProjection.ts's
 * `detailUrl` (web cannot import it, so it is repeated here verbatim rather
 * than through a shared constant).
 */
export const fetchDecision = (projectKey: string, decisionId: string): Promise<{ decision: unknown }> =>
  getJson<{ decision: unknown }>(
    `/api/decision?projectKey=${encodeURIComponent(projectKey)}&decisionId=${encodeURIComponent(decisionId)}`,
  );

export interface RecordCorrectionInput {
  projectKey: string;
  decisionId: string;
  kind: CorrectionKind;
  because: string;
  chose_instead?: string;
  again?: boolean;
}

/** What the correction form holds: every box as typed, blank included. */
export interface CorrectionForm {
  kind: CorrectionKind;
  because: string;
  chose_instead: string;
}

/**
 * The POST body for one correction form. A blank `chose_instead` box is
 * OMITTED, not sent as "": the person said nothing, and the server passes an
 * empty string through to the seam, which refuses it by name (an empty string
 * and an absent field derive different correction ids -- record.ts). A filled
 * box is kept exactly as typed, and `because` is only ever what the person
 * wrote -- this function never supplies one of its own.
 */
export function correctionBody(target: { projectKey: string; decisionId: string }, form: CorrectionForm): RecordCorrectionInput {
  return {
    projectKey: target.projectKey,
    decisionId: target.decisionId,
    kind: form.kind,
    because: form.because,
    ...(form.chose_instead.trim() === "" ? {} : { chose_instead: form.chose_instead }),
  };
}

/** POST /api/corrections -- src/panel/api.ts. Never closes the loop; record only. */
export const recordCorrection = (input: RecordCorrectionInput): Promise<PostResult<unknown>> =>
  postJson("/api/corrections", input);

/** POST /api/reviews -- src/panel/api.ts. The explicit "I reviewed this" act. */
export const recordReview = (projectKey: string, decisionId: string): Promise<PostResult<unknown>> =>
  postJson("/api/reviews", { projectKey, decisionId });
