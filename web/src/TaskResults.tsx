import { useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupViewV1, ResultAttemptV1, ResultExplanationV1, RunResultsV1, WorkItemViewV1 } from "./controlTypes.js";
import { enumText } from "./i18n.js";
import { fetchRunResults } from "./resultApi.js";
import { useResultsRead } from "./useResultsRead.js";
import { ResultOutput } from "./ResultOutput.js";
import { SafeMarkdown } from "./SafeMarkdown.js";
function Explanation({ explanation }: { explanation: ResultExplanationV1 }): JSX.Element {
 const { t } = useTranslation(); const content = explanation.status === "available" ? explanation.content : null;
 return <>
  <h5>{t("results.agentExplanation")}</h5>
  <p>{t("results.explanation", { status: t(`results.explanationStatus.${explanation.status}`) })}{explanation.reason !== null && <> · <code>{explanation.reason}</code></>}</p>
  {content !== null && <>
   <h6>{t("results.goal")}</h6><SafeMarkdown text={content.goal} />
   <h6>{t("results.work")}</h6><ul>{content.completedWork.map((text, i) => <li key={i}><SafeMarkdown text={text}/></li>)}</ul>
   <h6>{t("results.conclusions")}</h6><ul>{content.conclusions.map((text, i) => <li key={i}><SafeMarkdown text={text}/></li>)}</ul>
   <h6>{t("results.reportedOutputs")}</h6><ul>{content.outputs.map((output, i) => <li key={i}>{output.label} · <code>{output.path}</code></li>)}</ul>
   <h6>{t("results.limitations")}</h6>{content.limitations.length === 0 ? <p>{t("common.none")}</p> : <ul>{content.limitations.map((text, i) => <li key={i}><SafeMarkdown text={text}/></li>)}</ul>}
  </>}
 </>;
}
function Attempt({ value, attempt, explanation, active, identity }: { value: RunResultsV1; attempt: ResultAttemptV1 | undefined; explanation: ResultExplanationV1; active: boolean; identity: string }): JSX.Element {
 const { t } = useTranslation();
 return <>
  <p>{t("results.identity", {runId:value.runId,generation:value.generation,executionId:value.executionId ?? t("common.na"),attempt:attempt?.attempt ?? value.currentAttempt ?? t("results.unknown"),snapshot:attempt?.snapshotRevision ?? t("results.unavailable"),revision:attempt?.revision ?? t("results.unavailable"),capture:value.captureRevision})}</p>
  <p>{t("results.execution", { status: t(`results.executionStatus.${attempt?.execution ?? "unavailable"}`) })} · {t("results.verification", { status: t(`results.verificationStatus.${attempt?.verification ?? "unavailable"}`) })}</p>
  <Explanation explanation={explanation}/>
  <h5>{t("results.outputs")}</h5>
  {attempt === undefined || attempt.outputs.length === 0 ? <p>{t("common.none")}</p> : <ul>{attempt.outputs.map(output => <ResultOutput key={output.outputId} runId={value.runId} groupId={value.groupId} attempt={attempt.attempt} output={output} active={active} identity={JSON.stringify([identity,value.runId,attempt.attempt,attempt.snapshotRevision,attempt.revision,value.captureRevision])}/>)}</ul>}
  {attempt !== undefined && <details><summary>{t("results.observations")}</summary><ul>{attempt.observations.map(observation => <li key={observation.revision}>{t("results.observation",{revision:observation.revision,stage:t(`results.stage.${observation.stage}`),verification:t(`results.verificationStatus.${observation.verification}`)})}</li>)}</ul></details>}
 </>;
}
export function SavedRunResult({value,active,identity,current=true}:{value:RunResultsV1;active:boolean;identity:string;current?:boolean}):JSX.Element {
 const { t } = useTranslation();
 const attempt = value.currentAttempt === null ? undefined : value.attempts.find(candidate => candidate.attempt === value.currentAttempt && candidate.current);
 return <div className="saved-result">
  <p>{t("results.source",{status:t(`results.sourceStatus.${value.source.status}`)})}{value.source.reason !== null && <> · <code>{value.source.reason}</code></>}</p>
  {current && <section aria-label={t("results.currentRegion",{runId:value.runId})}>
   <p>{t("results.actualRun",{state:enumText("runState",value.run.state),outcome:value.run.outcome == null ? t("results.unknown") : enumText("progressStep",value.run.outcome)})}</p>
   <Attempt value={value} attempt={attempt} explanation={value.currentExplanation} active={active} identity={identity}/>
  </section>}
  {value.attempts.length > 0 && <details><summary>{t("results.history",{runId:value.runId})}</summary>
   {value.attempts.map(saved => <section key={saved.attempt} aria-label={t("results.attemptRegion",{runId:value.runId,attempt:saved.attempt})}>
    <p>{t("results.savedHistory")}</p><Attempt value={value} attempt={saved} explanation={saved.explanation} active={active} identity={identity}/>
   </section>)}
  </details>}
 </div>;
}
/** Capture revisions and execution identity belong to a run; source attempt facts may advance without a new capture. */
interface SavedRunAuthority { currentAttempt: number | null; executionId: string | null }
export function freshSavedRun(answer: RunResultsV1, prior?: RunResultsV1, authority?: SavedRunAuthority): boolean {
 const knownAttempt = authority?.currentAttempt ?? prior?.currentAttempt ?? null;
 const knownExecution = authority?.executionId ?? prior?.executionId ?? null;
 return answer.captureRevision >= (prior?.captureRevision ?? 0)
  && (knownExecution === null || answer.executionId === knownExecution)
  && (knownAttempt === null || answer.currentAttempt === null || answer.currentAttempt >= knownAttempt);
}
/** Remember authority separately from nullable display DTOs, across read/pane refreshes for the same immutable owner. */
export function useSavedRunAuthority(owner: string) {
 const memory = useRef({ owner, runs: new Map<string, SavedRunAuthority>() });
 if (memory.current.owner !== owner) memory.current = { owner, runs: new Map() };
 const key = (run: RunResultsV1): string => JSON.stringify([run.runId, run.generation]);
 return {
  admit: (run: RunResultsV1, prior?: RunResultsV1): boolean => freshSavedRun(run, prior, memory.current.runs.get(key(run))),
  remember: (runs: RunResultsV1[]): void => {
   for (const run of runs) {
    const known = memory.current.runs.get(key(run));
    memory.current.runs.set(key(run), {
     currentAttempt: run.currentAttempt === null ? known?.currentAttempt ?? null : Math.max(run.currentAttempt, known?.currentAttempt ?? 0),
     executionId: run.executionId ?? known?.executionId ?? null,
    });
   }
  },
 };
}
export function TaskResults(props:{view:GroupViewV1;item:WorkItemViewV1;active:boolean;scope:string}):JSX.Element {
 const { t }=useTranslation(); const {view,item}=props;
 const runs=view.runs.filter(run=>run.taskId===item.taskId);
 const runIds=runs.map(run=>run.runId);
 const identity=JSON.stringify([props.scope,view.epoch,view.changeSeq,view.summary.groupId,item.taskId,item.currentRunId,item.pendingRunId,runs.map(run=>[run.runId,run.generation])]);
 const authority=useSavedRunAuthority(JSON.stringify([props.scope,view.epoch,view.summary.groupId,item.taskId]));
 const state=useResultsRead(props.active,identity,signal=>Promise.all(runIds.map(id=>fetchRunResults(id,signal))), (answers,prior)=>{ const accepted=answers.every((answer,index)=>answer.schema==="orca-run-results-v1" && answer.epoch===view.epoch && answer.changeSeq>=view.changeSeq && answer.groupId===view.summary.groupId && answer.taskId===item.taskId && answer.runId===runIds[index] && answer.generation===runs[index]?.generation && answer.run.generation===answer.generation && answer.run.runId===answer.runId && answer.run.taskId===answer.taskId && authority.admit(answer,prior?.[index])); if (accepted) authority.remember(answers); return accepted; });
 return <section hidden={!props.active} aria-label={t("results.taskRegion",{taskId:item.taskId})}>
  <h4>{t("results.taskRegion",{taskId:item.taskId})}</h4><p>{t("results.taskStatus",{taskId:item.taskId,status:enumText("workStatus",item.status)})}</p>
  {runIds.length===0 && <p>{t("results.notProduced")}</p>}
  {state.error!==null && <p role="alert">{t("results.refused",{code:state.error})}</p>}
  {state.value?.map(value=><SavedRunResult key={value.runId} value={value} current={value.runId===item.currentRunId} active={props.active} identity={identity}/>)}
 </section>;
}
