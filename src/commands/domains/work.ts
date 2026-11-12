/**
 * CLI v2 plan Task 4: requirement, group and task writes (spec §4 table; plan "Control verbs → commands"). Every pin
 * (round and draft numbers, draft hash, proposal version, plan hash, profile hashes, selections hash, base versions, the
 * run a retry acts on) is filled from a read made in this invocation.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, WriteContext } from "../types.js";
import {
  checkpointOf, type ClarifyRoundView, config, contextHandoffLines, currentRun, file, fillRoundAnswer, fundingLines, instructionLines, group, GROUP, groupView, invalid, json, list, newGroupId, profileBinding, str, task, TASK, unestimatedLines, verb, workItem,
} from "./verbs.js";
import { SCHEME_FLAGS, schemeFromFlags } from "./settings.js";
import { SYSTEM_LABELS } from "../../control/labels.js";
import { text } from "./format.js";

/**
 * #226 (ii): a note for a continued task's run -- delivered at its plan and execute boundary as the start envelope's
 * `work.operatorNote` (live transcript spec §10.5.2; ccloop's operatorNoteGate). Never injected into a running turn.
 */
const NOTE_SCOPES = ["next-attempt", "remaining-attempts"] as const;
const NOTE_FLAGS = [
  { name: "note", type: "string" as const, summary: "a note the continued run's agent reads at its next plan/execute (at most 4096 bytes)" },
  { name: "note-scope", type: "string" as const, summary: "next-attempt (default) or remaining-attempts" },
];
function operatorNote(c: WriteContext): { text: string; scope: typeof NOTE_SCOPES[number] } | undefined {
  const note = str(c, "note");
  const scope = str(c, "note-scope");
  if (note === undefined) {
    if (scope !== undefined) throw invalid("--note-scope goes with --note");
    return undefined;
  }
  if (note.trim() === "") throw invalid("--note is empty");
  if (Buffer.byteLength(note, "utf8") > 4096) throw invalid(`--note is ${Buffer.byteLength(note, "utf8")} bytes; at most 4096`);
  if (scope !== undefined && !(NOTE_SCOPES as readonly string[]).includes(scope)) throw invalid(`--note-scope wants ${NOTE_SCOPES.join(" or ")}`);
  return { text: note, scope: (scope ?? "next-attempt") as typeof NOTE_SCOPES[number] };
}

type RoundView = ClarifyRoundView;
interface RequirementView {
  summary: { archived?: boolean; requirement?: { roundNo: number | null; draftNo: number | null } };
  rounds?: RoundView[]; drafts: Array<{ draftNo: number; draftHash: string | null }>;
}
const requirement = async (c: WriteContext): Promise<RequirementView> => await c.read(`groups/${group(c)}/requirement`) as RequirementView;
/**
 * Issue #132: a pin this CLI cannot fill is refused here, before the panel's archive gate could answer. On an archived
 * group that refusal names the archive (the panel's own code), not the missing round or draft.
 */
function missing(c: WriteContext, view: RequirementView, code: string, message: string): EntryRejection {
  if (view.summary.archived === true) return new EntryRejection("group-archived", `${group(c)} is archived; orca group unarchive ${group(c)} first`);
  return new EntryRejection(code, message);
}
async function roundNo(c: WriteContext): Promise<number> {
  return (await currentRound(c)).roundNo;
}
/** The current round's number and, when the view holds it, its row (state and result). */
async function currentRound(c: WriteContext): Promise<{ roundNo: number; row: RoundView | undefined }> {
  const view = await requirement(c);
  const round = view.summary.requirement?.roundNo ?? null;
  if (round === null) throw missing(c, view, "requirement-no-round", `${group(c)} has no clarification round`);
  return { roundNo: round, row: view.rounds?.find((r) => r.roundNo === round) };
}
/** #231: the named answers and decisions, filled to the whole round as the Web's defaults (fillRoundAnswer). */
function filledAnswer(c: WriteContext, round: RoundView | undefined) {
  return fillRoundAnswer(round, {
    answers: list(c, "answer").map((value) => {
      const at = value.indexOf("=");
      return at === -1 ? { id: value, kind: "recommended" as const } : { id: value.slice(0, at), kind: "text" as const, text: value.slice(at + 1) };
    }),
    glossaryDecisions: list(c, "glossary").map((v) => decision(v, "glossary")), adrDecisions: list(c, "adr").map((v) => decision(v, "adr")),
  });
}
/**
 * Tester follow-up B T3 (#240): consensus on a round still awaiting answers is the panel's rule (spec §11.1 item 3), and it
 * drops that round's glossary entries and ADRs from the document. The Web confirms it first (Issue 88); the CLI refuses it
 * unless --unanswered says the person means it.
 */
function unansweredRefusal(roundNo: number, round: RoundView | undefined): EntryRejection | null {
  if (round?.state !== "awaiting-answers" || round.result === undefined || round.result === null) return null;
  const { questions, glossary, adrs } = round.result;
  return new EntryRejection("requirement-round-unanswered", `round ${roundNo} has ${questions.length} unanswered question(s); consensus now closes it unanswered and drops its ${glossary.length} glossary entr${glossary.length === 1 ? "y" : "ies"} and ${adrs.length} ADR(s) from the document. Answer it (orca requirement answer), or pass --unanswered to agree as it stands`);
}
/** #231: the panel's answer-set refusal (`group-state-invalid:<kind>:missing=…;extra=…`), one readable line per kind. */
function answerSetHint(error: { code: string; message: string }): string | undefined {
  if (error.code !== "group-state-invalid") return undefined;
  const lines = error.message.replace(/^group-state-invalid:/, "").split("|").flatMap((part) => {
    const match = /^(answers|glossary-decisions|adr-decisions):(.+)$/.exec(part);
    if (match === null) return [];
    const ids = Object.fromEntries(match[2]!.split(";").map((field) => field.split("=") as [string, string]));
    return [`${match[1]}: ${["missing", "extra", "duplicate"].filter((k) => ids[k] !== undefined).map((k) => `${k} ${ids[k]!.split(",").join(", ")}`).join("; ")}`];
  });
  return lines.length === 0 ? undefined : `the round's ids do not match (orca requirement show lists them): ${lines.join(" | ")}`;
}
async function latestDraft(c: WriteContext): Promise<{ draftNo: number; draftHash: string | null }> {
  const view = await requirement(c);
  const draftNo = view.summary.requirement?.draftNo ?? null;
  const draft = draftNo === null ? undefined : view.drafts.find((d) => d.draftNo === draftNo);
  if (draft === undefined) throw missing(c, view, "requirement-no-draft", `${group(c)} has no draft`);
  return draft;
}
const decision = (value: string, flag: string): { id: string; accept: boolean } => {
  const at = value.lastIndexOf("=");
  const verdict = value.slice(at + 1);
  if (at <= 0 || (verdict !== "accept" && verdict !== "reject")) throw invalid(`--${flag} wants <id>=accept|reject, got ${JSON.stringify(value)}`);
  return { id: value.slice(0, at), accept: verdict === "accept" };
};

const empty = (domain: string, action: string, summary: string, verbName: Parameters<typeof verb>[0]["verb"], path: string): CommandDef =>
  verb({ domain, action, summary, verb: verbName, positionals: [GROUP], route: (c) => `groups/${group(c)}/${path}`, payload: () => ({}) });

/**
 * Review-exit spec 2026-11-05 §3.4 (D4): a start (or a never-started group's resume) answered `queued-for-slot` says so in
 * one line; every other answer prints as before.
 */
const queuedFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; ahead?: unknown } } | null)?.result;
  return result?.kind === "queued-for-slot" ? `queued: ${String(result.ahead)} ahead; it starts when a slot frees (orca orchestration show)` : row.format(body);
} });

/**
 * Tester follow-up E §7 (#251): an answer that queued the next round says so and names --finish (the tester did not
 * know the round they answered was not the last); one that closed clarification says the split is next.
 */
const answeredFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; roundNo?: unknown; nextRoundNo?: unknown; finished?: unknown } } | null)?.result;
  const printed = row.format(body);
  if (result?.kind !== "requirement-answered") return printed;
  if (result.finished === true) {
    // Tester #272 (3): after --finish an agent ran `requirement consensus` by habit and was refused; say what is next.
    const next = answeredGroup === null ? [] : [`next: no consensus is needed; when draft 1 is awaiting review (orca requirement show ${answeredGroup}), orca requirement accept ${answeredGroup}`];
    return [`${printed}\nclarification closed at round ${String(result.roundNo)} with these answers; draft 1 is drafting`, ...next].join("\n");
  }
  return typeof result.nextRoundNo === "number" ? `${printed}\nround ${result.nextRoundNo} is now drafting; use --finish to stop after a round` : printed;
}, jsonBody: (body) => {
  // Tester #272 (3), only-add: a finished answer's --json body names the next command.
  const result = (body as { result?: { kind?: unknown; finished?: unknown } } | null)?.result;
  return result?.kind === "requirement-answered" && result.finished === true && answeredGroup !== null ? { ...(body as object), next: `orca requirement accept ${answeredGroup}` } : body;
} });
/** The group `requirement answer` answered, for its output's next step (one command per CLI process). */
let answeredGroup: string | null = null;

/**
 * #251: the panel refuses consensus (`group-state-invalid:round-state`) while the latest round is drafting -- the round
 * a plain answer queued. Name it and --finish, read from the requirement view; any other refusal gets no hint.
 */
async function consensusHint(error: { code: string; message: string }, c?: WriteContext): Promise<string | undefined> {
  // Tester #272 (3): consensus after `answer --finish` (or a second consensus) is refused by design; name what is next.
  if (error.code === "group-state-invalid" && /(^|:)consensus-reached$/.test(error.message) && c !== undefined) {
    return `clarification is already closed (answer --finish or an earlier consensus closed it), so no consensus is needed: when the split draft is awaiting review (orca requirement show ${group(c)}), orca requirement accept ${group(c)}, or ask for changes with orca requirement feedback ${group(c)} --text '<what to change>'`;
  }
  if (error.code !== "group-state-invalid" || !/(^|:)round-state$/.test(error.message) || c === undefined) return undefined;
  const view = await requirement(c);
  const roundNo = view.summary.requirement?.roundNo ?? null;
  const round = view.rounds?.find((r) => r.roundNo === roundNo);
  return round?.state === "drafting"
    ? `round ${roundNo} is drafting (the round your last answer queued); wait for it and agree then, or answer with --finish next time to stop clarifying after a round`
    : undefined;
}

/**
 * Issue #144(d)/#140 (dogfood run 3, session 86352010): the result line is cut at 160 characters, which hid a blocked
 * estimate's state and reason. Import and estimate print both on their own lines after it; their JSON is unchanged. The
 * import result names the reason `estimateReasonCode` (planImport.ts), the estimate result `reasonCode`.
 */
const estimateFormat = (row: CommandDef, reasonField: "estimateReasonCode" | "reasonCode"): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: Record<string, unknown> } | null)?.result;
  if (result === undefined || result === null || typeof result.estimateState !== "string") return row.format(body);
  const reason = result[reasonField];
  const next = result.kind === "imported" && typeof result.groupId === "string"
    ? `\nnext: inspect the imported group's agent selections and budgets before confirmation (panel overrides are not copied): orca control get groups/${result.groupId}/agent-preview; orca proposal show ${result.groupId}`
    : "";
  return `${row.format(body)}\nestimate: ${result.estimateState}\nreason: ${typeof reason === "string" ? reason : "none"}${next}`;
} });

/**
 * Tester follow-up F §4 (#173): the older-estimate-instruction warning (instructionLines) the payload of `group estimate`
 * or `group confirm` found, for --json: the answer's body gains `warnings` (only-add; absent when there is none).
 */
let instructionWarnings: string[] = [];
const withWarnings = (row: CommandDef): CommandDef => ({ ...row, jsonBody: (body) => {
  const warnings = instructionWarnings; instructionWarnings = [];
  return warnings.length === 0 || typeof body !== "object" || body === null ? body : { ...body, warnings };
} });

/** #224: the lines a row's payload left for its human output, after what the row prints (one command per CLI process). */
let estimateNote: string[] = [];
const withNote = (take: () => string[], row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const lines = take(), printed = row.format(body);
  return lines.length === 0 ? printed : `${printed}\n${lines.join("\n")}`;
} });

export const WORK_ROWS: CommandDef[] = [
  // --- requirement
  verb({ domain: "requirement", action: "open", summary: "open a requirement from an idea; the group id is generated unless --group names one", verb: "requirement-open",
    flags: [
      { name: "idea", type: "string", required: true, summary: "what to build" }, { name: "group", type: "string", summary: "the new group's id" },
      { name: "language", type: "string", summary: "en|zh: the requirement's content language" },
      { name: "limit", type: "string", humanOnly: true, summary: "the requirement's budget as JSON {tokens,activeMs,attempts,sessions}" },
      // Issue #143: the Web's agent picker (RequirementsPanel.tsx) sends payload.agent; the CLI could not.
      { name: "agent", type: "string", summary: "the installation that runs this requirement's agent calls (orca agent list); default: your agent preferences" },
    ],
    scopeId: (c) => newGroupIdOnce(c), route: () => "requirements",
    payload: async (c) => ({
      groupId: newGroupIdOnce(c), repoId: (await c.project()).repoId, idea: str(c, "idea"),
      ...(str(c, "language") === undefined ? {} : { contentLanguage: str(c, "language") }), ...(str(c, "limit") === undefined ? {} : { limit: json(c, "limit") }),
      ...(str(c, "agent") === undefined ? {} : { agent: { agent: str(c, "agent") } }),
    }),
    hint: async (error, c) => {
      if (error.code !== "agent-selection-rejected" || !error.message.startsWith("estimator:agent-unselected")) return undefined;
      const generic = "no agent is selected: pass --agent <installation> (see orca agent list), or set a defaultAgent with orca agent set-preferences";
      // Tester follow-up E §7 (#246): with no defaultAgent and exactly one perAgent entry, name that installation.
      let prefs: { defaultAgent?: unknown; perAgent?: unknown } | undefined;
      try { prefs = c === undefined ? undefined : (await c.read("operator/agent-preferences") as { preferences?: typeof prefs }).preferences; }
      catch { return generic; }
      const perAgent = prefs?.perAgent !== null && typeof prefs?.perAgent === "object" ? Object.keys(prefs.perAgent) : [];
      return prefs?.defaultAgent === undefined && perAgent.length === 1
        ? `no agent is selected: pass --agent ${perAgent[0]} (the one installation your agent preferences configure), or set a defaultAgent with orca agent set-preferences`
        : generic;
    },
    examples: ["orca requirement open --idea \"add a dark mode\"", "orca requirement open --idea \"add a dark mode\" --agent claude-main"] }),
  answeredFormat(verb({ domain: "requirement", action: "answer", summary: "answer the current round: --answer <qid> takes the recommendation, --answer <qid>=<text> answers in words; a question not named takes its recommendation and a glossary entry or ADR not named is accepted, as the Web's defaults",
    verb: "requirement-answer", positionals: [GROUP],
    flags: [
      { name: "answer", type: "string", repeatable: true, summary: "<questionId> or <questionId>=<text>" },
      { name: "glossary", type: "string", repeatable: true, summary: "<id>=accept|reject" }, { name: "adr", type: "string", repeatable: true, summary: "<id>=accept|reject" },
      // Tester follow-up E §7 (#251).
      { name: "finish", type: "boolean", summary: "close clarification with these answers: no next round is drafted, and the split is drafted from this round (no requirement consensus follows; the answer names the next command, under --json as `next`)" },
    ],
    route: (c) => `groups/${group(c)}/requirement/answer`,
    payload: async (c) => {
      const round = await currentRound(c);
      answeredGroup = group(c);
      return { roundNo: round.roundNo, ...filledAnswer(c, round.row), ...(c.args.flags.finish === true ? { finish: true } : {}) };
    },
    hint: answerSetHint })),
  verb({ domain: "requirement", action: "consensus", summary: "close clarification at the current round; a round still awaiting answers is refused unless --unanswered", verb: "requirement-consensus", positionals: [GROUP],
    flags: [{ name: "unanswered", type: "boolean", summary: "agree with a round still awaiting answers: its questions stay open and its glossary entries and ADRs are dropped" }],
    route: (c) => `groups/${group(c)}/requirement/consensus`,
    payload: async (c) => {
      const round = await currentRound(c);
      const refusal = c.args.flags.unanswered === true ? null : unansweredRefusal(round.roundNo, round.row);
      if (refusal !== null) throw refusal;
      return { roundNo: round.roundNo };
    },
    hint: consensusHint }),
  verb({ domain: "requirement", action: "continue", summary: "grant exactly one more clarification round after the cap", verb: "requirement-clarify-more", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/clarify-more`, payload: async (c) => ({ roundNo: await roundNo(c) }) }),
  // Flow engine spec §10.3 (W-76): a new round revising round --round; the file holds {answers, glossaryDecisions,
  // adrDecisions, reason?, exclude?} as requirement-answer's payload (answers as {id, kind, text?}).
  verb({ domain: "requirement", action: "revise", summary: "revise an answered clarification round (a new round; at most one clarify call)", verb: "requirement-revise", positionals: [GROUP],
    flags: [{ name: "round", type: "string", required: true, summary: "the round number to revise" }, { name: "file", type: "string", required: true, summary: "the answers JSON {answers, glossaryDecisions, adrDecisions, reason?, exclude?}" }],
    route: (c) => `groups/${group(c)}/requirement/revise`,
    payload: (c) => {
      const body = file(c);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("--file wants a JSON object");
      const roundNo = Number(str(c, "round"));
      if (!Number.isSafeInteger(roundNo) || roundNo < 1) throw invalid("--round wants a round number");
      return { ...(body as object), roundNo };
    } }),
  verb({ domain: "requirement", action: "feedback", summary: "ask for a new draft of the split", verb: "requirement-draft-feedback", positionals: [GROUP],
    flags: [{ name: "text", type: "string", required: true, summary: "what to change" }],
    route: (c) => `groups/${group(c)}/requirement/feedback`, payload: async (c) => ({ draftNo: (await latestDraft(c)).draftNo, feedback: str(c, "text") }) }),
  verb({ domain: "requirement", action: "accept", summary: "accept the current draft: the group becomes a draft task group", verb: "requirement-draft-accept", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/accept`,
    payload: async (c) => { const d = await latestDraft(c); if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`); return { draftNo: d.draftNo, draftHash: d.draftHash }; } }),
  verb({ domain: "requirement", action: "classify", summary: "set the requirement's class (it sets the clarification caps)", verb: "requirement-classify", positionals: [GROUP],
    flags: [{ name: "scope", type: "string", required: true, summary: "small|medium|large" }, { name: "clarity", type: "string", required: true, summary: "the clarity class" }],
    route: (c) => `groups/${group(c)}/requirement/classify`, payload: (c) => ({ scope: str(c, "scope"), clarity: str(c, "clarity") }) }),
  // Issue #236: a frozen selector the catalog no longer lists (or ccloop's single-call-unsupported) blocks a round; this
  // re-selects the requirement's agent and drafts that round again, keeping the rounds already answered.
  verb({ domain: "requirement", action: "set-agent", summary: "re-select the requirement's agent; a round or draft blocked on the old one is drafted again", verb: "requirement-set-agent", positionals: [GROUP],
    flags: [
      { name: "agent", type: "string", summary: "the installation (orca agent list); default: as your agent preferences choose" },
      { name: "model", type: "string", summary: "the model, as the installation's catalog lists it (orca agent models <installation>)" },
    ],
    route: (c) => `groups/${group(c)}/requirement/set-agent`,
    payload: (c) => {
      const agent = str(c, "agent"), model = str(c, "model");
      if (agent === undefined && model === undefined) throw invalid("give --agent, --model or both");
      return { agent: { ...(agent === undefined ? {} : { agent }), ...(model === undefined ? {} : { model }) } };
    },
    examples: ["orca requirement set-agent g-1 --model tokenswitch/mode-x", "orca requirement set-agent g-1 --agent codex-main --model gpt-5"] }),

  // --- group
  estimateFormat(verb({ domain: "group", action: "import", summary: "import a registered plan, or a plan library version (--library), as a new draft group", verb: "import-plan",
    positionals: [{ name: "plan", summary: "a plan id (or unique prefix) from orca project show / config; not with --library", required: false }],
    flags: [
      { name: "group", type: "string", summary: "the new group's id" }, { name: "estimator-profile", type: "string", summary: "estimate with this profile" },
      { name: "estimate-mode", type: "string", summary: "strict|soft" },
      // Scheduled flows and groups spec §5.5, §13.1: a library entry's version instead of a registered plan.
      { name: "library", type: "string", summary: "a plan library entry (orca plan list) instead of a registered plan" },
      { name: "version", type: "string", summary: "with --library: the displayed version number or a sha256 prefix (numeric SHA prefixes need sha256:); default: the entry's newest" },
    ],
    examples: ["orca group import plan-a", "orca group import --library pl-0123456789abcdef"],
    scopeId: (c) => newGroupIdOnce(c), route: () => "groups/import-plan",
    payload: async (c) => {
      const library = str(c, "library");
      if ((library === undefined) === (c.ids.plan === undefined)) throw invalid("give a plan id or --library <entry>, not both");
      if (library === undefined && str(c, "version") !== undefined) throw invalid("--version goes with --library");
      const profile = str(c, "estimator-profile");
      const binding = profile === undefined ? null : await profileBinding(c, profile);
      let source: Record<string, unknown>;
      if (library !== undefined) {
        const entry = await c.read(`plan-library/${encodeURIComponent(library)}`) as { entryId: string; projectId: string; head: { sha256: string } | null; versions: Array<{ version: number; sha256: string }> };
        const named = str(c, "version");
        const numeric = named !== undefined && /^\d+$/.test(named);
        const selected = numeric ? entry.versions.find((v) => v.version === Number(named)) : undefined;
        if (numeric && selected === undefined) throw new EntryRejection("id-not-found", `no version ${JSON.stringify(named)}; use sha256:${named} for a numeric SHA prefix`);
        const sha256 = named === undefined ? entry.head?.sha256 : numeric ? selected!.sha256
          : resolveId("version", named.startsWith("sha256:") ? named.slice(7) : named, entry.versions.map((v) => v.sha256));
        if (sha256 === undefined) throw new EntryRejection("plan-library-entry-not-found", `${entry.entryId} has no version`);
        source = { repoId: entry.projectId, libraryEntry: { entryId: entry.entryId, sha256 } };
      } else {
        const plans = (await config(c)).plans;
        const planId = resolveId("plan", c.ids.plan!, plans.map((p) => p.planId));
        source = { repoId: plans.find((p) => p.planId === planId)!.repoId, planId };
      }
      // Issue 141: the plan (or library entry) decides the project; a --project naming another one is refused, not ignored.
      if (c.args.global.project !== undefined) {
        const named = await c.project();
        if (named.repoId !== source.repoId) {
          const what = library !== undefined ? `library entry ${library}` : `plan ${String(source.planId)}`;
          throw new EntryRejection("import-project-mismatch", `--project names ${named.projectKey} (${named.repoId}), but ${what} belongs to ${String(source.repoId)}; drop --project or name that project`);
        }
      }
      return {
        groupId: newGroupIdOnce(c), ...source,
        ...(binding === null ? {} : { estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash }),
        ...(str(c, "estimate-mode") === undefined ? {} : { estimateMode: str(c, "estimate-mode") }),
      };
    } }), "estimateReasonCode"),
  withWarnings(withNote(() => { const lines = estimateNote; estimateNote = []; return lines; }, estimateFormat(verb({ domain: "group", action: "estimate", summary: "ask the estimator for budgets at the current proposal version", verb: "estimate", positionals: [GROUP],
    flags: [{ name: "estimator-profile", type: "string", summary: "default: the panel's estimator" }, { name: "mode", type: "string", summary: "strict|soft; default: the panel's" }],
    route: (c) => `groups/${group(c)}/estimates`,
    payload: async (c) => {
      const view = await config(c), defaults = view.defaults;
      const named = str(c, "estimator-profile");
      const binding = named !== undefined ? await profileBinding(c, named) : defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
      const mode = str(c, "mode") ?? defaults?.estimateMode;
      if (binding === null || mode === undefined) throw new EntryRejection("estimator-unconfigured", "the panel has no estimator default; pass --estimator-profile and --mode");
      estimateNote = instructionLines(view, binding.profileId);
      instructionWarnings = estimateNote;
      return { proposalVersion: (await groupView(c)).proposal.proposalVersion, estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash, estimateMode: mode };
    } }), "reasonCode"))),
  withWarnings({ ...verb({ domain: "group", action: "confirm", summary: "confirm the task plan as shown now; it starts when a slot is free unless --hold", verb: "confirm", positionals: [GROUP],
    flags: [
      { name: "hold", type: "boolean", summary: "confirm only; start it later with orca group start" },
      { name: "budget-mode", type: "string", summary: "strict|soft when the proposal has none" },
      { name: "worker-profile", type: "string", summary: "bind the worker profile" }, { name: "handoff-profile", type: "string", summary: "bind the handoff profile" },
      { name: "goal-review-profile", type: "string", summary: "bind the goal-review profile" },
      { name: "handoff-at-context-tokens", type: "integer", summary: "optional: hand off at this many context tokens (not active: no installed agent reports context usage)" },
    ],
    route: (c) => `groups/${group(c)}/confirm`, payload: (c) => confirmPayload(c) }),
    // Session 3cfc2e73 D3: the confirm result carries no allocations; the lines come from the view the payload read.
    format: (body: unknown) => { const lines = confirmNote; confirmNote = []; return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`; } }),
  queuedFormat(empty("group", "start", "start a confirmed group (one confirmed with --hold); at the running-group cap it is queued", "start", "start")),
  empty("group", "pause", "stop dispatching new runs (running ones finish)", "pause-dispatch", "pause-dispatch"),
  queuedFormat(empty("group", "resume", "dispatch again after a pause", "resume-dispatch", "resume-dispatch")),
  verb({ domain: "group", action: "stop-handoff", summary: "stop: running tasks hand off and stop", verb: "handoff-stop", positionals: [GROUP],
    flags: [{ name: "deadline", type: "string", summary: "UTC YYYY-MM-DDTHH:mm:ss.sssZ" }],
    route: (c) => `groups/${group(c)}/handoff-stop`, payload: (c) => (str(c, "deadline") === undefined ? {} : { handoffDeadlineAt: str(c, "deadline") }) }),
  verb({ domain: "group", action: "resume-handoff", summary: "resume after a completed handoff; --continue <task> continues that task from its checkpoint", verb: "resume-from-handoff",
    positionals: [GROUP], flags: [{ name: "continue", type: "string", repeatable: true, summary: "a task to continue (repeatable)" }, ...NOTE_FLAGS],
    route: (c) => `groups/${group(c)}/resume-from-handoff`,
    payload: async (c) => {
      const items = (await groupView(c)).workItems;
      const note = operatorNote(c);
      if (note !== undefined && list(c, "continue").length === 0) throw invalid("--note goes with --continue <task>: only a continued task's run reads it");
      const selections = [];
      for (const given of list(c, "continue")) {
        const taskId = resolveId("task", given, items.map((w) => w.taskId));
        const runId = items.find((w) => w.taskId === taskId)!.currentRunId;
        if (runId === null) throw new EntryRejection("task-has-no-run", `task ${taskId} has no run to continue`);
        selections.push({ taskId, predecessorRunId: runId, checkpointId: await checkpointOf(c, runId), ...(note === undefined ? {} : { operatorNote: note }) });
      }
      return { selections };
    } }),
  empty("group", "archive", "archive a group: records stay, it refuses every command but unarchive", "archive-group", "archive"),
  empty("group", "unarchive", "unarchive a group", "unarchive-group", "unarchive"),
  // Terminal run closure #169: a proved terminal failure's accounting ends without accepting its work; then archive works.
  verb({ domain: "group", action: "close-run", summary: "close a proved terminal failed run's accounting (it stays failed; retry or archive next)", verb: "close-run", positionals: [GROUP],
    flags: [{ name: "run", type: "string", required: true, summary: "the run to close (orca run show <run> names it)" }],
    route: (c) => `groups/${group(c)}/close-run`, payload: (c) => ({ runId: str(c, "run") }),
    hint: (error) => error.code === "run-closure-evidence" || error.code === "run-closure-not-terminal"
      ? "this run has no proved terminal failure; retry the task, or settle unknown usage if the run reports it"
      : undefined }),
  verb({ domain: "group", action: "set-limit", summary: "set the group's budget limit", verb: "set-limit", positionals: [GROUP], access: "token",
    flags: [{ name: "limit", type: "string", required: true, summary: "JSON {tokens,activeMs,attempts,sessions}" }],
    route: (c) => `groups/${group(c)}/set-limit`, payload: (c) => ({ limit: json(c, "limit") }) }),
  verb({ domain: "group", action: "cap", summary: "lower a draft group's token ceiling; raising or removing it requires a person", verb: "proposal-edit", positionals: [GROUP],
    flags: [{ name: "tokens", type: "string", required: true, summary: "finite token ceiling below the current one" }],
    route: (c) => `groups/${group(c)}/proposal/edit`, payload: async (c) => {
      const raw = str(c, "tokens")!;
      if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw invalid("--tokens wants a non-negative safe integer");
      const tokens = Number(raw), view = await groupView(c), current = view.ledger.groupLimit;
      if (view.proposal.state !== "editable" || (current.tokens !== null && tokens >= current.tokens)) throw invalid("group cap needs an editable proposal and a lower token ceiling");
      return { baseProposalVersion: view.proposal.proposalVersion, operations: [], proposedGroupLimit: { ...current, tokens }, capOnly: true };
    }, examples: ["orca group cap g1 --tokens 300000"] }),
  verb({ domain: "group", action: "set-integration", summary: "where this group's finished work goes", verb: "set-group-integration", positionals: [GROUP], flags: SCHEME_FLAGS,
    route: (c) => `groups/${group(c)}/integration`, payload: (c) => ({ integration: schemeFromFlags(c) }) }),
  empty("group", "retry-integration", "a blocked or conflicted integration back to idle", "retry-integration", "integration/retry"),
  empty("group", "resolve-integration", "approve an agent resolving the group's integration conflict", "resolve-integration-conflict", "integration/resolve"),
  // Tester follow-up E §5 (#241): the ways out of a failed group acceptance besides a moved tip.
  empty("group", "recheck", "run a failed group acceptance again on the same tip (a flaky check)", "recheck-acceptance", "acceptance/recheck"),
  verb({ domain: "group", action: "waive-acceptance", summary: "accept a group whose acceptance failed on its tip anyway (a person's act)",
    verb: "waive-acceptance", positionals: [GROUP], access: "token",
    flags: [{ name: "note", type: "string", required: true, summary: "why you accept the failed tip; recorded with the waiver and in the group's activity" }],
    route: (c) => `groups/${group(c)}/acceptance/waive`, payload: (c) => ({ note: str(c, "note") }),
    examples: ["orca group waive-acceptance g1 --note 'the red test is the known flaky one; tracked in #12'"] }),
  // Dir-requirements spec §9.2: the person's answer to a folder change that stopped a dir group's placement.
  verb({ domain: "group", action: "folder-change", summary: "answer a folder change that stopped placement: --take-folder, --recheck or --withhold",
    verb: "resolve-folder-change", positionals: [GROUP], access: "token",
    flags: [
      { name: "take-folder", type: "boolean", summary: "keep the folder's changes and continue" },
      { name: "recheck", type: "boolean", summary: "look at the folder again" },
      { name: "withhold", type: "boolean", summary: "leave these paths out of the folder and place the rest" },
      { name: "dir", type: "string", summary: "the multi project's folder member (required on a multi group)" },
    ],
    route: (c) => `groups/${group(c)}/folder-change`,
    payload: (c) => {
      const chosen = (["take-folder", "recheck", "withhold"] as const).filter((flag) => c.args.flags[flag] === true);
      if (chosen.length !== 1) throw invalid("give exactly one of --take-folder, --recheck and --withhold");
      const dir = str(c, "dir");
      return { action: chosen[0], ...(dir === undefined ? {} : { dir }) };
    } }),
  // Multi-directory projects spec §9.7: the person's answer to a stopped landing (retry the rest, or record it as done).
  verb({ domain: "group", action: "multi-land", summary: "answer a stopped multi-directory landing: --retry-rest or --mark-resolved",
    verb: "multi-dir-landing", positionals: [GROUP], access: "token",
    flags: [
      { name: "retry-rest", type: "boolean", summary: "pre-check and land the directories not yet landed" },
      { name: "mark-resolved", type: "boolean", summary: "record that the person landed them: they are not due again" },
    ],
    route: (c) => `groups/${group(c)}/multi-dir-landing`,
    payload: (c) => {
      const chosen = (["retry-rest", "mark-resolved"] as const).filter((flag) => c.args.flags[flag] === true);
      if (chosen.length !== 1) throw invalid("give exactly one of --retry-rest and --mark-resolved");
      return { action: chosen[0] };
    } }),
  ...(["depend", "undepend"] as const).map((action) => verb({
    domain: "group", action, summary: action === "depend" ? "make the group wait until --on <group> has landed" : "remove that wait",
    verb: action === "depend" ? "add-group-dependency" : "remove-group-dependency", positionals: [GROUP],
    flags: [{ name: "on", type: "string", required: true, summary: "the group that must land first" }],
    route: (c) => `groups/${group(c)}/dependencies/${action === "depend" ? "add" : "remove"}`,
    hint: (error) => action === "depend" && error.code === "group-edge-dependent-started"
      ? "the dependent group already started; dependencies must be set before it starts. Inspect it with orca group show <group>; use a new draft group for a different dependency order"
      : undefined,
    payload: async (c) => {
      const summary = await c.read("summary") as { groups: Array<{ groupId: string }> };
      return { dependsOn: resolveId("group", str(c, "on")!, summary.groups.map((g) => g.groupId)) };
    },
  })),

  // --- task
  { ...verb({ domain: "task", action: "retry", summary: "start again a task whose current run failed (the run read now is the one retried), optionally on another installation", verb: "retry-task", positionals: [GROUP, TASK],
    flags: [{ name: "agent", type: "string", summary: "retry on this agent installation instead (quota failover spec §8; not for a task with skills); `auto` hands the choice back to orca-auto (unlocks a task a switch pinned); refused to a run Orca dispatched" },
      { name: "allow-observed-paths", type: "boolean", summary: "allow only the exact paths the last blocked run reported missing; inspect `orca run show` first" },
      // Retry work top-up spec 2026-11-06 §2 "The command".
      { name: "work", type: "string", summary: "add work to the task's budget for this retry and every later run, as JSON {tokens?,activeMs?,attempts?,sessions?} (an omitted dimension adds 0); a person may always, an agent up to the orchestration agent top-up cap; refused to a run Orca dispatched; only a task under the optional token policy" }],
    route: (c) => `groups/${group(c)}/retry-task`, payload: async (c) => {
      const work = json(c, "work");
      if (work !== undefined && (work === null || typeof work !== "object" || Array.isArray(work))) throw invalid("--work wants a JSON object {tokens?,activeMs?,attempts?,sessions?}");
      if (work !== undefined) retryNote = await retryFundingLines(c, (work as { tokens?: unknown }).tokens ?? 0);
      return { taskId: task(c), runId: await currentRun(c), ...(c.args.flags["allow-observed-paths"] === true ? { allowObservedPaths: true } : {}), ...(typeof c.args.flags.agent === "string" ? { agent: c.args.flags.agent } : {}), ...(work === undefined ? {} : { work }) };
    } }),
    // Tester follow-up B T2 (#202): the fresh grant the retry's next run gets, read before the write (print-only).
    format: (body: unknown) => {
      // Tester follow-up E §8: what the new run starts with, when the receipt says (an explicit retry in a group with no token limit).
      const next = (body as { result?: { taskId?: string; nextRun?: { attempts: number; activeMs: number } } } | null)?.result;
      const fresh = next?.nextRun === undefined ? [] : [`the new run of ${next.taskId} gets ${next.nextRun.attempts} attempts and ${Math.round(next.nextRun.activeMs / 60_000)} min active time (fresh: the group has no token limit)`];
      const lines = [...retryNote, ...fresh]; retryNote = [];
      return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`;
    } },
  verb({ domain: "task", action: "continue", summary: "continue a task's current run from its newest complete checkpoint; --note tells its agent something", verb: "continue-task", positionals: [GROUP, TASK],
    flags: NOTE_FLAGS,
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/continue`,
    payload: async (c) => {
      const note = operatorNote(c);
      const runId = await currentRun(c);
      return { predecessorRunId: runId, checkpointId: await checkpointOf(c, runId), ...(note === undefined ? {} : { operatorNote: note }) };
    } }),
  verb({ domain: "task", action: "set-loop", summary: "set a task's loop plan from a JSON file {plan,inputs,work,workProvenance?,skills?}", verb: "set-task-loop", positionals: [GROUP, TASK],
    flags: [{ name: "file", type: "string", required: true, summary: "the loop JSON" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/loop`,
    payload: async (c) => {
      const body = file(c);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("--file wants a JSON object");
      return { baseLoopVersion: (await workItem(c)).loopPlan?.loopVersion ?? 0, ...(body as object) };
    } }),
  verb({ domain: "task", action: "set-labels", summary: "set a task's labels (--label repeatable), or --clear back to the plan's", verb: "set-task-labels", positionals: [GROUP, TASK],
    flags: [{ name: "label", type: "string", repeatable: true, summary: "a label" }, { name: "clear", type: "boolean", summary: "drop the operator's labels" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/labels`,
    payload: async (c) => {
      if (c.args.flags.clear === true && list(c, "label").length > 0) throw invalid("--clear takes no --label");
      return { labels: c.args.flags.clear === true ? null : list(c, "label"), baseLabelsVersion: (await workItem(c)).labelsVersion ?? 0 };
    },
    // Tester #186: the refusal named the bad value but not one it could use instead.
    hint: (error) => error.code === "labels-invalid" ? `valid labels: ${SYSTEM_LABELS.join(", ")}, or custom:<text>` : undefined }),
  verb({ domain: "task", action: "verify-saved-result", summary: "verify the current run's saved result instead of re-running (after run eligibility says eligible)",
    verb: "verify-saved-result", positionals: [GROUP, TASK],
    flags: [{ name: "work", type: "string", summary: "add work for the verification run as JSON {tokens?,activeMs?,attempts?,sessions?}; a person may always, an agent within the top-up cap; refused to a run Orca dispatched" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/verify-saved-result`,
    payload: async (c) => {
      const work = json(c, "work");
      if (work !== undefined && (work === null || typeof work !== "object" || Array.isArray(work))) throw invalid("--work wants a JSON object {tokens?,activeMs?,attempts?,sessions?}");
      const answer = await c.read(`runs/${await currentRun(c)}/saved-result-eligibility`) as { status: string; reason?: string; recoveryOf?: { sourceRunId: string; sourceAttempt: number; capsuleHash: string } };
      if (answer.status !== "eligible" || answer.recoveryOf === undefined) throw new EntryRejection("saved-result-unavailable", `the saved result is not eligible: ${answer.reason ?? answer.status}`);
      const { sourceRunId, sourceAttempt, capsuleHash } = answer.recoveryOf;
      return { sourceRunId, sourceAttempt, capsuleHash, ...(work === undefined ? {} : { work }) };
    } }),
  // Reviewed acceptance (spec 2026-11-11 §7): an owner lands a terminal, settled run's last attempt after Orca re-runs its checks.
  verb({ domain: "task", action: "accept-attempt", summary: "land a failed, settled run's last attempt after Orca re-runs the task's checks on it (an owner's act)",
    verb: "accept-attempt", positionals: [GROUP, TASK], access: "token",
    flags: [
      { name: "run", type: "string", required: true, summary: "the terminal run whose last attempt to accept (orca run show <run> names it)" },
      { name: "note", type: "string", required: true, summary: "why you accept it; recorded with the acceptance and in the run's decision ledger" },
    ],
    route: (c) => `groups/${group(c)}/accept-attempt`,
    payload: (c) => ({ taskId: task(c), runId: str(c, "run"), note: str(c, "note") }),
    hint: (error) => error.code === "accept-attempt-run-not-settled"
      ? "close the run's accounting first (orca group close-run, or orca task settle-usage), then accept its attempt"
      : undefined }),
  // Tester follow-up E §8: an agent may charge the grant or settle a proved zero without a person token; release-unmetered
  // wants one (humanOnly.ts SOCKET_TIER), so the verb is open and its flag says which form is a person's.
  verb({ domain: "task", action: "settle-usage", summary: "settle a run's unknown usage (cannot be undone)", verb: "settle-unknown-usage", positionals: [GROUP, TASK], access: "open",
    // Tester follow-up F §2 (#116, ledger C3): charge-observed-floor books a finite remainder's run at ccloop's observed floor.
    flags: [{ name: "acknowledge", type: "string", required: true, summary: "charge-remaining-grant|charge-observed-floor|release-known-zero|release-unmetered: an agent may send charge-remaining-grant, or release-known-zero when ccloop proved the failed run spent nothing, or charge-observed-floor (charges only the floor ccloop observed, marked approximate; a finite remainder with a known floor, else refused observed-floor-unknown), without a person token; release-unmetered needs a person token (orca auth login, then --as-person); refused to a run Orca dispatched" }],
    hint: (error) => error.code === "control-person-token-required"
      ? "without a person token, send --acknowledge charge-remaining-grant (or release-known-zero when proved, or charge-observed-floor when ccloop observed a floor); release-unmetered is a person's: orca auth login, then --as-person"
      : undefined,
    route: (c) => `groups/${group(c)}/settle-unknown-usage`,
    payload: async (c) => {
      const runId = await currentRun(c);
      const generation = (await groupView(c)).runs.find((r) => r.runId === runId)?.unknownUsageSettlement?.generation;
      if (generation === undefined) throw new EntryRejection("usage-not-unknown", `run ${runId} has no unknown usage to settle`);
      return { taskId: task(c), runId, generation, acknowledge: str(c, "acknowledge") };
    } }),
];

/** One generated id per invocation: the payload and the revision lookup must name the same new group. */
const generated = new WeakMap<WriteContext, string>();
function newGroupIdOnce(c: WriteContext): string {
  let id = generated.get(c);
  if (id === undefined) { id = newGroupId(c); generated.set(c, id); }
  return id;
}

interface AgentPreview {
  proposalVersion?: number; selectionsHash: string | null;
  slots?: Array<{ key: string; slot: string; taskId: string | null; outcome: { kind: string; code?: string } }>;
}

/**
 * Issue #144: name each slot that does not resolve, with its code and the command that sets it, instead of one line
 * pointing at `orca agent list` (which only lists installations and fixes nothing).
 */
function unresolvedMessage(groupId: string, preview: AgentPreview): string {
  const failed = (preview.slots ?? []).filter((slot) => slot.outcome.kind !== "resolved");
  if (failed.length === 0) return "an agent slot does not resolve at this proposal version; see orca proposal show";
  const lines = failed.map((slot) => {
    const target = slot.taskId === null ? `--slot ${slot.slot}` : `--task ${slot.taskId}`;
    const next = slot.outcome.kind === "unavailable" ? "ccloop could not be asked just now; retry" : `set it with orca proposal set-agent ${groupId} ${target} --agent <installation>`;
    return `${`${slot.key}: ${slot.outcome.kind} ${slot.outcome.code ?? ""}`.trimEnd()}; ${next}`;
  });
  // Tester follow-up E §7 (#250): the group worker slot is the batch set (tester-round2 spec): it reaches every task's
  // worker and the reconcile slot. Lead with it when one of those has no agent at all; a slot naming a missing
  // installation is not fixed by it.
  const batch = failed.some((slot) => (slot.slot === "worker" || slot.slot === "reconcile") && slot.outcome.code === "agent-unselected")
    ? [`orca proposal set-agent ${groupId} --slot worker --agent <installation>  (sets every task and reconcile)`] : [];
  return `${failed.length} agent slot(s) do not resolve:\n  ${[...batch, ...lines].join("\n  ")}`;
}

/**
 * Tester follow-up B T2 (#202): `task retry --work`'s human lines -- what the panel's funding preview says retrying this
 * task with these tokens funds its next run (authored + top-ups - lineage usage; the group's headroom may fund less), and a
 * warning when that is below what one attempt of the task has cost. Nothing when the preview cannot say (the write then
 * answers for itself): this note never stops the command.
 */
let retryNote: string[] = [];
async function retryFundingLines(c: WriteContext, tokens: unknown): Promise<string[]> {
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0) return [];
  let retry: { authoredTokens: number | null; lineageTokens: number; freshTokens: number | null; perAttemptTokens: number | null } | null | undefined;
  try { retry = (await c.read(`groups/${group(c)}/funding-preview?retry=${encodeURIComponent(task(c))}&tokens=${tokens}`) as { retry?: typeof retry }).retry; }
  catch { return []; }
  if (retry === null || retry === undefined) return [];
  if (retry.freshTokens === null) return [`the next run of ${task(c)} has no token limit`];
  return [`the next run of ${task(c)} is funded at most ${retry.freshTokens} tokens (authored ${retry.authoredTokens} with top-ups, minus ${retry.lineageTokens} used by its earlier runs)`,
    ...(retry.perAttemptTokens !== null && retry.freshTokens < retry.perAttemptTokens
      ? [`warning: ${retry.freshTokens} tokens is less than one attempt of ${task(c)} has cost (${retry.perAttemptTokens}); the run may stop or overspend before it finishes an attempt`] : [])];
}

/** Spec §4: confirm's pins, as the Web's confirm builds them (BudgetEditor.tsx submitConfirm), read now. */
/** Session 3cfc2e73 D3: the unestimated-default lines of the view `group confirm` read, for its human output (one command per CLI process). */
let confirmNote: string[] = [];
async function confirmPayload(c: WriteContext): Promise<unknown> {
  const view = await groupView(c);
  const funding = await c.read(`groups/${group(c)}/funding-preview`);
  confirmNote = [...unestimatedLines(group(c), view, { afterConfirm: true }), ...fundingLines(funding)];
  const defaults = (await config(c)).defaults;
  const preview = await c.read(`groups/${group(c)}/agent-preview`) as AgentPreview;
  // Tester #144(b): an already confirmed proposal is the panel's to answer (no-op-command), not this pre-check's. The panel
  // refuses it before it compares selections, so an unresolved preview sends the all-zero hash -- which, should the
  // proposal have been reopened meanwhile, matches no resolution and is refused there.
  const confirmed = view.proposal.state === "confirmed";
  if (!confirmed && (preview.selectionsHash === null || preview.proposalVersion !== view.proposal.proposalVersion)) {
    throw new EntryRejection("agent-selection-unresolved", unresolvedMessage(group(c), preview));
  }
  const flagFor = { worker: "worker-profile", handoff: "handoff-profile", goalReview: "goal-review-profile" } as const;
  const bind = async (kind: "estimator" | "worker" | "handoff" | "goalReview") => {
    if (kind !== "estimator" && str(c, flagFor[kind]) !== undefined) return profileBinding(c, str(c, flagFor[kind])!);
    if (view.proposal.profiles !== null) return view.proposal.profiles[kind];
    return defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
  };
  const bindings = { estimator: await bind("estimator"), worker: await bind("worker"), handoff: await bind("handoff"), goalReview: await bind("goalReview") };
  instructionWarnings = instructionLines(await config(c), bindings.estimator?.profileId);
  confirmNote.push(...instructionWarnings);
  for (const kind of ["worker", "handoff", "goalReview"] as const) {
    if (bindings[kind] === null) throw new EntryRejection("confirm-profile-missing", `no ${kind} profile; pass --${flagFor[kind]} <id>`);
  }
  const budgetMode = view.proposal.budgetMode ?? str(c, "budget-mode") ?? defaults?.estimateMode;
  if (budgetMode === undefined) throw new EntryRejection("confirm-budget-mode-missing", "the proposal has no budget mode; pass --budget-mode strict|soft");
  const tokens = c.args.flags["handoff-at-context-tokens"];
  const threshold = typeof tokens === "number" ? tokens : view.proposal.contextPolicy.handoffAtContextTokens;
  confirmNote.push(...contextHandoffLines(threshold));
  return {
    planHash: view.plan.planHash, proposalVersion: view.proposal.proposalVersion, budgetMode,
    profileIds: { estimator: bindings.estimator?.profileId ?? null, worker: bindings.worker!.profileId, handoff: bindings.handoff!.profileId, goalReview: bindings.goalReview!.profileId },
    profileHashes: { estimator: bindings.estimator?.profileHash ?? null, worker: bindings.worker!.profileHash, handoff: bindings.handoff!.profileHash, goalReview: bindings.goalReview!.profileHash },
    contextPolicy: { handoffAtContextTokens: threshold },
    selectionsHash: preview.selectionsHash ?? "0".repeat(64),
    ...(view.integration === undefined ? {} : { integrationHash: view.integration.schemeHash }),
    ...(c.args.flags.hold === true ? { hold: true } : {}),
  };
}
