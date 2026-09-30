/**
 * Panel i18n spec §2: the English resource. It is the source shape (`as const`), and every value is today's panel text
 * byte for byte. Keys are grouped by panel area. Enum families (spec §3.5) are Records over the value unions, so a new
 * value is a compile error here until it has its words. Tasks 3-10 add their areas.
 */
import type { ThemePref } from "../theme.js";
import type { ChainStopCategory, CorrectionKind, DecisionKind, DecisionObservation, DecisionScope, MetricsNoteCode } from "../types.js";
import type {
  EstimateViewV1, GroupSummaryV1, HandoffRequestViewV1, RecoveryViewV1, RunViewV1, WorkItemProgressV1, WorkItemViewV1,
} from "../controlTypes.js";

/** The Chinese resource's type: the same key set, every value widened to string (spec §2). */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

const theme = { system: "system", light: "light", dark: "dark" } as const satisfies Record<ThemePref, string>;
const decisionKind = {
  dependency: "dependency", interface: "interface", scheduling: "scheduling", abandon: "abandon", criteria: "criteria", boundary: "boundary", reconcile: "reconcile",
} as const satisfies Record<DecisionKind, string>;
const decisionScope = { file: "file", task: "task", repo: "repo", "cross-repo": "cross-repo" } as const satisfies Record<DecisionScope, string>;
const decisionVerdict = { ok: "ok", downgraded: "downgraded" } as const satisfies Record<DecisionObservation["verdict"], string>;
const correctionKind = { wrong: "wrong", not_my_taste: "not_my_taste", stale: "stale" } as const satisfies Record<CorrectionKind, string>;
const kindHelp = {
  wrong: "the choice was wrong",
  not_my_taste: "defensible, but not what I would choose",
  stale: "it was right then, no longer true",
} as const satisfies Record<CorrectionKind, string>;

// Panel i18n spec §3.4: each English note is the server's sentence byte for byte (tests/metrics/noteCodes.test.ts).
const metricsNote = {
  "no-review-coverage": "review coverage has no data: its only producer is the panel (E2 spec §3.5), and A' §4.4 says the correction rate must never be read on its own",
  "unresolved-decisions": "some corrections point at decisions outside what was scanned (see unresolved_decisions); they count in the totals but sit in no decision-kind bucket",
  "stale-bias": "systematically low: closing a stale correction requires the chose_instead field (CLI flag --chose-instead) that corrections/schema.ts says a stale may not have (E2 spec §3.2.1, A' ERRATUM 3)",
  "reviewed-is-deliberate": "`reviewed` is a deliberate act, so this number can sit near zero for a long time -- and a long-zero coverage is not distinguishable from nobody looking. Read it with the backlog, not on its own.",
} as const satisfies Record<MetricsNoteCode | "reviewed-is-deliberate", string>;

const chainStopCategory = { done: "done", blocked: "blocked", limit: "limit", anomaly: "anomaly" } as const satisfies Record<ChainStopCategory, string>;
const chainBanner = {
  done: "Chain finished",
  blocked: "Chain is waiting for you",
  limit: "Chain stopped at a limit",
  anomaly: "Chain stopped on an anomaly",
} as const satisfies Record<ChainStopCategory, string>;

const groupState = { draft: "draft", ready: "ready", running: "running", review: "review", done: "done", blocked: "blocked" } as const satisfies Record<GroupSummaryV1["state"], string>;
const stopMode = { pause: "pause", shutdown: "shutdown", handoff: "handoff" } as const satisfies Record<NonNullable<GroupSummaryV1["stopMode"]>, string>;
const stopState = {
  paused: "paused", "handoff-pending": "handoff-pending", "handoff-partial": "handoff-partial", "handoff-unresolved": "handoff-unresolved", "handoff-complete": "handoff-complete",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;
const workStatus = {
  draft: "draft", ready: "ready", starting: "starting", "start-unknown": "start-unknown", active: "active", held: "held", continuing: "continuing", completed: "completed", blocked: "blocked",
} as const satisfies Record<WorkItemViewV1["status"], string>;
const runPhase = { estimate: "estimate", work: "work", handoff: "handoff" } as const satisfies Record<RunViewV1["phase"], string>;
const runState = {
  starting: "starting", unknown: "unknown", "attempt-unknown": "attempt-unknown", "attempt-proof-invalid": "attempt-proof-invalid", running: "running",
  "failed-before-provider": "failed-before-provider", "settled-recoverable": "settled-recoverable", "settled-restartable": "settled-restartable",
  "settled-unrecoverable": "settled-unrecoverable", collected: "collected", landed: "landed", reconciling: "reconciling", blocked: "blocked",
} as const satisfies Record<RunViewV1["state"], string>;
const requestState = {
  "request-pending": "request-pending", latched: "latched", collecting: "collecting", "settled-recoverable": "settled-recoverable",
  "settled-restartable": "settled-restartable", "settled-unrecoverable": "settled-unrecoverable", "outcome-unknown": "outcome-unknown",
} as const satisfies Record<HandoffRequestViewV1["state"], string>;
const estimateState = {
  queued: "queued", running: "running", "start-unknown": "start-unknown", ready: "ready", failed: "failed", interrupted: "interrupted",
  "blocked-capability": "blocked-capability", "input-too-large": "input-too-large",
} as const satisfies Record<EstimateViewV1["state"], string>;
const budgetMode = { strict: "strict", soft: "soft" } as const satisfies Record<EstimateViewV1["mode"], string>;
const blockerScope = { global: "global", group: "group", run: "run" } as const satisfies Record<RecoveryViewV1["blockers"][number]["scope"], string>;
const progressStep = {
  queued: "queued", plan: "plan", execute: "execute", verify: "verify", succeeded: "succeeded", blocked_waiting_human: "blocked_waiting_human",
  exhausted: "exhausted", cancelled: "cancelled", failed: "failed",
} as const satisfies Record<NonNullable<WorkItemProgressV1["step"]>, string>;

export const en = {
  nav: { sections: "Sections", decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" },
  shell: {
    brandTitle: "Leave it to Orca — every idea, made real.",
    chainRunning: "a chain is running",
    needsAttention: "needs attention",
    theme: "Theme",
    language: "Language",
    loading: "orca panel loading…",
    epoch: "epoch {{epoch}}",
  },
  common: { none: "none", na: "n/a", unknown: "unknown", dispatchBlocked: "dispatch blocked", dispatchLive: "dispatch live" },
  decisions: {
    title: "Unreviewed high-tier decisions",
    count: "{{shown}} of {{total}}",
    lede: "High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.",
    filterKind: "Kind",
    filterScope: "Scope",
    filterRepository: "Repository",
    any: "any",
    nothingToReview: "Nothing to review. Every high-tier decision has been reviewed.",
    noMatch: "No decision matches these filters.",
    selectOne: "Select a decision to read it.",
    hiddenByFilter: "This decision is hidden by the current filters.",
    notInList: "This decision is no longer in the list: it has been reviewed.",
    noQuestion: "(no question recorded)",
    chose: "Chose",
    because: "Because",
    rejected: "Rejected alternatives",
    agree: "Agree",
    agreeHelp: "Mark reviewed: I read this and it needs no change. Counts toward review coverage.",
    correctNote: "This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it.",
    kind: "Kind",
    kindOption: "{{kind}} — {{help}}",
    kindHelp,
    choseInstead: "Chose instead (optional)",
    correct: "Correct",
    recordedReviewed: "Recorded as reviewed.",
    correctionRecorded: "Correction recorded.",
  },
  chains: {
    notLoaded: "Chains have not loaded.",
    title: "Chains",
    noChain: "No chain yet.",
    goal: "Goal",
    by: "By",
    progress: "Progress",
    state: "State",
    stop: "Stop chain",
    stopsAfter: " Stops after the current session ends.",
    formRepository: "Repository ",
    formGoal: "Goal ",
    formMaxSessions: "Max sessions ",
    formMaxCost: "Max cost in USD (a soft limit) ",
    formTimeout: "Session timeout in minutes ",
    start: "Start chain",
    started: "Chain {{chainId}} started.",
    stopRequested: "Chain {{chainId}} will stop after the current session ends.",
    gotIt: "Got it",
    stateStopped: "stopped: {{reason}} ({{category}})",
    stateRunning: "running",
    stateOrphaned: "running (supervisor is gone)",
    costUnreadable: "cost unreadable",
    cost: "USD {{amount}}",
    sessionProgress: "session {{n}}; {{cost}}",
    banner: chainBanner,
  },
  control: {
    unavailable: "The task control plane is not available on this panel.",
    title: "Task control",
    summaryLine: "epoch {{epoch}} · projection {{seq}} · {{dispatch}}",
    noPort: "no execution port configured · this panel serves recovery and evidence, and refuses to start work · set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it",
    resetRequired: "server reset required · this page must re-read before it trusts any cached view",
    refetchRequired: "projection refetch required · re-reading the open groups",
    dispatchBlockedRecovery: "dispatch blocked · recovery must be observed",
    groupsNav: "Control groups",
    noGroups: "No control groups yet.",
    groupDone: " · {{done}}/{{total}} done",
    groupBlockers: " · {{n}} blocker(s)",
    reading: "Reading {{groupId}}…",
    outcomeUnknown: "Command outcome unknown, being looked up: {{commands}}",
    import: {
      region: "Import plan",
      title: "Import a plan",
      noEstimator: "No estimator profile is configured for this panel, so a plan cannot be imported. Restart it with --estimator-profile and --estimate-mode.",
      noRepository: "No trusted repository and plan are configured for this panel.",
      summary: "{{repository}} · {{plan}} · estimate mode {{mode}}",
      notConfigured: "not configured",
      button: "Import plan",
    },
    group: {
      region: "Control group {{groupId}}",
      heading: "{{groupId}} · {{state}} · revision {{revision}} · projection {{projection}}",
      claimBlocked: "claim blocked · new runs are not being started",
      planLine: "{{goal}} · plan {{hash}} · graph v{{graphVersion}}",
      stop: "stop {{mode}} {{state}} · accepted {{accepted}} · deadline {{deadline}} · {{n}} frozen run(s): {{runs}}",
      workItems: "Work items",
      filterRegion: "Filter work items by label",
      filterLegend: "labels (any of)",
      th: { task: "task", status: "status", labels: "labels", progress: "progress", run: "run", pending: "pending", dependsOn: "depends on" },
      runs: "Runs",
      runsTh: { run: "run", phase: "phase", state: "state", profile: "profile", used: "used", remaining: "remaining", evidence: "evidence" },
      attempt: " · attempt {{attempt}} of claim {{claim}}",
      retryRun: "Retry run {{id}}",
      handoffRequests: "Handoff requests",
      handoffLine: "{{requestId}} · run {{runId}} · {{state}} · deadline {{deadline}}",
      handoffEvidence: " · evidence {{ids}}",
      estimates: "Estimates",
      estimateLine: "{{estimateId}} · v{{version}} · {{state}} · {{mode}} profile {{profileId}} {{hash}}",
      waiting: "Waiting for the ledger to answer: {{commands}}",
      dispatch: "Dispatch",
      start: "Start",
      pause: "Pause dispatch",
      handoffStop: "Handoff stop",
      resume: "Resume dispatch",
      continueSelected: "Continue selected tasks ({{n}})",
      continueTask: "Continue task {{taskId}}",
      resumeNoContinuation: "Resume (no continuation)",
      retryRecovery: "Retry recovery for {{groupId}}",
      recent: "Recent commands: {{commands}}",
    },
    task: {
      region: "Task {{taskId}}",
      labelsFrom: "labels from {{source}} · version {{version}}",
      labelSource: { plan: "plan", operator: "operator" },
      unsavedDraft: " · unsaved draft",
      labelsChanged: "labels changed since your draft (v{{base}} → v{{current}}) · now: ",
      labelsOf: "Labels of {{taskId}}",
      remove: "Remove {{label}}",
      systemLabel: "System label",
      addSystem: "Add system label",
      customLabel: "Custom label",
      addCustom: "Add custom label",
      save: "Save labels",
      discard: "Discard draft",
      restore: "Restore plan labels",
      progress: "progress: {{progress}}",
      lastTransition: " · last transition {{at}}",
      runsOf: "Runs of {{taskId}}",
    },
    progress: {
      noRun: "no run",
      notReported: "not reported yet",
      attemptUnknown: "attempt unknown",
      attempt: "attempt {{current}}/{{max}}",
      tokensUnknown: "tokens unknown",
      tokensOfZero: "tokens {{used}} of 0",
      tokensPercent: "tokens {{percent}}% (reported at phase end)",
      line: "{{step}} · {{attempt}} · {{tokens}}",
    },
    evidence: {
      button: "evidence",
      refused: "evidence refused · {{code}}",
      list: "List evidence of {{runId}}",
      none: " no evidence",
      region: "Evidence of {{runId}}",
      entry: "{{id}} · {{kind}} · {{bytes}} bytes",
      download: "Download {{id}}",
    },
    workspace: {
      region: "Workspace mode",
      line: "New runs in {{repoId}} use {{mode}} (setting revision {{revision}}). Runs already started keep theirs.",
      aWorktree: "a git worktree",
      aClone: "a private clone",
      worktreeOption: "git worktree (default)",
      cloneOption: "private clone",
    },
  },
  recovery: {
    title: "Recovery",
    none: "No recovery blockers.",
    retry: "Retry recovery",
    dispatchBlocked: "dispatch blocked · the panel will not start new runs until recovery is observed",
    allGroups: "all groups",
    run: " · run {{runId}}",
    evidence: " · evidence {{ids}}",
    runEvidence: "run evidence",
  },
  loopPlan: {
    // Panel i18n spec §3.1, §6.9: one entry per registry version, equal to src/control/loopPlans.ts (the English source of
    // record); a version with no discipline has no discipline key.
    plan: {
      standard: { v1: { name: "Standard" }, v2: { name: "Standard" } },
      bugfix: {
        v1: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
        v2: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
      },
      refactor: {
        v1: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
        v2: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
      },
      design: {
        v1: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
        v2: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
      },
      investigate: {
        v1: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
        v2: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
      },
    },
    title: { line: "{{name}} · v{{version}} · {{how}}", byHand: "chosen by hand", noLabel: "no label, default", byLabel: "chosen by label `{{label}}`", changed: " · changed" },
    summary: {
      goal: "Goal: {{goal}}",
      doneWhen: "Done when: {{condition}}",
      onlyChanges: "Only changes: {{paths}}",
      mustNotChange: "Must not change: {{paths}} (reported by the agent, not checked in git)",
      files_one: "At most {{count}} file changed (reported by the agent)",
      files_other: "At most {{count}} files changed (reported by the agent)",
      noFileLimit: "No file limit",
      checks_one: "Acceptance: {{count}} check command, all must pass",
      checks_other: "Acceptance: {{count}} check commands, all must pass",
      pathSeparator: ", ",
    },
  },
  metrics: {
    unknownRate: "unknown",
    correctionRate: "Correction rate",
    repairRate: "Repair rate",
    reviewCoverage: "Review coverage",
    unresolvedTitle: "Unresolved decisions",
    unresolvedCount: "Unresolved decisions: {{n}}",
    malformedTitle: "Malformed lines",
    malformedCount: "Malformed lines: {{n}}",
    futureTitle: "Excluded as future",
    futureCount: "Excluded as future: {{n}}",
    note: metricsNote,
  },
  enums: {
    theme, decisionKind, decisionScope, decisionVerdict, correctionKind, chainStopCategory,
    groupState, stopMode, stopState, workStatus, runPhase, runState, requestState, estimateState, budgetMode, blockerScope, progressStep,
  },
} as const;
