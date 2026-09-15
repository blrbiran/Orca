/**
 * Every function here is a thin wrapper over one `fetch` call. task 8 ruling
 * K7: click handlers stay thin by calling into this module rather than
 * building requests inline, so App.tsx's event handlers are one line each.
 *
 * The token reaches the page via `window.__ORCA_TOKEN__`, injected into
 * index.html by `TOKEN_ANCHOR` (src/panel/staticFiles.ts). Every `/api` call
 * carries it as `x-orca-token` (src/panel/api.ts's token middleware).
 */
import type { DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

declare global {
  interface Window {
    __ORCA_TOKEN__?: string;
  }
}

function token(): string {
  return window.__ORCA_TOKEN__ ?? "";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-orca-token": token() } });
  const body = (await res.json()) as T;
  if (!res.ok) throw new Error(`orca panel: GET ${path} answered ${res.status}`);
  return body;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "x-orca-token": token(), "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as T;
  if (!res.ok) throw new Error(`orca panel: POST ${path} answered ${res.status}`);
  return body;
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
  kind: string;
  because: string;
  chose_instead?: string;
  again?: boolean;
}

/** POST /api/corrections -- src/panel/api.ts. Never closes the loop; record only. */
export const recordCorrection = (input: RecordCorrectionInput): Promise<unknown> =>
  postJson("/api/corrections", input);

/** POST /api/reviews -- src/panel/api.ts. The explicit "I reviewed this" act. */
export const recordReview = (projectKey: string, decisionId: string): Promise<unknown> =>
  postJson("/api/reviews", { projectKey, decisionId });
