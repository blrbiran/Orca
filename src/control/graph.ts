import { buildGraph, detectCycle } from "../scheduler/graph.js";
import type { WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
export function controlGraph(work:WorkInput[]) {
  const ids = new Set(work.map(w=>w.workItemId));
  const taskIds=work.filter(w=>w.taskId!==null && w.kind==="task").map(w=>w.taskId);
  if(new Set(taskIds).size!==taskIds.length) throw new ControlError("duplicate-task-id");
  for(const w of work) for(const dep of w.dependsOn) if(!ids.has(dep)) throw new ControlError("graph-dangling-dependency");
  const tasks=work.map(w=>({taskId:w.workItemId,dependsOn:w.dependsOn,contract:w.workItemId}));
  if(detectCycle(tasks)) throw new ControlError("graph-cycle");
  return buildGraph({targetRepo:"",ccloopBin:"",runsDir:"",workBranch:"",policy:"local-merge",ledgerMode:"in-repo",tasks},new Map(work.map(w=>[w.workItemId,w.contract])));
}
