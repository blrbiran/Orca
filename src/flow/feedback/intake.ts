/**
 * Gaps spec §4.1-§4.8 (G2): the feedback intake, a state machine code drives. A feedback message on the run, or with
 * an anchor, opens one intake (`flow_feedback`); code locates (`loc1`, over the flow head's composition, after the
 * person's drift is taken), code bounds the steps that may take it, one `feedback-triage` call classifies; a vague
 * whole-article feedback gets one short clarify round on the feedback host (host.ts) and a second triage. Only the
 * intake waits for the person (needs-location, clarifying): the run never does (anti-goal 4). At the next whole-run
 * boundary a `ready` intake is re-verified and consumed like step feedback (messages.ts consumeAtBoundary): one plan.
 *
 *   locating ─▶ needs-location        (zero or several hits, an ambiguous reading file: the person replaces, §4.8)
 *      ├─▶ triaging ─▶ clarifying ─▶ restating ─▶ ready ─▶ planned
 *      │       └──────────────────────────────▶ ready
 *      └─▶ ready                        (step-targeted, located: no triage)
 *   any open state ─▶ withdrawn (replaced, the run stopped) · failed (`flow-feedback-no-target`)
 *
 * Attachments are named by id only, in every call and in the work prompts (spec §21 entry 2: §4.7's workspace copy is
 * not built; the human decides between an absolute path with ccloop read access and a ccloop seeding change).
 */
import { buildClarifyPrompt, CLARIFY_JSON_SCHEMA, classifyClarifyOutput } from "../../control/requirementClarify.js";
import { latestRoundAt, newRound, writeRoundAt, type RoundsKey } from "../../control/requirementRecords.js";
import { MAX_AUTO_RETRIES, type RoundBody } from "../../control/requirementSchemas.js";
import type { ControlStore } from "../../control/store.js";
import { advanceRun, compositionFor, driftBeforeExecution, FlowRefusal, loadRun, markStateOf, vaultOf, type FlowDeps } from "../kernel.js";
import type { LoadedRun } from "../kinds/registry.js";
import {
  FEEDBACK_KEY, getHead, getIntake, insertIntake, listExecutions, listIntakes, listMessages, listPlans, moveIntake, putPlan, setMessageState,
  type IntakeRow, type IntakeState, type MessageRow, type PlanRow,
} from "../store.js";
import { changesBetween } from "../vault/copyBack.js";
import type { PlanCandidates, PlanChosen } from "../rerun.js";
import { vaultGitBytes } from "../vault/vault.js";
import { extractAnchors, type Anchor } from "./anchors.js";
import { ATTACHMENT_ID, attachmentPath } from "./attachments.js";
import { FEEDBACK_CLARIFY_CAPS, feedbackClarifyHost } from "./host.js";
import { emptyIntakeBody, type IntakeBody } from "./intakeSchema.js";
import { locate, paragraphTexts, readingFile, type Hit, type LocateResult, type SearchFile } from "./locate.js";
import { bounded } from "../prompt.js";
import { PASSAGE_MAX_BYTES, READING_MAX_BYTES, TRIAGE_JSON_SCHEMA, TRIAGE_MAX_OUTPUT_TOKENS, TRIAGE_PURPOSE, triagePrompt, validateTriage, type TriageCandidate } from "./triage.js";

export const TRIAGE_DEFAULTED = "triage-defaulted";
export const CLARIFY_SKIPPED = "clarify-skipped";
export const FEEDBACK_NO_TARGET = "flow-feedback-no-target";
export const FEEDBACK_ALREADY_APPLIED = "flow-feedback-already-applied";
const FEEDBACK_CLARIFY_MAX_OUTPUT_TOKENS = 16_000;

/** States in which Orca (not the person) owes the intake a move: the run is not `done` while one is open (§4.2). */
export const BUSY_INTAKE: ReadonlySet<IntakeState> = new Set(["locating", "triaging", "restating", "ready"]);
/** States in which the intake waits on the person: they count toward `needsYou` (§4.2). */
export const WAITING_INTAKE: ReadonlySet<IntakeState> = new Set(["needs-location", "clarifying"]);
const OPEN: ReadonlySet<IntakeState> = new Set(["locating", "needs-location", "triaging", "clarifying", "restating", "ready"]);

export interface FeedbackBody { text?: unknown; anchors?: unknown; attachments?: unknown; replaces?: unknown; asIs?: unknown; hit?: unknown }
type Target = { kind: string; stepKey?: string };

const roundsKey = (run: LoadedRun, seq: number): RoundsKey => ({ groupId: run.row.groupId, stepKey: FEEDBACK_KEY, execSeq: seq });
const givenAnchors = (body: FeedbackBody): Anchor[] => (Array.isArray(body.anchors) ? body.anchors as Anchor[] : [])
  .map((a) => ({ ...(a.quote === undefined ? {} : { quote: a.quote }), ...(a.heading === undefined ? {} : { heading: a.heading }), ...(a.paragraph === undefined ? {} : { paragraph: a.paragraph }) }));

/** §4.8: the replaced intake's hits, in order (`hit: k` is the k-th, 1-based). */
export const hitListOf = (body: IntakeBody): Hit[] => body.results.flatMap((r) => ("hits" in r ? r.hits : []));

/** The shape of the new fields (§4.1) and of a replacement (§4.8), told at once; null when it holds. */
export function feedbackShapeRefusal(store: ControlStore, flowRunId: string, body: FeedbackBody, hasAttachment: (id: string) => boolean): string | null {
  if (body.anchors !== undefined) {
    if (!Array.isArray(body.anchors) || body.anchors.length > 5) return "flow-message-invalid:anchors";
    for (const a of body.anchors as unknown[]) {
      if (typeof a !== "object" || a === null || Array.isArray(a)) return "flow-message-invalid:anchors";
      const { quote, heading, paragraph, ...rest } = a as Record<string, unknown>;
      if (Object.keys(rest).length > 0 || (quote === undefined && heading === undefined && paragraph === undefined)) return "flow-message-invalid:anchors";
      if ((quote !== undefined && (typeof quote !== "string" || quote.trim() === "")) || (heading !== undefined && (typeof heading !== "string" || heading.trim() === ""))
        || (paragraph !== undefined && (typeof paragraph !== "number" || !Number.isInteger(paragraph) || paragraph < 1))) return "flow-message-invalid:anchors";
    }
  }
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return "flow-attachment-invalid:attachments";
    if (body.attachments.length > 4) return "flow-attachment-invalid:at most 4 per message";
    for (const id of body.attachments as unknown[]) if (typeof id !== "string" || !hasAttachment(id)) return `flow-attachment-invalid:${String(id)}`;
  }
  if (body.asIs !== undefined && typeof body.asIs !== "boolean") return "flow-message-invalid:asIs";
  if (body.replaces === undefined) return body.hit === undefined ? null : "flow-message-invalid:hit needs replaces";
  if (typeof body.replaces !== "number" || !Number.isInteger(body.replaces)) return "flow-message-invalid:replaces";
  const old = getIntake(store, flowRunId, body.replaces);
  if (old === null || old.state === "withdrawn" || old.state === "failed") return "flow-message-invalid:replaces";
  if (old.state === "planned") {
    const plan = listPlans(store, flowRunId).find((p) => p.planNo === old.body.planNo);
    if (plan === undefined || (plan.state !== "proposed" && plan.state !== "running")) return FEEDBACK_ALREADY_APPLIED;
  }
  if (body.hit !== undefined) {
    const k = body.hit;
    if (typeof k !== "number" || !Number.isInteger(k) || k < 1 || k > hitListOf(old.body).length) return "flow-message-invalid:hit";
  }
  return null;
}

/**
 * §4.1: the intake a stored, accepted feedback message opens -- on the run, or carrying an anchor (given, found in the
 * text, or a picked hit) -- or null (a step feedback with no anchor behaves exactly as before). Inside the caller's
 * transaction, with the replacement (§4.8): the replaced intake is withdrawn and its message excluded; a plan it made
 * that is still open is abandoned (the new intake's plan takes its place).
 */
export function openIntake(store: ControlStore, run: LoadedRun, message: Pick<MessageRow, "seq" | "kind" | "body">, at: number): boolean {
  if (message.kind !== "feedback") return false;
  const body = message.body as FeedbackBody & { target: Target };
  const target = body.target;
  let pins: Array<{ file: string; paragraph: number }> = [];
  if (typeof body.replaces === "number") {
    const old = getIntake(store, run.row.id, body.replaces)!;
    if (typeof body.hit === "number") { const hit = hitListOf(old.body)[body.hit - 1]!; pins = [{ file: hit.file, paragraph: hit.paragraph }]; }
    moveIntake(store, run.row.id, old.messageSeq, old.state, "withdrawn", old.body, at);
    const oldMessage = listMessages(store, run.row.id).find((m) => m.seq === old.messageSeq)!;
    if (oldMessage.state === "accepted" || oldMessage.state === "applied") setMessageState(store, run.row.id, old.messageSeq, oldMessage.state, "excluded", `replaced by message ${message.seq}`);
    const plan = old.state === "planned" ? listPlans(store, run.row.id).find((p) => p.planNo === old.body.planNo) : undefined;
    if (plan !== undefined && (plan.state === "proposed" || plan.state === "running")) putPlan(store, withoutIntake(store, run.row.id, plan, old.body));
  }
  const anchors = extractAnchors(String(body.text), givenAnchors(body));
  if (target.kind !== "run" && anchors.length === 0 && pins.length === 0) return false;
  insertIntake(store, { flowRunId: run.row.id, messageSeq: message.seq, state: "locating", at, body: {
    ...emptyIntakeBody(), anchors, pins, text: String(body.text), stepKey: target.kind === "run" ? null : target.stepKey ?? null,
    asIs: body.asIs === true, attachments: Array.isArray(body.attachments) ? body.attachments as string[] : [],
  } });
  return true;
}

/**
 * §4.8 (review fix 1): a replaced intake's words leave the open plan it made; the plan stays open, so the rest of what
 * it carries -- another feedback taken at the same boundary -- is carried by the next plan as before. A target left with
 * no feedback, whose only reason was feedback and which has not run under the plan, leaves its candidates and its
 * chosen steps (as dropFromOpenPlan does for a mark); a target with other reasons keeps them, minus `feedback`.
 */
function withoutIntake(store: ControlStore, flowRunId: string, plan: PlanRow, body: IntakeBody): PlanRow {
  const text = feedbackTextOf(body);
  const cands = plan.candidates as PlanCandidates;
  const feedback: Record<string, string[]> = {};
  for (const [key, texts] of Object.entries(cands.feedback)) {
    const kept = texts.filter((t) => t !== text);
    if (kept.length > 0) feedback[key] = kept;
  }
  const ran = (key: string) => listExecutions(store, flowRunId).some((e) => e.stepKey === key && e.planNo === plan.planNo);
  const emptied = Object.keys(cands.feedback).filter((key) => feedback[key] === undefined && !ran(key));
  const list = cands.list.flatMap((c) => {
    if (!emptied.includes(c.stepKey)) return [c];
    const reasons = c.reasons.filter((r) => r !== "feedback");
    return reasons.length === 0 ? [] : [{ ...c, reasons }];
  });
  const gone = new Set(cands.list.filter((c) => !list.some((l) => l.stepKey === c.stepKey)).map((c) => c.stepKey));
  const chosen = plan.chosen as PlanChosen | null;
  return {
    ...plan, candidates: { ...cands, list, feedback } satisfies PlanCandidates,
    chosen: chosen === null ? null : { ...chosen, steps: chosen.steps.filter((key) => !gone.has(key)) } satisfies PlanChosen,
  };
}

/** §4.2 rewind: the re-queued message reuses the stored intake -- no new triage or clarify call -- starting at `ready`. */
export function reuseIntake(store: ControlStore, flowRunId: string, from: number, seq: number, at: number): boolean {
  const old = getIntake(store, flowRunId, from);
  if (old === null || old.state !== "planned") return false;
  insertIntake(store, { flowRunId, messageSeq: seq, state: "ready", at, body: { ...old.body, reusedFrom: from, planNo: null, calls: [], call: null } });
  return true;
}

/** A stop withdraws every open intake (§4.2); their messages are excluded. Inside the caller's transaction. */
export function withdrawIntakes(store: ControlStore, flowRunId: string, why: string, at: number): void {
  for (const intake of listIntakes(store, flowRunId).filter((i) => OPEN.has(i.state))) {
    moveIntake(store, flowRunId, intake.messageSeq, intake.state, "withdrawn", intake.body, at);
    const message = listMessages(store, flowRunId).find((m) => m.seq === intake.messageSeq);
    if (message?.state === "accepted") setMessageState(store, flowRunId, intake.messageSeq, "accepted", "excluded", why);
  }
}

// ----------------------------------------------------------------------------------------------------------- locating

interface SearchState { files: SearchFile[]; byPath: Map<string, string> }

/**
 * §4.3 search set: the markdown files some step's active output changed (deleted ones not), each with its last writer
 * (the latest step in template order whose active output changed it); for a step-targeted intake only that step's.
 * The text is read from the composition of the active outputs -- what the flow head is (or becomes), never the folder.
 */
async function searchSetOf(deps: FlowDeps, run: LoadedRun, stepKey: string | null): Promise<SearchState> {
  const vault = vaultOf(run);
  const composition = vault === null ? null : await compositionFor(deps.store, run, null);
  if (vault === null || composition === null) return { files: [], byPath: new Map() };
  const executions = listExecutions(deps.store, run.row.id);
  const { suppressed } = markStateOf(deps.store, run.row.id);
  const writer = new Map<string, { index: number; key: string }>();
  for (const [index, step] of run.template.steps.entries()) {
    if (suppressed.has(step.id) || (stepKey !== null && step.id !== stepKey)) continue;
    const head = getHead(deps.store, run.row.id, step.id);
    const active = executions.find((e) => e.stepKey === step.id && e.seq === head);
    if (active?.outputKind !== "commit" || active.outputRef === null) continue;
    const parent = String((active.body as { parent?: string }).parent ?? active.baseCommit);
    for (const change of await changesBetween(vault, parent, active.outputRef)) {
      if (change.status !== "D" && change.path.endsWith(".md")) writer.set(change.path, { index, key: step.id });
    }
  }
  const files: SearchFile[] = [];
  const byPath = new Map<string, string>();
  for (const [path, w] of [...writer.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let text: string;
    try { text = (await vaultGitBytes(vault, ["show", `${composition.commit}:${path}`])).toString("utf8"); } catch { continue; }
    files.push({ path, text, writerIndex: w.index, writerKey: w.key });
    byPath.set(path, text);
  }
  return { files, byPath };
}

/** Anchors and pins located against the search set; `ambiguous`: the reading files when the reading writer wrote several. */
function locateAll(body: IntakeBody, search: SearchState): { results: LocateResult[]; ambiguousFiles: string[]; ok: boolean } {
  const results = locate(body.anchors, search.files);
  for (const pin of body.pins) {
    const file = search.files.find((f) => f.path === pin.file);
    const one = file === undefined ? [] : locate([{ paragraph: pin.paragraph }], [file]);
    results.push(one[0] !== undefined && "located" in one[0] ? { anchor: {}, located: one[0].located } : { anchor: {}, hits: [], more: 0 });
  }
  const reading = search.files.length === 0 ? null : readingFile(search.files);
  const whole = body.anchors.length === 0 && body.pins.length === 0;
  // Task 1 carried item: an ordinal on an ambiguous reading file lists the candidate files, never an empty set.
  const ordinalMiss = results.some((r) => !("located" in r) && r.anchor.paragraph !== undefined && r.anchor.quote === undefined && r.anchor.heading === undefined);
  const ambiguousFiles = reading !== null && "ambiguous" in reading && (whole || ordinalMiss) ? reading.ambiguous : [];
  return { results, ambiguousFiles, ok: results.every((r) => "located" in r) && ambiguousFiles.length === 0 };
}

/** §4.4: the steps that may take the feedback, and the last writer the code default falls back to. */
function candidatesOf(deps: FlowDeps, run: LoadedRun, body: IntakeBody, search: SearchState, results: readonly LocateResult[]): { T: string[]; lastWriter: string | null } {
  // A located file the current search set lacks (its writer was marked meanwhile) still bounds T by its stored writer.
  const writerOf = (path: string): SearchFile | undefined => search.files.find((f) => f.path === path) ?? (() => {
    const stored = body.searchSet.find((f) => f.path === path);
    const index = stored === undefined ? -1 : run.template.steps.findIndex((s) => s.id === stored.writerKey);
    return stored === undefined || index === -1 ? undefined : { path, text: "", writerIndex: index, writerKey: stored.writerKey };
  })();
  const located = results.flatMap((r) => ("located" in r ? [writerOf(r.located.file)] : [])).filter((f) => f !== undefined);
  const whole = body.anchors.length === 0 && body.pins.length === 0;
  const reading = whole && search.files.length > 0 ? readingFile(search.files) : null;
  const bound = whole ? (reading !== null && "file" in reading ? reading.file : null) : located.reduce<SearchFile | null>((top, f) => (top === null || f!.writerIndex > top.writerIndex ? f! : top), null);
  const executions = listExecutions(deps.store, run.row.id);
  const { marks } = markStateOf(deps.store, run.row.id);
  const T = run.template.steps.filter((step, index) => {
    if (step.kind !== "work" && step.kind !== "draft") return false;
    if (bound !== null && index > bound.writerIndex) return false;
    if (marks.has(step.id)) return false;
    const head = getHead(deps.store, run.row.id, step.id);
    return executions.some((e) => e.stepKey === step.id && e.seq === head && e.state === "done");
  }).map((s) => s.id);
  const lastWriter = bound !== null && T.includes(bound.writerKey) ? bound.writerKey : T.at(-1) ?? null;
  return { T, lastWriter };
}

/** §4.4: no step may take it (empty T, or every candidate marked since) ⇒ failed, its message red with the code. */
function failNoTarget(deps: FlowDeps, intake: IntakeRow, body: IntakeBody): void {
  deps.store.transaction(() => {
    moveIntake(deps.store, intake.flowRunId, intake.messageSeq, intake.state, "failed", { ...body, call: null, flags: [...new Set([...body.flags, FEEDBACK_NO_TARGET])] }, deps.now());
    setMessageState(deps.store, intake.flowRunId, intake.messageSeq, "accepted", "rejected", FEEDBACK_NO_TARGET);
  });
}

function write(deps: FlowDeps, intake: IntakeRow, to: IntakeState, body: IntakeBody): IntakeRow {
  const at = deps.now();
  deps.store.transaction(() => moveIntake(deps.store, intake.flowRunId, intake.messageSeq, intake.state, to, body, at));
  return { ...intake, state: to, body, updatedAt: at };
}

async function locateIntake(deps: FlowDeps, run: LoadedRun, intake: IntakeRow): Promise<void> {
  // §4.3, Review Focus 4: what the person changed in their folder is taken first, as before any execution.
  if (await driftBeforeExecution(deps, run.row.id)) run = loadRun(deps.store, run.row.id);
  const search = await searchSetOf(deps, run, intake.body.stepKey);
  const { results, ambiguousFiles, ok } = locateAll(intake.body, search);
  const body: IntakeBody = { ...intake.body, results, ambiguousFiles, searchSet: search.files.map((f) => ({ path: f.path, writerKey: f.writerKey })) };
  if (!ok) { write(deps, intake, "needs-location", body); return; }
  if (intake.body.stepKey !== null) { write(deps, intake, "ready", { ...body, targets: [{ stepKey: intake.body.stepKey, why: "the person sent it to this step" }] }); return; }
  const { T } = candidatesOf(deps, run, body, search, results);
  if (T.length === 0) { failNoTarget(deps, intake, body); return; }
  await requestTriage(deps, run, write(deps, intake, "triaging", body), search);
}

// ------------------------------------------------------------------------------------------------------------- triage

const isWhole = (body: IntakeBody): boolean => body.anchors.length === 0 && body.pins.length === 0;
/** §4.4: `vague` only on a whole-article intake's first triage with `asIs` false; `restated` once a round was answered. */
const triageRules = (intake: IntakeRow) => ({
  mayBeVague: intake.state === "triaging" && isWhole(intake.body) && !intake.body.asIs,
  restatedRequired: intake.state === "restating" && intake.body.qa.length > 0,
});

async function triageInput(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, search: SearchState, lastInvalid: string | null) {
  const { T, lastWriter } = candidatesOf(deps, run, intake.body, search, intake.body.results);
  const candidates: TriageCandidate[] = T.map((key) => {
    const step = run.template.steps.find((s) => s.id === key)!;
    return { stepKey: key, kind: step.kind, skills: "skills" in step ? step.skills ?? [] : [], owns: step.hints?.owns ?? [] };
  });
  const passages = intake.body.results.flatMap((r) => {
    if (!("located" in r)) return [];
    const paras = paragraphTexts(search.byPath.get(r.located.file) ?? "");
    const n = r.located.paragraph;
    const cut = bounded(paras.slice(Math.max(0, n - 2), n + 1).join("\n\n"), PASSAGE_MAX_BYTES);
    return [{ file: r.located.file, paragraph: n, headingPath: r.located.headingPath, context: cut.text, cut: cut.cut }];
  });
  const readingOf = isWhole(intake.body) && search.files.length > 0 ? readingFile(search.files) : null;
  const reading = readingOf !== null && "file" in readingOf ? (() => { const cut = bounded(readingOf.file.text, READING_MAX_BYTES); return { path: readingOf.file.path, text: cut.text, cut: cut.cut }; })() : null;
  return { T, lastWriter, candidates, passages, reading, ...triageRules(intake), lastInvalid };
}

async function requestTriage(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, search?: SearchState, resend = false): Promise<void> {
  const searched = search ?? await searchSetOf(deps, run, intake.body.stepKey);
  const retries = intake.body.call?.purpose === TRIAGE_PURPOSE ? intake.body.call.retries : 0;
  const lastInvalid = intake.body.call?.purpose === TRIAGE_PURPOSE ? intake.body.call.lastInvalid : null;
  const input = await triageInput(deps, run, intake, searched, lastInvalid);
  const prompt = triagePrompt({ text: intake.body.text, passages: input.passages, reading: input.reading, candidates: input.candidates, qa: intake.body.qa, attachments: intake.body.attachments, mayBeVague: input.mayBeVague, restatedRequired: input.restatedRequired, lastInvalid });
  const written = write(deps, intake, intake.state, { ...intake.body, call: { purpose: TRIAGE_PURPOSE, runId: null, retries, lastInvalid, callResult: null, requested: false }, calls: resend ? intake.body.calls : [...intake.body.calls, { purpose: TRIAGE_PURPOSE, at: deps.now() }] });
  sendCall(deps, run, written, { purpose: TRIAGE_PURPOSE, prompt, responseSchema: TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: TRIAGE_MAX_OUTPUT_TOKENS });
}

/**
 * The call is written onto the intake first (`requested: false`), sent, then marked sent. Review fix (minor 1): a
 * crash between the write and the send leaves `requested: false` with no claim and no result; the next pass builds the
 * same request again and sends it (advanceIntakes, `resend`). A call the port already claimed is only marked.
 */
interface IntakeRequest { purpose: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }
function sendCall(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, request: IntakeRequest): void {
  deps.calls.request({ key: { flowRunId: run.row.id, stepKey: FEEDBACK_KEY, seq: intake.messageSeq }, groupId: run.row.groupId, ...request });
  const now = getIntake(deps.store, intake.flowRunId, intake.messageSeq);
  if (now?.body.call != null && now.body.call.requested === false) write(deps, now, now.state, { ...now.body, call: { ...now.body.call, requested: true } });
}

/** A call the pool or the parent could not fund never gets better by asking again. */
const finalFailure = (failure: string | null): boolean => failure === "flow-pool-exhausted" || failure === "flow-call-unconfirmed";

async function settleTriage(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, raw: unknown, failure: string | null): Promise<void> {
  const call = intake.body.call!;
  const search = await searchSetOf(deps, run, intake.body.stepKey);
  const { T, lastWriter } = candidatesOf(deps, run, intake.body, search, intake.body.results);
  const rules = triageRules(intake);
  const verdict = failure !== null ? { ok: false as const, why: `call-failed:${failure}` } : validateTriage(raw, { candidates: T, ...rules });
  const first = intake.body.triage === null;
  if (verdict.ok) {
    const clarity = verdict.clarity ?? "concrete";
    const body: IntakeBody = { ...intake.body, call: null, ...(first ? { triage: { clarity } } : {}), targets: verdict.targets, restated: verdict.restated ?? intake.body.restated };
    if (clarity === "vague") { await requestClarify(deps, run, write(deps, intake, "clarifying", body)); return; }
    write(deps, intake, "ready", body);
    return;
  }
  if (!finalFailure(failure) && call.retries < MAX_AUTO_RETRIES) {
    await requestTriage(deps, run, { ...intake, body: { ...intake.body, call: { ...call, retries: call.retries + 1, lastInvalid: verdict.why } } }, search);
    return;
  }
  // §4.4: exhausted ⇒ the code default -- the last writer alone -- flagged.
  const defaulted: IntakeBody = { ...intake.body, call: null, ...(first ? { triage: { clarity: "concrete" as const } } : {}), flags: [...new Set([...intake.body.flags, TRIAGE_DEFAULTED])] };
  // Review fix (minor 5): every candidate was marked meanwhile -- nothing may take it, as at locating.
  if (lastWriter === null) { failNoTarget(deps, intake, defaulted); return; }
  write(deps, intake, "ready", { ...defaulted, targets: [{ stepKey: lastWriter, why: `code default: the triage call gave no valid answer (${verdict.why})` }] });
}

// ------------------------------------------------------------------------------------------------------------ clarify

async function readingForHost(deps: FlowDeps, run: LoadedRun, intake: IntakeRow): Promise<{ path: string; text: string; cut: number } | null> {
  const search = await searchSetOf(deps, run, null);
  const reading = search.files.length === 0 ? null : readingFile(search.files);
  if (reading === null || !("file" in reading)) return null;
  const cut = bounded(reading.file.text, READING_MAX_BYTES);
  return { path: reading.file.path, text: cut.text, cut: cut.cut };
}

async function requestClarify(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, resend = false): Promise<void> {
  const key = roundsKey(run, intake.messageSeq);
  let round = latestRoundAt(deps.store, key);
  if (round === null) { round = newRound(1); deps.store.transaction(() => writeRoundAt(deps.store, key, round!)); }
  const host = feedbackClarifyHost({ groupId: run.row.groupId, messageSeq: intake.messageSeq, text: intake.body.text, reading: await readingForHost(deps, run, intake), attachments: intake.body.attachments });
  const prompt = buildClarifyPrompt({
    idea: intake.body.text, contentLanguage: run.params.language === "zh" ? "zh" : "en", overview: await host.context(), earlier: [], retryReason: round.lastInvalidReason,
    limits: { roundNo: 1, classification: null, roundCap: FEEDBACK_CLARIFY_CAPS.rounds }, frame: host.background(), caps: host.caps!(),
  });
  const written = write(deps, intake, intake.state, { ...intake.body, call: { purpose: "clarify", runId: null, retries: round.retries, lastInvalid: round.lastInvalidReason, callResult: null, requested: false }, calls: resend ? intake.body.calls : [...intake.body.calls, { purpose: "clarify", at: deps.now() }] });
  sendCall(deps, run, written, { purpose: "clarify", prompt, responseSchema: CLARIFY_JSON_SCHEMA as Record<string, unknown>, maxOutputTokens: FEEDBACK_CLARIFY_MAX_OUTPUT_TOKENS });
}

/** §4.6: a clarify call that fails or is exhausted ⇒ the intake goes on as `asIs`, flagged; the second triage runs. */
async function skipClarify(deps: FlowDeps, run: LoadedRun, intake: IntakeRow): Promise<void> {
  const next = write(deps, intake, "restating", { ...intake.body, call: null, asIs: true, flags: [...new Set([...intake.body.flags, CLARIFY_SKIPPED])] });
  await requestTriage(deps, run, next);
}

async function settleClarify(deps: FlowDeps, run: LoadedRun, intake: IntakeRow, raw: unknown, failure: string | null): Promise<void> {
  const key = roundsKey(run, intake.messageSeq);
  const round = latestRoundAt(deps.store, key);
  // Review fix (minor 2): a result the round no longer waits on is dropped -- the call is cleared, never judged again.
  if (round === null) { await skipClarify(deps, run, intake); return; }
  if (round.state !== "drafting") { write(deps, intake, intake.state, { ...intake.body, call: null }); return; }
  const verdict = failure !== null ? { ok: false as const, reason: `call-failed:${failure}` }
    : classifyClarifyOutput(raw, { roundNo: 1, requirementId: `${run.row.id.replace(/^fr-/, "")}`, earlierQuestionIds: [], caps: FEEDBACK_CLARIFY_CAPS });
  if (verdict.ok) {
    deps.store.transaction(() => writeRoundAt(deps.store, key, { ...round, state: "awaiting-answers", result: verdict.result, lastInvalidReason: null }));
    // Nothing to ask: the round is answered as it stands and the second triage runs.
    if (verdict.result.questions.length === 0) {
      deps.store.transaction(() => writeRoundAt(deps.store, key, { ...round, state: "answered", result: verdict.result, answers: [], glossaryDecisions: [], adrDecisions: [], answeredAt: new Date(deps.now()).toISOString(), closedByConsensus: true, lastInvalidReason: null }));
      await requestTriage(deps, run, write(deps, intake, "restating", { ...intake.body, call: null }));
      return;
    }
    write(deps, intake, "clarifying", { ...intake.body, call: null });
    return;
  }
  if (!finalFailure(failure) && round.retries < MAX_AUTO_RETRIES) {
    deps.store.transaction(() => writeRoundAt(deps.store, key, { ...round, retries: round.retries + 1, lastInvalidReason: verdict.reason }));
    await requestClarify(deps, run, intake);
    return;
  }
  deps.store.transaction(() => writeRoundAt(deps.store, key, { ...round, state: "failed", reasonCode: "clarify-output-invalid", lastInvalidReason: verdict.reason }));
  await skipClarify(deps, run, intake);
}

export type FeedbackClarifyAnswers = Array<{ id: string; kind: "recommended" } | { id: string; kind: "text"; text: string }>;

/**
 * §4.6: the person answers the feedback round (`flow-answer` with `feedback: messageSeq`), or agrees as it stands
 * (consensus: unanswered questions take their recommended answers). Then the second triage runs with the Q&A.
 */
export async function answerFeedbackClarify(deps: FlowDeps, target: { flowRunId: string; messageSeq: number }, answer: { roundNo: number; answers: FeedbackClarifyAnswers } | "consensus", by: string, via: string): Promise<void> {
  const run = loadRun(deps.store, target.flowRunId);
  const intake = getIntake(deps.store, target.flowRunId, target.messageSeq);
  const key = roundsKey(run, target.messageSeq);
  const round = latestRoundAt(deps.store, key);
  if (intake === null || intake.state !== "clarifying" || round === null || round.state !== "awaiting-answers") throw new FlowRefusal("flow-ask-closed", `feedback ${target.messageSeq}`);
  const questions = round.result!.questions;
  let answers: RoundBody["answers"];
  if (answer === "consensus") answers = questions.map((q) => ({ id: q.id, kind: "recommended" as const, text: q.recommendedAnswer }));
  else {
    const ids = answer.answers.map((a) => a.id);
    if (answer.roundNo !== round.roundNo || new Set(ids).size !== ids.length || ids.length !== questions.length || ids.some((id) => !questions.some((q) => q.id === id))) {
      throw new FlowRefusal("flow-answer-invalid", "answer every question of the round once");
    }
    answers = answer.answers.map((a) => ({ id: a.id, kind: a.kind, text: a.kind === "text" ? a.text : questions.find((q) => q.id === a.id)!.recommendedAnswer }));
  }
  const at = new Date(deps.now()).toISOString();
  deps.store.transaction(() => writeRoundAt(deps.store, key, { ...round, state: "answered", answers, glossaryDecisions: [], adrDecisions: [], answeredAt: at, closedByConsensus: answer === "consensus", by, via }));
  const qa = questions.map((q) => ({ question: q.question, answer: answers!.find((a) => a.id === q.id)!.text }));
  await requestTriage(deps, run, write(deps, intake, "restating", { ...intake.body, qa }));
  await advanceRun(deps, target.flowRunId);
}

// ----------------------------------------------------------------------------------------------------------- the pump

/**
 * The single call of an intake came back (the recording port's seam, or the pump reading `call.callResult`): judged
 * here. A call the intake no longer waits on is ignored.
 */
export async function completeIntakeCall(deps: FlowDeps, flowRunId: string, messageSeq: number, raw: unknown, failure: string | null): Promise<void> {
  const intake = getIntake(deps.store, flowRunId, messageSeq);
  const call = intake?.body.call ?? null;
  if (intake === null || call === null || !OPEN.has(intake.state)) return;
  const run = loadRun(deps.store, flowRunId);
  if (call.purpose === "clarify") await settleClarify(deps, run, intake, raw, failure);
  else await settleTriage(deps, run, intake, raw, failure);
}

/**
 * The first stage of every pass of a run that is not stopped (kernel.ts passRun): each open intake one step on --
 * locating, and judging a call that came back. True when anything moved. `ready ⇒ planned` is the boundary's (below).
 */
export async function advanceIntakes(deps: FlowDeps, run: LoadedRun): Promise<boolean> {
  for (const intake of listIntakes(deps.store, run.row.id)) {
    if (intake.state === "locating") { await locateIntake(deps, run, intake); return true; }
    const call = intake.body.call;
    const result = call?.callResult ?? null;
    if (result !== null && OPEN.has(intake.state)) { await completeIntakeCall(deps, run.row.id, intake.messageSeq, result.rawOutput, result.failure); return true; }
    // Review fix (minor 1): written but never sent (a crash between the two); one the port claimed is only marked sent.
    if (call != null && call.requested === false && OPEN.has(intake.state)) {
      if (call.runId !== null) write(deps, intake, intake.state, { ...intake.body, call: { ...call, requested: true } });
      else if (call.purpose === "clarify") await requestClarify(deps, run, intake, true);
      else await requestTriage(deps, run, intake, undefined, true);
      return true;
    }
  }
  return false;
}

/**
 * §4.2 `ready ⇒ planned`, at a whole-run boundary: each located anchor is located again against the current
 * composition; one that no longer locates exactly once sends the intake back to `needs-location` (null). Otherwise the
 * text each target's revision prompt takes (§4.5).
 */
export async function takeReadyIntake(deps: FlowDeps, run: LoadedRun, intake: IntakeRow): Promise<{ targets: string[]; text: string } | null> {
  // The person's drift is taken first, so the head re-verified against is what their folder says now.
  if (await driftBeforeExecution(deps, run.row.id)) run = loadRun(deps.store, run.row.id);
  const search = await searchSetOf(deps, run, intake.body.stepKey);
  const { results, ambiguousFiles, ok } = locateAll(intake.body, search);
  const body: IntakeBody = { ...intake.body, results, ambiguousFiles };
  if (!ok) { write(deps, intake, "needs-location", body); return null; }
  if (results.length > 0) write(deps, intake, "ready", body);
  return { targets: body.targets.map((t) => t.stepKey), text: feedbackTextOf(body) };
}

/** After the boundary's plan: each taken intake is `planned` with that plan's number. */
export function markPlanned(deps: FlowDeps, flowRunId: string, seqs: readonly number[], planNo: number): void {
  const at = deps.now();
  deps.store.transaction(() => {
    for (const seq of seqs) {
      const intake = getIntake(deps.store, flowRunId, seq);
      if (intake?.state === "ready") moveIntake(deps.store, flowRunId, seq, "ready", "planned", { ...intake.body, planNo }, at);
    }
  });
}

const ATTACHED_LINE = "The person attached screenshots (not available to you): ";
/** §4.5: the person's text, where it points, the restated feedback and the round's Q&A, the attachment ids. */
export function feedbackTextOf(body: IntakeBody): string {
  const lines = [body.text.trimEnd()];
  for (const r of body.results) {
    if (!("located" in r)) continue;
    const under = r.located.headingPath.length === 0 ? "" : ` under «${r.located.headingPath.join(" › ")}»`;
    lines.push(`Where: in \`${r.located.file}\`, paragraph ${r.located.paragraph}${under}: «${r.located.excerpt}»`);
  }
  if (body.restated !== null) lines.push(`Restated: ${body.restated}`);
  if (body.qa.length > 0) lines.push("The person's answers to a short clarifying round:", ...body.qa.map((qa) => `- Q: ${qa.question}\n  A: ${qa.answer}`));
  // §4.7: the screenshots are named by id here (the text a plan stores); a work prompt reads them as paths (feedbackForWork).
  if (body.attachments.length > 0) lines.push(`${ATTACHED_LINE}${body.attachments.join(", ")}`);
  return lines.join("\n");
}

/**
 * §4.7 as built after the human's choice (a) (spec §21 entry 4): a `work` execution that takes the feedback gets each
 * attachment as the absolute path of its stored file `$ORCA_CONTROL_DIR/flow-attachments/<id>` (outside the workspace,
 * so never committed). Only the last line `feedbackTextOf` wrote is rewritten, and only when every id on it is an
 * attachment id; every other kind (a single call) keeps the ids. A last line in exactly that format with valid ids is
 * rewritten whoever wrote it (the person could type one): the result is a path inside the store, nothing else.
 */
export function feedbackForWork(feedback: readonly string[], env: NodeJS.ProcessEnv): string[] {
  return feedback.map((text) => {
    const cut = text.lastIndexOf("\n");
    const last = text.slice(cut + 1);
    if (!last.startsWith(ATTACHED_LINE)) return text;
    const ids = last.slice(ATTACHED_LINE.length).split(", ");
    if (!ids.every((id) => ATTACHMENT_ID.test(id))) return text;
    return [text.slice(0, cut + 1) + "The person attached screenshots. Read each image file at its absolute path (outside your workspace; do not copy it into the workspace):",
      ...ids.map((id) => `- ${attachmentPath(env, id)}`)].join("\n");
  });
}

/** Whether an intake keeps the run from turning `done` (§4.2). */
export const hasBusyIntake = (store: ControlStore, flowRunId: string): boolean => listIntakes(store, flowRunId).some((i) => BUSY_INTAKE.has(i.state));
/** The intakes waiting on the person (`needsYou`, §4.2). */
export const waitingIntakes = (store: ControlStore, flowRunId: string): number => listIntakes(store, flowRunId).filter((i) => WAITING_INTAKE.has(i.state)).length;
