/**
 * Every function here is a thin wrapper over one `fetch` call. task 8 ruling
 * K7: click handlers stay thin by calling into this module rather than
 * building requests inline, so App.tsx's event handlers are one line each.
 *
 * Accounts spec §3.4: the page carries no credential. The browser sends the
 * session cookie `orca_at` on its own (same origin); every non-GET also sends
 * the `orca_csrf` cookie's value back as `x-orca-csrf` (double submit,
 * src/panel/authRoutes.ts's middleware).
 *
 * Final review I-3 / ruling R66: nothing here throws a server's answer away.
 * A GET that is refused throws a `PanelRequestError` carrying the server's
 * `code` and `message` (the E2 gate's refusal has to be readable by the
 * person, not just "answered 409"); a POST resolves to a typed `PostResult`
 * the page must look at, instead of a promise it could `void`.
 */
import type { ProjectV1, ProjectsAnswerV1 } from "./project.js";
import i18n from "./i18n.js";
import type { ChainRepoView, CorrectionKind, DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

/** The CSRF header every non-GET carries (web/src/controlApi.ts too): the `orca_csrf` cookie's value, or none. */
export function csrfHeader(): Record<string, string> {
  // Outside a browser (a node-environment criterion) there is no cookie jar, so there is no value to send back.
  if (typeof document === "undefined") return {};
  for (const part of document.cookie.split(";")) {
    const pair = part.trim();
    if (pair.startsWith("orca_csrf=")) return { "x-orca-csrf": pair.slice("orca_csrf=".length) };
  }
  return {};
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
    message: typeof fields.message === "string" ? fields.message : i18n.t("panelErrors.whatAnswered", { what, status }),
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

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await readBody(res);
  if (!res.ok) throw new PanelRequestError(refusalFrom(`GET ${path}`, res.status, body));
  return body as T;
}

async function postJson<T>(path: string, payload: unknown, method: "POST" | "PATCH" = "POST"): Promise<PostResult<T>> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...csrfHeader() },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok) {
    const refusal = method === "POST"
      ? refusalFrom(`POST ${path}`, res.status, body)
      : refusalFrom("PATCH " + path, res.status, body);
    return { ok: false, ...refusal };
  }
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

/** GET /api/chains -- src/panel/chains.ts. */
export const fetchChains = (): Promise<{ repos: ChainRepoView[] }> => getJson<{ repos: ChainRepoView[] }>("/api/chains");

/** GET /api/projects -- src/panel/projects.ts (project switcher spec D1, project registry spec §6). */
export const fetchProjects = (): Promise<ProjectsAnswerV1> => getJson<ProjectsAnswerV1>("/api/projects");
/** POST /api/projects -- project registry spec §6. */
export const addProject = (input: { name: string; path: string }): Promise<PostResult<{ project: ProjectV1 }>> => postJson("/api/projects", input);
/** PATCH /api/projects/:id -- project registry spec §6. */
export const renameProject = (id: string, name: string): Promise<PostResult<{ project: ProjectV1 }>> =>
  postJson(`/api/projects/${encodeURIComponent(id)}`, { name }, "PATCH");

export interface StartChainInput {
  repoKey: string;
  goal: string;
  maxSessions: number;
  maxCostUsd: number;
  sessionTimeoutMin?: number;
}
/** The form's boxes as the POST body: numbers as numbers; a blank timeout is left out so .orca/chain.json decides. The server validates. */
export function startChainBody(form: { repoKey: string; goal: string; maxSessions: string; maxCostUsd: string; sessionTimeoutMin: string }): StartChainInput {
  return {
    repoKey: form.repoKey,
    goal: form.goal,
    maxSessions: Number(form.maxSessions),
    maxCostUsd: Number(form.maxCostUsd),
    ...(form.sessionTimeoutMin.trim() === "" ? {} : { sessionTimeoutMin: Number(form.sessionTimeoutMin) }),
  };
}
/** POST /api/chains -- the panel spawns `orca chain start`; it never runs a chain itself. */
export const requestChainStart = (input: StartChainInput): Promise<PostResult<{ chainId: string }>> => postJson("/api/chains", input);
/** POST /api/chains/:id/stop -- writes the stop request; the chain stops after its current session. */
export const requestChainStop = (repoKey: string, chainId: string): Promise<PostResult<{ chainId: string }>> =>
  postJson(`/api/chains/${encodeURIComponent(chainId)}/stop`, { repoKey });
