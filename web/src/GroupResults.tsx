import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupViewV1 } from "./controlTypes.js";
import { enumText } from "./i18n.js";
import { fetchGroupResults } from "./resultApi.js";
import { useSavedRunAuthority, SavedRunResult } from "./TaskResults.js";
import { useResultsRead } from "./useResultsRead.js";
export function GroupResults(props:{view:GroupViewV1;active:boolean;scope:string}):JSX.Element {
 const {t}=useTranslation();const {view}=props;
 const identity=JSON.stringify([props.scope,view.epoch,view.changeSeq,view.summary.groupId]);
 const authority=useSavedRunAuthority(JSON.stringify([props.scope,view.epoch,view.summary.groupId]));
 const state=useResultsRead(props.active,identity,signal=>fetchGroupResults(view.summary.groupId,signal),(answer,prior)=>{ const accepted=answer?.schema==="orca-group-results-v1" && answer.epoch===view.epoch && answer.groupId===view.summary.groupId && answer.changeSeq>=view.changeSeq && answer.tasks.every(task=>task.runs.every(run=>run.groupId===answer.groupId && run.taskId===task.taskId && run.epoch===answer.epoch && run.changeSeq>=view.changeSeq && run.changeSeq>=answer.changeSeq && run.run.runId===run.runId && run.run.taskId===run.taskId && run.run.generation===run.generation && (view.runs.find(core=>core.runId===run.runId)?.generation ?? run.generation)===run.generation && authority.admit(run,prior?.tasks.find(old=>old.taskId===task.taskId)?.runs.find(old=>old.runId===run.runId)))); if (accepted) authority.remember(answer.tasks.flatMap(task=>task.runs)); return accepted; });
 const value=state.value;
 return <section aria-label={t("results.groupRegion")} className="group-results">
  {value===null && <p role="status">{t(view.summary.state==="done"?"detail.resultsMissing":"detail.resultsNotProduced")}</p>}
  {state.error!==null && <p role="alert">{t("results.refused",{code:state.error})}</p>}
  {value!==null && <>
   <h3>{t("results.groupRegion")}</h3><p>{value.goal}</p><ul>{value.successConditions.map((condition,i)=><li key={i}>{condition}</li>)}</ul>
   <p>{t("results.coverage",value.coverage)}</p>
   <h4>{t("results.goalReview")}</h4>
   {value.review.runs.length===0?<p>{t("results.reviewNotRun")}</p>:<ul>{value.review.runs.map(run=><li key={run.runId}>{run.runId} · {enumText("runState",run.state)} · {run.outcome == null ? t("results.unknown") : enumText("progressStep",run.outcome)}</li>)}</ul>}
   <h4>{t("results.delivery")}</h4><p>{value.delivery===null?t("results.deliveryUnavailable"):t("results.deliveryStatus",{state:t(`control.integration.state.${value.delivery.state}`),commit:value.delivery.integratedCommit ?? t("common.none")})}</p>
   {value.tasks.map(task=><section key={task.taskId} aria-label={t("results.taskRegion",{taskId:task.taskId})}>
    <h4>{task.taskId}</h4><p>{t("results.taskStatus",{taskId:task.taskId,status:enumText("workStatus",task.status)})} · {t(`results.availability.${task.availability}`)}</p>
    {task.pendingRunId!==null && <p>{t("results.pendingRun",{runId:task.pendingRunId})}</p>}
    {task.runs.map(run=><SavedRunResult key={run.runId} value={run} current={run.runId===task.currentRunId} active={props.active} identity={identity}/>)}
   </section>)}
  </>}
 </section>;
}
