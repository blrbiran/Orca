/**
 * task 8. `App` owns the ONLY side effects in this package: it fetches (via
 * `web/src/api.ts`) and then feeds the result to pure components that a
 * criterion can render with `renderToStaticMarkup` (plan ruling 2) --
 * `PanelHome` for the default view (task 8 ruling K5) and `DecisionDetail`
 * for whichever row was opened. `useEffect` never runs during static
 * server rendering, so this component's own render is never exercised
 * against a live server in a test; `PanelHome` and `DecisionDetail` carry
 * that weight instead.
 *
 * *** ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3, ruling R66) ***
 * The first version `void`ed both POSTs, so a refused Agree or Correct changed
 * nothing on the page, and a successful one left the row on the to-do list
 * until reload. Every outcome is now shown: a refusal through `Refusal` (with
 * "record another" when the server names `again`), a success as a status line
 * followed by a refetch of the to-do list and metrics. A load failure renders
 * `ErrorPage` with the server's code and message. `Refusal` and `ErrorPage`
 * are pure and carry the criteria (web/tests/outcome.test.tsx).
 */
import { useEffect, useReducer, useRef, useState } from "react";
import type { JSX } from "react";
import {
  correctionBody,
  failureFrom,
  fetchChains,
  fetchDecision,
  fetchMetrics,
  fetchTodo,
  recordCorrection,
  recordReview,
  requestChainStart,
  requestChainStop,
  startChainBody,
} from "./api.js";
import type { PanelRefusal, PostResult, RecordCorrectionInput } from "./api.js";
import { bannersFor, readDismissed, writeDismissed } from "./chainBanner.js";
import { ChainPanel } from "./ChainPanel.js";
import type { ChainOutcome } from "./ChainPanel.js";
import {
  commandEnvelope,
  controlCommandPath,
  controlFailureFrom,
  fetchControlConfig,
  fetchControlGroup,
  fetchControlRecovery,
  fetchControlSummary,
  nextCommandId,
  readUncertainCommands,
  recoverUncertainCommand,
  refusalFromAnswer,
  sendControlCommand,
  writeUncertainCommands,
} from "./controlApi.js";
import type { ControlAction } from "./controlApi.js";
import { ControlPanel } from "./ControlPanel.js";
import { initialControlState, reduceControlState, summaryView } from "./controlState.js";
import type { UncertainCommand } from "./controlState.js";
import type { ControlConfigV1 } from "./controlTypes.js";
import { DecisionDetail } from "./DecisionDetail.js";
import type { Decision } from "./DecisionDetail.js";
import { ErrorPage } from "./ErrorPage.js";
import { PanelHome } from "./PanelHome.js";
import { Refusal } from "./Refusal.js";
import { acceptArrival } from "./selection.js";
import type { ChainRepoView, DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

/** localStorage, or undefined where touching it throws. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** sessionStorage: an unresolved command id survives a reload, a page refresh does not outlive the tab. */
function browserSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The control summary is polled this fast (spec §9.2); the panel itself never pushes. */
const CONTROL_POLL_MS = 2_000;

interface HomeState {
  todo: DecisionListRow[];
  report: MetricsReport;
  coverage: PanelCoverage;
}

type Outcome = { kind: "recorded"; text: string } | { kind: "refused"; refusal: PanelRefusal };

export function App(): JSX.Element {
  const [home, setHome] = useState<HomeState | null>(null);
  const [error, setError] = useState<PanelRefusal | null>(null);
  const [selected, setSelected] = useState<DecisionListRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lastCorrection, setLastCorrection] = useState<RecordCorrectionInput | null>(null);
  /** The row whose answer may still be applied; read by `acceptArrival` when one arrives. */
  const wanted = useRef<DecisionListRow | null>(null);

  const [chains, setChains] = useState<ChainRepoView[] | null>(null);
  const [chainOutcome, setChainOutcome] = useState<ChainOutcome | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(browserStorage()));

  /** Null while the control plane is not mounted on this panel; then the page shows no control section at all. */
  const [controlConfig, setControlConfig] = useState<ControlConfigV1 | null>(null);
  // The ids still waiting on a lookup are restored in the initializer, not in an
  // effect: the effect that mirrors the reducer's list back into sessionStorage runs
  // on the very same mount commit, and would clear the key before anything read it.
  const [control, dispatchControl] = useReducer(reduceControlState, undefined, () => ({
    ...initialControlState(), uncertainCommandIds: readUncertainCommands(browserSession()),
  }));
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  /** The reducer's latest value, for callbacks that outlive the render they were built in. */
  const controlNow = useRef(control);
  controlNow.current = control;
  /** Command ids whose lookup is already in flight, so one tick does not ask twice. */
  const resolving = useRef<Set<string>>(new Set());

  const loadChains = async (): Promise<void> => {
    try {
      setChains((await fetchChains()).repos);
    } catch (err) {
      setChainOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
  };
  // Spec §6.2: the banner appears when a chain stops, so the status is re-read while the page is open.
  useEffect(() => {
    void loadChains();
    const timer = setInterval(() => void loadChains(), 5_000);
    return () => clearInterval(timer);
  }, []);

  const chainAction = async (act: () => Promise<ChainOutcome>): Promise<void> => {
    try {
      setChainOutcome(await act());
    } catch (err) {
      setChainOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
    await loadChains();
  };

  /**
   * Spec §9.2: the summary is polled, never pushed. Once the client has an epoch,
   * a tick asks only for what moved (`sinceChangeSeq`) -- a partial answer that
   * must not evict the groups it does not mention. A voided cache asks for
   * everything instead.
   */
  const readControlTick = async (): Promise<void> => {
    const state = controlNow.current;
    const since = state.epoch !== null && !state.refetchRequired ? state.changeSeq : undefined;
    try {
      const summary = await fetchControlSummary(since);
      dispatchControl({ type: "summary", value: summary, partial: since !== undefined });
      dispatchControl({ type: "recovery", value: await fetchControlRecovery() });
    } catch (err) {
      dispatchControl({ type: "refusal", groupId: null, value: controlFailureFrom(err) });
    }
    for (const command of controlNow.current.uncertainCommandIds) void resolveUncertain(command);
  };

  const readControlGroup = async (groupId: string): Promise<void> => {
    try {
      dispatchControl({ type: "group", value: await fetchControlGroup(groupId) });
    } catch (err) {
      dispatchControl({ type: "refusal", groupId, value: controlFailureFrom(err) });
    }
  };

  /**
   * A command the browser lost the answer to is looked up, never re-issued: the
   * ledger dedupes on the whole raw envelope, so a fresh id would be a second
   * intent -- possibly a second execution -- rather than a retry of this one.
   */
  const resolveUncertain = async (command: UncertainCommand): Promise<void> => {
    const id = `${command.groupId}\0${command.commandId}`;
    if (resolving.current.has(id)) return;
    resolving.current.add(id);
    const result = await recoverUncertainCommand(command.groupId, command.commandId);
    resolving.current.delete(id);
    if (result.kind === "unresolved") {
      // The lookup told us nothing, so the command is still unresolved: keep the id
      // for the next tick and show why this round could not conclude.
      dispatchControl({ type: "refusal", groupId: command.groupId, value: result.refusal });
      return;
    }
    dispatchControl({ type: "command-resolved", value: command });
    if (result.kind === "absent") dispatchControl({ type: "refusal", groupId: command.groupId, value: result.refusal });
    await readControlGroup(command.groupId);
  };

  /** Send one intent. Whatever the ledger says afterwards is read, not inferred here. */
  const sendControl = async (action: ControlAction): Promise<void> => {
    const commandId = nextCommandId();
    const command = { groupId: action.groupId, commandId };
    dispatchControl({ type: "command-uncertain", value: command });
    const answer = await sendControlCommand(controlCommandPath(action), commandEnvelope(commandId, action));
    if (answer.kind === "uncertain") {
      // The id stays where it is: sessionStorage keeps it across a reload, and the
      // next tick looks it up. The page shows that the outcome is unknown.
      dispatchControl({ type: "refusal", groupId: action.groupId, value: answer.refusal });
      return;
    }
    dispatchControl({ type: "command-resolved", value: command });
    if (answer.status >= 400) dispatchControl({ type: "refusal", groupId: action.groupId, value: refusalFromAnswer(answer) });
    await readControlGroup(action.groupId);
  };

  useEffect(() => {
    void (async () => {
      try {
        setControlConfig(await fetchControlConfig());
      } catch {
        setControlConfig(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (controlConfig === null) return;
    // A command id that survived the reload is resolved before anything else reads.
    for (const command of controlNow.current.uncertainCommandIds) void resolveUncertain(command);
    void readControlTick();
    const timer = setInterval(() => void readControlTick(), CONTROL_POLL_MS);
    return () => clearInterval(timer);
  }, [controlConfig]);

  useEffect(() => {
    writeUncertainCommands(browserSession(), control.uncertainCommandIds);
  }, [control.uncertainCommandIds]);

  // Opening a group, a voided cache and a projection gap all mean: re-read it canonically.
  useEffect(() => {
    if (controlConfig === null || selectedGroup === null) return;
    const cached = control.canonical[selectedGroup] !== undefined;
    if (cached && !control.refetchRequired) return;
    void readControlGroup(selectedGroup);
  }, [controlConfig, selectedGroup, control.canonical, control.refetchRequired]);

  const loadHome = async (): Promise<void> => {
    try {
      const [todoBody, metrics] = await Promise.all([fetchTodo(), fetchMetrics()]);
      setHome({ todo: todoBody.rows, report: metrics.report, coverage: metrics.panel_review_coverage });
    } catch (err) {
      setError(failureFrom(err));
    }
  };

  useEffect(() => {
    void loadHome();
  }, []);

  /**
   * Parked finding N-1 / ruling R71. Opening another row takes the previous
   * decision off the screen FIRST, so the buttons and the text under them can
   * never mean two different decisions; and an answer is only applied when it
   * is still the one being waited for, so a slow answer that arrives after the
   * person moved on is dropped instead of repainting the page behind them.
   */
  useEffect(() => {
    setOutcome(null);
    setLastCorrection(null);
    setDecision(null);
    wanted.current = selected;
    if (selected === null) return;
    void (async () => {
      try {
        const body = await fetchDecision(selected.projectKey, selected.id);
        if (!acceptArrival(wanted.current, selected)) return;
        setDecision(body.decision as Decision);
      } catch (err) {
        if (!acceptArrival(wanted.current, selected)) return;
        setError(failureFrom(err));
      }
    })();
  }, [selected]);

  /** Shows what happened; after a success, refetches so the to-do list and coverage reflect it. */
  const send = async (post: () => Promise<PostResult<unknown>>, recorded: string): Promise<void> => {
    try {
      const result = await post();
      if (!result.ok) {
        setOutcome({ kind: "refused", refusal: result });
        return;
      }
      setOutcome({ kind: "recorded", text: recorded });
      await loadHome();
    } catch (err) {
      setOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
  };

  if (error !== null) return <ErrorPage failure={error} />;
  if (home === null) return <main>orca panel loading…</main>;

  return (
    <main>
      {chains !== null && (
        <ChainPanel
          repos={chains}
          banners={bannersFor(chains, dismissed)}
          outcome={chainOutcome}
          onDismiss={(chainId) => {
            const next = new Set(dismissed);
            next.add(chainId);
            setDismissed(next);
            writeDismissed(browserStorage(), next);
          }}
          onStart={(form) => {
            void chainAction(async () => {
              const r = await requestChainStart(startChainBody(form));
              return r.ok ? { kind: "started", chainId: r.body.chainId } : { kind: "refused", refusal: r };
            });
          }}
          onStop={(repoKey, chainId) => {
            void chainAction(async () => {
              const r = await requestChainStop(repoKey, chainId);
              return r.ok ? { kind: "stop-requested", chainId } : { kind: "refused", refusal: r };
            });
          }}
        />
      )}
      {controlConfig !== null && control.recovery !== null && (
        <ControlPanel
          config={controlConfig}
          summary={summaryView(control)}
          recovery={control.recovery}
          groups={control.canonical}
          selected={selectedGroup}
          drafts={control.drafts}
          uncertain={control.uncertainCommandIds}
          refusal={control.refusal}
          refetchRequired={control.refetchRequired}
          onSelect={setSelectedGroup}
          onDraft={(key, text) => dispatchControl({ type: "draft", key, text })}
          onCommand={(action) => {
            void sendControl(action);
          }}
        />
      )}
      <PanelHome todo={home.todo} report={home.report} coverage={home.coverage} onOpen={setSelected} />
      {selected !== null && decision !== null && (
        <>
          <DecisionDetail
            decision={decision}
            onAgree={() => {
              void send(() => recordReview(selected.projectKey, selected.id), "Recorded as reviewed.");
            }}
            onCorrect={(form) => {
              const body = correctionBody({ projectKey: selected.projectKey, decisionId: selected.id }, form);
              setLastCorrection(body);
              void send(() => recordCorrection(body), "Correction recorded.");
            }}
          />
          {outcome?.kind === "recorded" && <p role="status">{outcome.text}</p>}
          {outcome?.kind === "refused" && (
            <Refusal
              refusal={outcome.refusal}
              onRecordAnother={() => {
                if (lastCorrection === null) return;
                void send(() => recordCorrection({ ...lastCorrection, again: true }), "Correction recorded.");
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
