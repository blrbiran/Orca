/**
 * Flow engine spec §11.2, §14.2 (plans Tasks 12, 15): the `orca flow` commands. Settings write this project's layer, or
 * the global one with --global (each its own revision); locks are global only, one field at a time. The run verbs share
 * the `@flows` scope (revision 0): start, feedback, edits, commands and plan are any principal's; rerun, answer, effect,
 * pool and the settings are human-only -- a socket agent needs a person token (humanOnly.ts SOCKET_TIER) and a run Orca
 * dispatched is refused them. Gaps spec §13 (plan Task 9): feedback anchors, attachments and replacements; a feedback
 * round's answer; a plan step's include (token) or accept (open); skip, defer (a `proceed` needs the token), fill;
 * params; a clarify round's revision; the re-run question timeout and the param presets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveId } from "../resolve.js";
import type { CommandDef, PositionalDef, RevisionScope, WriteContext } from "../types.js";
import { text } from "./format.js";
import { file, invalid, list, str, verb } from "./verbs.js";

const GLOBAL = { name: "global", type: "boolean" as const, summary: "the global layer (every project without its own value) instead of this project's" };
const isGlobal = (c: WriteContext): boolean => c.args.flags.global === true;
const layerScope = (c: WriteContext): RevisionScope => (isGlobal(c) ? "orchestration" : "repository");
const layerRoute = async (c: WriteContext): Promise<string> => (isGlobal(c) ? "operator/flows/settings" : `repositories/${(await c.project()).repoId}/flows/settings`);
const FIELDS = "effects.local|effects.cost|effects.external|effects.irreversible|rerunReview|rerunAskTimeoutSeconds|roles|allowedSkillSources|budgets.tokensPerRun|paramDefaults.<template>.<param>";
const CLEAR_FIELDS = `${FIELDS}|paramDefaults`;
/** A command-line value as a param value: true/false and integers as such, anything else as text (the kernel checks its type). */
const scalar = (raw: string): string | number | boolean =>
  raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw;

/** `<field> <value>` as the nested `set` of the payload; JSON values for roles and allowedSkillSources. */
function setOf(c: WriteContext): Record<string, unknown> {
  const field = String(c.args.positionals.field);
  const raw = c.args.positionals.value;
  if (raw === undefined) throw invalid(`give a value for ${field}`);
  const value = String(raw);
  const [head, tail] = field.split(".");
  if (head === "effects" && tail !== undefined) return { effects: { [tail]: value } };
  if (field === "rerunReview") return { rerunReview: value };
  if (field === "rerunAskTimeoutSeconds") {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 1) throw invalid("rerunAskTimeoutSeconds wants a positive integer (seconds)");
    return { rerunAskTimeoutSeconds: seconds };
  }
  if (head === "paramDefaults") {
    const m = /^paramDefaults\.([a-z0-9][a-z0-9-]*)\.([a-zA-Z][a-zA-Z0-9_]*)$/.exec(field);
    if (m === null) throw invalid("a preset is paramDefaults.<template>.<param>");
    return { paramDefaults: { [m[1]!]: { [m[2]!]: scalar(value) } } };
  }
  if (field === "budgets.tokensPerRun") {
    const tokens = Number(value);
    if (!Number.isSafeInteger(tokens) || tokens < 1) throw invalid("budgets.tokensPerRun wants a positive integer");
    return { budgets: { tokensPerRun: tokens } };
  }
  if (field === "roles" || field === "allowedSkillSources") {
    try { return { [field]: JSON.parse(value) as unknown }; } catch { throw invalid(`${field} wants JSON`); }
  }
  throw invalid(`field wants ${FIELDS}`);
}

const RUN: PositionalDef = { name: "run", summary: "a flow run id (fr-…) or a unique prefix", required: true };
/** The run named on the command line, resolved against the panel's runs (a unique prefix will do). */
const runOf = async (c: WriteContext): Promise<string> =>
  resolveId("flow run", String(c.args.positionals.run), ((await c.read("flows")) as { runs: Array<{ flowRunId: string }> }).runs.map((r) => r.flowRunId));
/** `--param k=v` / `--set k=v`: true/false and integers as such, anything else as text (the kernel checks each against its type). */
function pairs(c: WriteContext, flag: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const pair of list(c, flag)) {
    const at = pair.indexOf("=");
    if (at < 1) throw invalid(`--${flag} wants key=value, got ${JSON.stringify(pair)}`);
    out[pair.slice(0, at)] = scalar(pair.slice(at + 1));
  }
  return out;
}
const run = (row: Omit<Parameters<typeof verb>[0], "domain" | "scope">): CommandDef => verb({ ...row, domain: "flow", scope: "flows" });
/** A `flow-message` of kind `command` on the whole run. */
const runCommand = (action: string, summary: string, body: (c: WriteContext) => Record<string, unknown>, extra: Partial<Parameters<typeof verb>[0]> = {}): CommandDef => run({
  action, summary, verb: "flow-message", positionals: [RUN], examples: [`orca flow ${action} fr-1234`], ...extra,
  route: () => "flows/messages",
  payload: async (c) => ({ runId: await runOf(c), kind: "command", target: { kind: "run" }, body: { command: action, ...body(c) } }),
});
/** `--step s` or `--execution s#n`: the message's target; neither is the whole run. */
function targetOf(c: WriteContext): Record<string, unknown> {
  const step = str(c, "step"), execution = str(c, "execution");
  if (step !== undefined && execution !== undefined) throw invalid("give --step or --execution, not both");
  if (execution !== undefined) {
    const m = /^([a-z0-9][a-z0-9-]*)#(\d+)$/.exec(execution);
    if (m === null) throw invalid("--execution wants <step>#<n>");
    return { kind: "execution", stepKey: m[1], seq: Number(m[2]) };
  }
  return step === undefined ? { kind: "run" } : { kind: "step", stepKey: step };
}
/** `--step s`: a mark command (skip, defer, fill) on that step. */
// Fix round 2 (re-review N2): a mark is taken at the next step boundary, so an `accepted` answer may still be rejected
// then (e.g. flow-effect-needs-person); the summary says to read the run.
const markCommand = (action: "skip" | "defer" | "fill", summary: string, body: (c: WriteContext) => Record<string, unknown>, extra: Partial<Parameters<typeof verb>[0]> = {}): CommandDef => run({
  action, summary: `${summary}; taken at the next step boundary, so read the run (orca flow journal) to see if it applied`, verb: "flow-message", positionals: [RUN], examples: [`orca flow ${action} fr-1234 --step cover`],
  flags: [{ name: "step", type: "string", required: true, summary: "the step (a work, draft, check or review step)" }], ...extra,
  route: () => "flows/messages",
  payload: async (c) => ({ runId: await runOf(c), kind: "command", target: { kind: "step", stepKey: str(c, "step")! }, body: { command: action, ...body(c) } }),
});
/** `--plan n`, else the plan running now (`include` and `accept` answer a step of the running plan). */
async function runningPlanNo(c: WriteContext, runId: string): Promise<number> {
  if (typeof c.args.flags.plan === "number") return c.args.flags.plan;
  const plan = ((await c.read(`flows/${runId}`)) as { plans: Array<{ planNo: number; state: string }> }).plans.filter((p) => p.state === "running").at(-1);
  if (plan === undefined) throw invalid(`run ${runId} has no plan running; a plan the person has not run yet is chosen with orca flow rerun`);
  return plan.planNo;
}
/** A plan step: `include` runs a step the plan asked about (spends: token); `accept` keeps its output for its new inputs. */
const planStepRow = (action: "include" | "accept", choice: "run" | "accept-unchanged", summary: string, access: "open" | "token"): CommandDef => run({
  action, summary, verb: "flow-plan-step", access, positionals: [RUN],
  flags: [{ name: "step", type: "string", required: true, summary: "the step" }, { name: "plan", type: "integer", summary: "the plan number (default: the running one)" }],
  examples: [`orca flow ${action} fr-1234 --step cover${access === "token" ? " --as-person" : ""}`],
  route: () => "flows/plan-step",
  payload: async (c) => {
    const runId = await runOf(c);
    return { runId, planNo: await runningPlanNo(c, runId), stepKey: str(c, "step")!, choice };
  },
});
/** Gaps spec §4.1, §4.7, §4.8: a feedback message's body -- anchors, attachments (uploaded first), a replacement, as-is. */
async function feedbackBody(c: WriteContext, runId: string): Promise<Record<string, unknown>> {
  const heading = str(c, "heading"), paragraph = c.args.flags.paragraph;
  const anchors: Array<Record<string, unknown>> = list(c, "quote").map((quote) => ({ quote }));
  if (heading !== undefined || typeof paragraph === "number") anchors.push({ ...(heading === undefined ? {} : { heading }), ...(typeof paragraph === "number" ? { paragraph } : {}) });
  const replaces = c.args.flags.replaces, hit = c.args.flags.hit;
  if (typeof hit === "number" && typeof replaces !== "number") throw invalid("--hit needs --replaces (it picks a hit of the replaced feedback)");
  const attachments: string[] = [];
  for (const path of list(c, "attach")) {
    let bytes: Buffer;
    try { bytes = readFileSync(resolve(c.io.cwd, path)); } catch (error) { throw invalid(`--attach: cannot read ${path}: ${(error as Error).message}`); }
    attachments.push(String((await c.upload(`flows/${runId}/attachments`, bytes) as { id: unknown }).id));
  }
  return {
    text: str(c, "text")!, ...(anchors.length === 0 ? {} : { anchors }), ...(attachments.length === 0 ? {} : { attachments }),
    ...(typeof replaces === "number" ? { replaces } : {}), ...(typeof hit === "number" ? { hit } : {}), ...(c.args.flags["as-is"] === true ? { asIs: true } : {}),
  };
}

/** The newest plan the person has not run yet (`orca flow rerun` without --plan). */
async function openPlanNo(c: WriteContext, runId: string): Promise<number> {
  const plans = ((await c.read(`flows/${runId}`)) as { plans: Array<{ planNo: number; state: string }> }).plans.filter((p) => p.state === "proposed");
  const plan = plans.at(-1);
  if (plan === undefined) throw invalid(`run ${runId} has no plan waiting to be run; orca flow plan ${runId} makes one`);
  return plan.planNo;
}

const RUN_ROWS: CommandDef[] = [
  run({ action: "start", summary: "start a flow from a built-in template on a folder (--pool needs a person token)", verb: "flow-start",
    positionals: [{ name: "template", summary: "a built-in template id (wechat-article), optionally builtin/<id>@<version>", required: true }],
    flags: [
      { name: "dir", type: "string", required: true, summary: "the folder the flow works on (it is imported into the vault; results are copied back)" },
      { name: "project", type: "string", summary: "a registered project this run belongs to (its settings layer)" },
      { name: "param", type: "string", repeatable: true, summary: "a template parameter as key=value (repeatable)" },
      { name: "clarify", type: "string", summary: "skip: record the idea as the brief without clarifying" },
      { name: "pool", type: "integer", humanOnly: true, summary: "the run's token pool (default: settings, then the template)" },
      { name: "unattended", type: "boolean", summary: "nobody answers asks: defaults are taken and recorded as decisions" },
    ],
    examples: ["orca flow start wechat-article --dir ~/posts/tea --param idea='Tea for engineers'"],
    route: () => "flows",
    payload: (c) => {
      const clarify = str(c, "clarify");
      if (clarify !== undefined && clarify !== "skip") throw invalid("--clarify takes only skip");
      const pool = c.args.flags.pool;
      return {
        template: String(c.args.positionals.template), dir: resolve(c.io.cwd, str(c, "dir")!), params: pairs(c, "param"),
        ...(str(c, "project") === undefined ? {} : { projectId: str(c, "project") }), ...(clarify === undefined ? {} : { clarify }),
        ...(typeof pool === "number" ? { pool } : {}), ...(c.args.flags.unattended === true ? { unattended: true } : {}),
      };
    } }),
  { domain: "flow", action: "list", summary: "every flow run with its template, state and pool", positionals: [], flags: [], access: "open",
    mapsTo: { kind: "read", paths: () => ["flows"] }, examples: ["orca flow list"], format: (body) => text(body) },
  { domain: "flow", action: "show", summary: "one flow run: steps with their active and newest execution, open asks, plans, effect records, decisions",
    positionals: [RUN], flags: [], access: "open", mapsTo: { kind: "read", paths: async (c) => [`flows/${await runOf(c)}`] },
    examples: ["orca flow show fr-1234"], format: (body) => text(body) },
  { domain: "flow", action: "journal", summary: "one flow run's every execution and message", positionals: [RUN], flags: [], access: "open",
    mapsTo: { kind: "read", paths: async (c) => [`flows/${await runOf(c)}/journal`] }, examples: ["orca flow journal fr-1234"], format: (body) => text(body) },
  run({ action: "feedback", summary: "feedback on the run, a step or one execution: code locates the passage, the model picks the steps that take it, a plan says what re-runs", verb: "flow-message",
    positionals: [RUN],
    flags: [{ name: "step", type: "string", summary: "the step it is about (default: the whole run)" }, { name: "execution", type: "string", summary: "<step>#<n>: one execution" },
      { name: "quote", type: "string", repeatable: true, summary: "a passage as it reads in the article (repeatable; each is one anchor)" },
      { name: "heading", type: "string", summary: "the heading the passage is under (one anchor with --paragraph)" },
      { name: "paragraph", type: "integer", summary: "the paragraph number (under --heading, else in the article)" },
      { name: "attach", type: "string", repeatable: true, summary: "a png, jpg or webp screenshot (repeatable, at most 4); uploaded first" },
      { name: "replaces", type: "integer", summary: "the message number of earlier feedback this replaces (before its plan ran)" },
      { name: "hit", type: "integer", summary: "with --replaces: pick hit k of that feedback's locations" },
      { name: "as-is", type: "boolean", summary: "use my words as they are: no clarify round" },
      { name: "text", type: "string", required: true, summary: "the feedback" }],
    examples: ["orca flow feedback fr-1234 --step voice --text 'warmer, please'", "orca flow feedback fr-1234 --quote 'Tea slows you down' --text 'too slow here'",
      "orca flow feedback fr-1234 --replaces 7 --hit 2 --text 'this one'"],
    route: () => "flows/messages",
    payload: async (c) => {
      const runId = await runOf(c);
      return { runId, kind: "feedback", target: targetOf(c), body: await feedbackBody(c, runId) };
    } }),
  run({ action: "edit", summary: "the person's own output for a step (record fields, or workspace files); the step is not re-run", verb: "flow-message",
    positionals: [RUN],
    flags: [{ name: "step", type: "string", required: true, summary: "the step whose output this is" },
      { name: "file", type: "string", summary: "a JSON document {\"record\":{…}} or {\"files\":{\"<path>\":\"<text>\"}}" },
      { name: "set", type: "string", repeatable: true, summary: "a record field as key=value (repeatable)" }],
    examples: ["orca flow edit fr-1234 --step pick-title --set title='Tea, slowly'"],
    route: () => "flows/messages",
    payload: async (c) => {
      const doc = file(c) as Record<string, unknown> | undefined;
      const set = list(c, "set");
      if ((doc === undefined) === (set.length === 0)) throw invalid("give --file or --set");
      return { runId: await runOf(c), kind: "edit", target: { kind: "step", stepKey: str(c, "step")! }, body: doc ?? { record: pairs(c, "set") } };
    } }),
  run({ action: "plan", summary: "compute and propose a re-run plan from what changed (spends one single call)", verb: "flow-plan",
    positionals: [RUN], examples: ["orca flow plan fr-1234"], route: () => "flows/plan", payload: async (c) => ({ runId: await runOf(c) }) }),
  run({ action: "rerun", summary: "run the open plan: its candidates minus the skips (default: the model's proposed skips) plus additions; needs a person token",
    verb: "flow-rerun", access: "token", positionals: [RUN],
    flags: [{ name: "skip", type: "string", summary: "steps not to run, comma separated (replaces the proposal's skips)" },
      { name: "add", type: "string", summary: "non-candidate steps to run too, comma separated" }, { name: "plan", type: "integer", summary: "the plan number (default: the open one)" }],
    examples: ["orca flow rerun fr-1234 --skip cover,pick-title --as-person"],
    route: () => "flows/rerun",
    payload: async (c) => {
      const runId = await runOf(c);
      const csv = (flag: string): string[] | undefined => (str(c, flag) === undefined ? undefined : str(c, flag)!.split(",").map((s) => s.trim()).filter((s) => s !== ""));
      const skip = csv("skip"), add = csv("add");
      const planNo = typeof c.args.flags.plan === "number" ? c.args.flags.plan : await openPlanNo(c, runId);
      return { runId, planNo, ...(skip === undefined ? {} : { skip }), ...(add === undefined ? {} : { add }) };
    } }),
  run({ action: "discard-plan", summary: "withdraw the open plan instead of running it: nothing re-runs, the feedback that made it is excluded; needs a person token",
    verb: "flow-rerun", access: "token", positionals: [RUN],
    flags: [{ name: "plan", type: "integer", summary: "the plan number (default: the open one)" }],
    examples: ["orca flow discard-plan fr-1234 --as-person"],
    route: () => "flows/rerun",
    payload: async (c) => {
      const runId = await runOf(c);
      return { runId, planNo: typeof c.args.flags.plan === "number" ? c.args.flags.plan : await openPlanNo(c, runId), discard: true };
    } }),
  runCommand("rewind", "move a step's active output back (to execution n, or to not run); later messages are re-applied unless excluded",
    (c) => {
      const to = str(c, "to")!;
      const m = /^([a-z0-9][a-z0-9-]*)(?:#(\d+))?$/.exec(to);
      if (m === null) throw invalid("--to wants <step> or <step>#<n>");
      const exclude = list(c, "exclude").map(Number);
      if (exclude.some((n) => !Number.isSafeInteger(n) || n < 1)) throw invalid("--exclude wants message numbers");
      return { toStep: m[1], ...(m[2] === undefined ? {} : { toSeq: Number(m[2]) }), ...(exclude.length === 0 ? {} : { exclude }) };
    },
    { flags: [{ name: "to", type: "string", required: true, summary: "<step> or <step>#<n>" }, { name: "exclude", type: "string", repeatable: true, summary: "a later message number not to re-apply" }],
      examples: ["orca flow rewind fr-1234 --to draft#1"] }),
  run({ action: "revise", summary: "revise an answered round of a flow clarify step; later rounds are asked again from it", verb: "flow-message", positionals: [RUN],
    flags: [{ name: "step", type: "string", required: true, summary: "the clarify step" }, { name: "round", type: "integer", required: true, summary: "the round number" },
      { name: "file", type: "string", required: true, summary: "a JSON document {\"answers\":[…],\"glossaryDecisions\":[…],\"adrDecisions\":[…],\"reason\"?:…,\"exclude\"?:[…]}" }],
    examples: ["orca flow revise fr-1234 --step brief --round 1 --file revise.json"],
    route: () => "flows/messages",
    payload: async (c) => {
      const round = c.args.flags.round;
      if (typeof round !== "number" || round < 1) throw invalid("--round wants a round number");
      return { runId: await runOf(c), kind: "edit", target: { kind: "round", stepKey: str(c, "step")!, roundNo: round }, body: file(c) as Record<string, unknown> };
    } }),
  planStepRow("include", "run", "run a step the running plan asks about (it spends); needs a person token", "token"),
  planStepRow("accept", "accept-unchanged", "accept a step of the running plan as unchanged: its output stands for its new inputs (what the timeout does)", "open"),
  markCommand("skip", "skip a step in this run until filled: later steps go on without its output", () => ({})),
  markCommand("defer", "defer a step (fill it later): later steps go on without its output; external effects after it wait unless --effects <step>=proceed (proceed needs a person token)",
    (c) => {
      const effects: Record<string, string> = {};
      for (const pair of list(c, "effects")) {
        const m = /^([a-z0-9][a-z0-9-]*)=(proceed|wait)$/.exec(pair);
        if (m === null) throw invalid(`--effects wants <step>=proceed|wait, got ${JSON.stringify(pair)}`);
        effects[m[1]!] = m[2]!;
      }
      return Object.keys(effects).length === 0 ? {} : { effects };
    },
    { flags: [{ name: "step", type: "string", required: true, summary: "the step (a work, draft, check or review step)" },
      { name: "effects", type: "string", repeatable: true, summary: "<effect step>=proceed|wait for an external effect after it (default wait; proceed needs a person token)" }],
      examples: ["orca flow defer fr-1234 --step cover", "orca flow defer fr-1234 --step cover --effects to-draft-box=proceed --as-person"] }),
  markCommand("fill", "fill a skipped or deferred step: a plan re-runs it and what depends on it", () => ({})),
  run({ action: "params", summary: "change the run's params mid-run (values folder-relative); changed steps become plan candidates", verb: "flow-message", positionals: [RUN],
    flags: [{ name: "set", type: "string", repeatable: true, required: true, summary: "a param as key=value (repeatable)" }],
    examples: ["orca flow params fr-1234 --set coverImage=covers/tea.png"],
    route: () => "flows/messages",
    payload: async (c) => ({ runId: await runOf(c), kind: "command", target: { kind: "run" }, body: { command: "params", set: pairs(c, "set") } }) }),
  runCommand("pause", "pause the run at its next step boundary (a running step is never interrupted)", () => ({})),
  runCommand("resume", "resume a paused run", () => ({})),
  runCommand("stop", "stop the run for good at its next step boundary", () => ({})),
  run({ action: "retry", summary: "run a failed step again (an effect step's retry makes a new effect record)", verb: "flow-message", positionals: [RUN],
    flags: [{ name: "step", type: "string", required: true, summary: "the failed step" }], examples: ["orca flow retry fr-1234 --step to-draft-box"],
    route: () => "flows/messages",
    payload: async (c) => ({ runId: await runOf(c), kind: "command", target: { kind: "step", stepKey: str(c, "step")! }, body: { command: "retry" } }) }),
  runCommand("repin", "move the run to another version of its template (changed steps become plan candidates)",
    (c) => ({ version: c.args.flags.version }),
    { flags: [{ name: "version", type: "integer", required: true, summary: "the template version" }], examples: ["orca flow repin fr-1234 --version 2"] }),
  run({ action: "answer", summary: "answer a step that waits for the person (an ask's form, a step's question, a clarify round, or consensus) or a feedback's clarify round; needs a person token",
    verb: "flow-answer", access: "token",
    positionals: [RUN, { name: "step", summary: "the waiting step (not with --feedback)", required: false }],
    flags: [
      { name: "feedback", type: "integer", summary: "the message number of feedback whose clarify round waits (with --file or --consensus)" },
      { name: "set", type: "string", repeatable: true, summary: "an ask's form field as key=value (repeatable)" },
      { name: "file", type: "string", summary: "an ask's form values as a JSON object; with --feedback, {\"answers\":[{\"id\":…,\"kind\":\"recommended\"|\"text\",\"text\"?:…}]}" },
      { name: "text", type: "string", summary: "the answer to the question the step asked (flow.needs)" },
      { name: "answer", type: "string", repeatable: true, summary: "clarify: <question id> (take the recommended answer) or <id>=<text>" },
      { name: "glossary", type: "string", repeatable: true, summary: "clarify: <entry id>=accept|reject" },
      { name: "adr", type: "string", repeatable: true, summary: "clarify: <adr id>=accept|reject" },
      { name: "consensus", type: "boolean", summary: "clarify: agree with the brief as it stands" },
    ],
    examples: ["orca flow answer fr-1234 pick-title --set title='Tea, slowly' --as-person", "orca flow answer fr-1234 article --text plain --as-person",
      "orca flow answer fr-1234 --feedback 7 --consensus --as-person"],
    route: () => "flows/answer",
    payload: async (c) => {
      const runId = await runOf(c);
      const feedback = c.args.flags.feedback;
      if (typeof feedback === "number") {
        if (c.args.positionals.step !== undefined) throw invalid("give the waiting step or --feedback, not both");
        if (c.args.flags.consensus === true) return { runId, feedback, consensus: true };
        const doc = file(c) as { answers?: unknown } | undefined;
        if (doc === undefined || !Array.isArray(doc.answers)) throw invalid("--feedback wants --consensus, or --file with {\"answers\":[…]}");
        const intake = ((await c.read(`flows/${runId}`)) as { intakes?: Array<{ messageSeq: number; clarify?: { roundNo: number } | null }> }).intakes?.find((i) => i.messageSeq === feedback);
        const roundNo = intake?.clarify?.roundNo;
        if (roundNo === undefined) throw invalid(`feedback ${feedback} has no clarify round waiting`);
        return { runId, feedback, clarify: { roundNo, answers: doc.answers, glossaryDecisions: [], adrDecisions: [] } };
      }
      if (c.args.positionals.step === undefined) throw invalid("give the waiting step, or --feedback <message number>");
      const stepKey = String(c.args.positionals.step);
      const decide = (flag: string) => list(c, flag).map((pair) => {
        const [id, verdict] = pair.split("=");
        if (id === undefined || (verdict !== "accept" && verdict !== "reject")) throw invalid(`--${flag} wants <id>=accept|reject`);
        return { id, accept: verdict === "accept" };
      });
      if (list(c, "answer").length > 0 || list(c, "glossary").length > 0 || list(c, "adr").length > 0) {
        // A waiting clarify round is on its step's latest execution; the view's openAsks never lists clarify rounds.
        const view = (await c.read(`flows/${runId}`)) as { steps?: Array<{ stepKey: string; latest?: { state?: string; ask?: { kind?: string; roundNo?: number } } | null }> };
        const latest = view.steps?.find((s) => s.stepKey === stepKey)?.latest;
        const roundNo = latest?.state === "needs-person" && latest.ask?.kind === "clarify-round" ? latest.ask.roundNo : undefined;
        if (roundNo === undefined) throw invalid(`step ${stepKey} has no clarify round waiting`);
        const answers = list(c, "answer").map((pair) => {
          const at = pair.indexOf("=");
          return at === -1 ? { id: pair, kind: "recommended" } : { id: pair.slice(0, at), kind: "text", text: pair.slice(at + 1) };
        });
        return { runId, stepKey, clarify: { roundNo, answers, glossaryDecisions: decide("glossary"), adrDecisions: decide("adr") } };
      }
      if (c.args.flags.consensus === true) return { runId, stepKey, consensus: true };
      if (str(c, "text") !== undefined) return { runId, stepKey, text: str(c, "text")! };
      const values = (file(c) as Record<string, string | number | boolean> | undefined) ?? (list(c, "set").length > 0 ? pairs(c, "set") : undefined);
      if (values === undefined) throw invalid("give --set/--file (an ask), --text (a question), --answer… (a clarify round) or --consensus");
      return { runId, stepKey, values };
    } }),
  ...(["confirm", "enact", "discard"] as const).map((action) => run({
    action: `effect ${action}`, summary: action === "discard" ? "discard a staged effect record: the step never runs (needs a person token)"
      : action === "confirm" ? "confirm an effect card: its step runs now (needs a person token)" : "enact a staged effect record: its step runs now (needs a person token)",
    verb: "flow-effect", access: "token", positionals: [{ name: "record", summary: "the effect record id (eff-…)", required: true }],
    examples: [`orca flow effect ${action} eff-1234 --as-person`],
    route: () => "flows/effect", payload: (c) => ({ recordId: String(c.args.positionals.record), action }),
  })),
  run({ action: "pool raise", summary: "raise a run's token pool; steps parked on an exhausted pool start again (needs a person token)", verb: "flow-pool", access: "token",
    positionals: [RUN], flags: [{ name: "tokens", type: "integer", required: true, summary: "how many tokens to add" }],
    examples: ["orca flow pool raise fr-1234 --tokens 500000 --as-person"], route: () => "flows/pool",
    payload: async (c) => {
      const tokens = c.args.flags.tokens;
      if (typeof tokens !== "number" || tokens < 1) throw invalid("--tokens wants a positive integer");
      return { runId: await runOf(c), raiseTokens: tokens };
    } }),
];

export const FLOW_ROWS: CommandDef[] = [
  {
    domain: "flow", action: "settings show", summary: "the effective flow settings of this project (or --global): each value, where it comes from, and its lock",
    positionals: [], flags: [GLOBAL], access: "open",
    mapsTo: { kind: "read", paths: async (c) => [isGlobal(c) ? "flows/settings" : `flows/settings?repoId=${encodeURIComponent((await c.project()).repoId)}`] },
    examples: ["orca flow settings show", "orca flow settings show --global"], format: (body) => text(body),
  },
  verb({ domain: "flow", action: "settings set", summary: "set one flow setting in this project (or --global); needs a person token",
    verb: "set-flow-settings", scope: layerScope, access: "token",
    positionals: [{ name: "field", summary: FIELDS, required: true }, { name: "value", summary: "a level (apply-flag|confirm|stage-only|follow-template), auto|review, an integer, JSON, or a preset's value", required: true }],
    flags: [GLOBAL],
    examples: ["orca flow settings set effects.external confirm --as-person", "orca flow settings set budgets.tokensPerRun 1000000 --global --as-person",
      "orca flow settings set rerunAskTimeoutSeconds 600 --global --as-person", "orca flow settings set paramDefaults.wechat-article.coverImage /covers/tea.png --global --as-person"],
    route: layerRoute, payload: (c) => ({ set: setOf(c), clear: [] }) }),
  verb({ domain: "flow", action: "settings clear", summary: "remove flow settings from this project (or --global) so the next layer applies; needs a person token",
    verb: "set-flow-settings", scope: layerScope, access: "token",
    positionals: [{ name: "field", summary: CLEAR_FIELDS, required: true, variadic: true }], flags: [GLOBAL],
    examples: ["orca flow settings clear effects.cost rerunReview --as-person", "orca flow settings clear paramDefaults.wechat-article.coverImage --global --as-person"],
    route: layerRoute,
    payload: (c) => {
      const fields = c.args.positionals.field;
      return { set: {}, clear: [...new Set(Array.isArray(fields) ? fields : [String(fields)])] };
    } }),
  ...(["lock", "unlock"] as const).map((action) => verb({
    domain: "flow", action: `settings ${action}`, summary: `${action} one global flow setting (needs a person token): a locked field may only be tightened in a project`,
    verb: "set-flow-locks", scope: "orchestration", access: "token",
    positionals: [{ name: "field", summary: "effects.<class>|allowedSkillSources|budgets.tokensPerRun", required: true }],
    examples: [`orca flow settings ${action} effects.irreversible --as-person`],
    route: () => "operator/flows/locks",
    // The verb takes the whole list: the one field added to (or taken from) the global layer's current locks.
    payload: async (c) => {
      const field = String(c.args.positionals.field);
      const current = ((await c.read("flows/settings")) as { locks?: string[] }).locks ?? [];
      const next = action === "lock" ? [...new Set([...current, field])] : current.filter((f) => f !== field);
      return { locks: next.sort() };
    } })),
  ...RUN_ROWS,
];
