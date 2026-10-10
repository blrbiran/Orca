// @vitest-environment jsdom
// Results5 continuation, /root/results5_impl, 2026-10-11: real App ownership and saved reads.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AccountContext, AuthGate } from "../src/AuthGate.js";
import { noteAnswer } from "../src/api.js";
import type { Me } from "../src/auth.js";
import type { RunResultsV1 } from "../src/controlTypes.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import { run, workItem } from "./fixtures/board.js";
import { savedGroup, savedRun } from "./fixtures/results.js";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const me = (id: string): Me => ({ user: { id, name: id, roles: ["member"], mustChangePassword: false }, expiresAt: Date.now()+100000000, sessionDays: 1 });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); };
beforeEach(() => { window.location.hash = "tasks"; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });
function setup() {
 const summary = groupSummary("g", ALPHA, { state: "done" });
 const group = planGroupView(summary); group.workItems=[workItem({taskId:"a",status:"completed",currentRunId:"run-a",lineageRunIds:["run-a"]})]; group.runs=[run({state:"settled-recoverable",outcome:"succeeded"})];
 const panel = installFakePanel({groupViews:{g:group}}); panel.summary.changeSeq=4; panel.summary.groups=[summary];
 const base=globalThis.fetch; let result=savedRun(); let held:Promise<Response>|null=null; let outputResponse: (()=>Promise<Response>)|null=null;
 const reads:Array<{path:string;signal:AbortSignal|null|undefined}>=[];
 globalThis.fetch=(async(input,init)=>{
  const path=String(input);
  if(path==="/api/auth/me") return json(me("one"));
  if(path==="/api/auth/logout") return json({});
  if(path.includes("/results")) { reads.push({path,signal:init?.signal}); if(held) return held; if(path.includes("/outputs/") && outputResponse) return outputResponse(); return json(path.includes("/groups/")?savedGroup(result):result); }
  return base(input,init);
 }) as typeof fetch;
 return {panel,group,reads,get result(){return result;},set result(value:RunResultsV1){result=value;},hold(value:Promise<Response>|null){held=value;},output(value:()=>Promise<Response>){outputResponse=value;}};
}
async function open() { await flush(); fireEvent.click(screen.getByRole("button",{name:/^g ·/})); await flush(); }
function task() { return within(screen.getByRole("region",{name:"Task a"})); }
async function openTask() { fireEvent.click(screen.getByRole("tab",{name:"Progress"})); fireEvent.click(screen.getByRole("button",{name:"a"})); await flush(); fireEvent.click(screen.getByRole("tab",{name:"Results"})); await flush(); }
it("real App completed missing results retain actual success and independent source unsupported",async()=>{
 const s=setup();s.result=savedRun({source:{status:"unsupported",reason:"old-peer"},availability:"missing",currentExplanation:{status:"missing",reason:null,content:null},attempts:[]});render(<App/>);await open();
 expect(screen.getByRole("tab",{selected:true}).textContent).toBe("Results");const current=screen.getByRole("region",{name:"Current result · run-a"});expect(current.textContent).toContain("succeeded");expect(current.textContent).toContain("missing");expect(screen.getByText(/Source: unsupported/)).toBeTruthy();expect(s.reads.map(r=>r.path)).toEqual(["/api/control/groups/g/results"]);expect(s.panel.posts).toHaveLength(0);
});
it("real App opens the task route and preserves mounted local drafts and focus across refresh and hidden sections",async()=>{
 const s=setup();render(<App/>);await open();await openTask();expect(s.reads.some(r=>r.path==="/api/control/runs/run-a/results")).toBe(true);expect(task().getByRole("region",{name:"Current result · run-a"}).textContent).toContain("Saved work");
 const draft=task().getByRole("textbox",{name:"Custom label"});fireEvent.change(draft,{target:{value:"pending draft"}});draft.focus();await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(document.activeElement).toBe(draft);expect((draft as HTMLInputElement).value).toBe("pending draft");
 fireEvent.click(screen.getByRole("link",{name:"Memory"}));await flush();const count=s.reads.length;await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(s.reads).toHaveLength(count);
 fireEvent.click(screen.getByRole("link",{name:"Task control"}));await flush();expect((task().getByRole("textbox",{name:"Custom label"}) as HTMLInputElement).value).toBe("pending draft");expect(s.panel.posts).toHaveLength(0);
 fireEvent.click(screen.getByRole("tab",{name:"Progress"}));const stopped=s.reads.length;await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(s.reads).toHaveLength(stopped);fireEvent.click(screen.getByRole("button",{name:"a"}));expect(screen.queryByRole("region",{name:"Task a"})).toBeNull();
});
it.each(["scope","auth","epoch","owner"])("real App cancels held task reads across %s and keeps navigation focus",async(kind)=>{
 const s=setup();const rendered=render(<AccountContext.Provider value={me("one")}><App/></AccountContext.Provider>);await open();await openTask();let release!:(r:Response)=>void;s.hold(new Promise(r=>release=r));await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const held=s.reads.at(-1)!;
 if(kind==="scope")fireEvent.change(screen.getByRole("combobox",{name:"Project"}),{target:{value:"beta"}});
 if(kind==="auth")rendered.rerender(<AccountContext.Provider value={me("two")}><App/></AccountContext.Provider>);
 if(kind==="epoch"){s.panel.summary.epoch="epoch-b";s.panel.recovery.epoch="epoch-b";s.group.epoch="epoch-b";s.group.changeSeq=5;s.panel.summary.changeSeq=5;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});}
 if(kind==="owner"){s.group.workItems[0]!.currentRunId="run-b";s.group.workItems[0]!.lineageRunIds=["run-a","run-b"];s.group.runs.push(run({runId:"run-b"}));s.group.changeSeq=5;s.panel.summary.changeSeq=5;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});}
 await flush();expect(held.signal?.aborted).toBe(true);const focus=screen.getByRole("link",{name:"Memory"});focus.focus();const obsolete=savedRun();obsolete.currentExplanation={status:"available",reason:null,content:{...obsolete.currentExplanation.content!,completedWork:["obsolete result"]}};
 await act(async()=>{release(json(obsolete));});await flush();expect(screen.queryByText("obsolete result")).toBeNull();expect(document.activeElement).toBe(focus);expect(s.panel.posts).toHaveLength(0);
});
it("real App task rejects foreign generation and changed execution identity",async()=>{
 const s=setup();render(<App/>);await open();await openTask();s.result=savedRun({generation:2});s.result.run.generation=2;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(task().getByRole("alert").textContent).toContain("result-response-stale");
 s.result=savedRun({executionId:"foreign-execution",captureRevision:4});await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(task().getByRole("alert").textContent).toContain("result-response-stale");
});
it("real App keeps the latest saved capture when a lower same-owner reply arrives",async()=>{
 const s=setup();s.result=savedRun({captureRevision:8});s.result.currentExplanation.content!.completedWork=["newest work"];render(<App/>);await open();await openTask();s.result=savedRun({captureRevision:7});await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(task().getByRole("region",{name:"Current result · run-a"}).textContent).toContain("newest work");expect(within(task().getByRole("region",{name:"Current result · run-a"})).queryByText("Saved work")).toBeNull();
});
it("real App honors independently newer same-index attempt with missing capture instead of reusing saved work",async()=>{
 const s=setup();render(<App/>);await open();await openTask();s.result=savedRun({currentAttempt:2,currentExplanation:{status:"missing",reason:null,content:null}});s.result.attempts[0]!.current=false;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const current=task().getByRole("region",{name:"Current result · run-a"});expect(current.textContent).toContain("attempt 2");expect(current.textContent).not.toContain("Saved work");expect(task().getByRole("region",{name:"Saved attempt 1 · run-a",hidden:true}).textContent).toContain("Saved work");
 s.result=savedRun();await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const retained=task().getByRole("region",{name:"Current result · run-a"});expect(retained.textContent).toContain("attempt 2");expect(retained.textContent).not.toContain("Saved work");
});
it("AuthGate logout removes active result owners and aborts held result reads",async()=>{
 const s=setup();render(<AuthGate><App/></AuthGate>);await open();let release!:(r:Response)=>void;s.hold(new Promise(r=>release=r));await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const held=s.reads.at(-1)!;fireEvent.click(screen.getByRole("button",{name:"Log out"}));await flush();expect(held.signal?.aborted).toBe(true);await act(async()=>{release(json(savedGroup()));});expect(screen.queryByRole("region",{name:"Group results"})).toBeNull();expect(screen.getByRole("button",{name:"Log in"})).toBeTruthy();
});
it("auth notification synchronously retires held result requests before App rerender",async()=>{
 const s=setup();render(<App/>);await open();let release!:(r:Response)=>void;s.hold(new Promise(r=>release=r));await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const held=s.reads.at(-1)!;act(()=>noteAnswer(401,{error:{code:"login-required"}}));expect(held.signal?.aborted).toBe(true);await act(async()=>{release(json(savedGroup()));});expect(screen.queryByText("Saved work")).toBeNull();
});

it("real App saved attachment carries exact binary bytes through the owned route without commands",async()=>{
 const s=setup();s.result.attempts[0]!.outputs[0]!.byteLength=4;let blob:Blob|null=null;let attachment="";Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn((value:Blob)=>{blob=value;return "blob:saved";})});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){attachment=this.download;});let count=0;
 s.output(async()=>++count===1?json({schema:"orca-result-output-v1",runId:"run-a",groupId:"g",attempt:1,outputId:"owned-output",path:"a.html",status:"binary",byteLength:4,content:null,downloadUrl:"/api/control/runs/run-a/results/outputs/owned-output?download=1"}):new Response(new Uint8Array([0,255,13,10])));
 render(<App/>);await open();const current=within(screen.getByRole("region",{name:"Current result · run-a"}));fireEvent.click(current.getByRole("button",{name:"Preview saved output · Saved HTML"}));await flush();expect(current.getByRole("region",{name:"Saved output · a.html"}).textContent).toContain("binary");fireEvent.click(current.getByRole("button",{name:"Download saved output · a.html"}));await flush();expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([0,255,13,10]);expect(attachment).toBe("owned-output");expect(s.reads.map(r=>r.path)).toEqual(["/api/control/groups/g/results","/api/control/runs/run-a/results/outputs/owned-output","/api/control/runs/run-a/results/outputs/owned-output?download=1"]);expect(s.panel.posts).toHaveLength(0);
});
it.each(["scope","auth","epoch","hide"])("real App drops held output previews across %s ownership",async(kind)=>{
 const s=setup();const rendered=render(<AccountContext.Provider value={me("one")}><App/></AccountContext.Provider>);await open();let release!:(r:Response)=>void;s.output(()=>new Promise(r=>release=r));fireEvent.click(within(screen.getByRole("region",{name:"Current result · run-a"})).getByRole("button",{name:"Preview saved output · Saved HTML"}));await flush();const held=s.reads.at(-1)!;
 if(kind==="scope")fireEvent.change(screen.getByRole("combobox",{name:"Project"}),{target:{value:"beta"}});
 if(kind==="auth")rendered.rerender(<AccountContext.Provider value={me("two")}><App/></AccountContext.Provider>);
 if(kind==="epoch"){s.panel.summary.epoch="epoch-b";s.panel.recovery.epoch="epoch-b";s.group.epoch="epoch-b";s.group.changeSeq=5;s.panel.summary.changeSeq=5;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});}
 if(kind==="hide")fireEvent.click(screen.getByRole("link",{name:"Memory"}));await flush();expect(held.signal?.aborted).toBe(true);await act(async()=>{release(json({schema:"orca-result-output-v1",runId:"run-a",groupId:"g",attempt:1,outputId:"owned-output",path:"a.html",status:"available",byteLength:13,content:"obsolete preview",downloadUrl:null}));});expect(screen.queryByText("obsolete preview")).toBeNull();expect(s.panel.posts).toHaveLength(0);
});
it("real App group rejects nested stale changeSeq and foreign generation independently of top-level projection",async()=>{
 const s=setup();render(<App/>);await open();s.result=savedRun({changeSeq:3});await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByRole("alert").textContent).toContain("result-response-stale");s.result=savedRun({generation:2});s.result.run.generation=2;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByRole("alert").textContent).toContain("result-response-stale");
});

it("real App retry or continuation predecessor remains saved history while the new current run has no capture",async()=>{
 const s=setup();s.group.summary.state="running";s.group.workItems[0]!.status="active";s.group.workItems[0]!.currentRunId="run-b";s.group.workItems[0]!.lineageRunIds=["run-a","run-b"];s.group.runs.push(run({runId:"run-b"}));const predecessor=savedRun();s.result=savedRun({runId:"run-b",executionId:null,currentAttempt:1,captureRevision:0,attempts:[],availability:"missing",source:{status:"missing",reason:null},currentExplanation:{status:"missing",reason:null,content:null},run:{...run({runId:"run-b"}),blockedReason:null,continuable:false}});
 const base=globalThis.fetch;globalThis.fetch=(async(input,init)=>String(input)==="/api/control/runs/run-a/results"?json(predecessor):base(input,init)) as typeof fetch;render(<App/>);await open();await openTask();const current=task().getByRole("region",{name:"Current result · run-b"});expect(current.textContent).toContain("missing");expect(current.textContent).not.toContain("Saved work");expect(task().queryByRole("region",{name:"Current result · run-a"})).toBeNull();expect(task().getByRole("region",{name:"Saved attempt 1 · run-a",hidden:true}).textContent).toContain("Saved work");expect(s.panel.posts).toHaveLength(0);
});

// Review fix R1: nullable display must not erase independent known attempt authority.
it.each(["task","group"])("real App %s preserves known attempt high-water through 2 -> null -> 1 at one capture",async consumer=>{
 const s=setup();s.result=savedRun({currentAttempt:2,currentExplanation:{status:"missing",reason:null,content:null}});s.result.attempts[0]!.current=false;render(<App/>);await open();if(consumer==="task")await openTask();const owner=()=>consumer==="task"?task():within(screen.getByRole("region",{name:"Group results"}));
 expect(owner().getByRole("region",{name:"Current result · run-a"}).textContent).toContain("attempt 2");s.result=savedRun({currentAttempt:null,source:{status:"stale",reason:"capture-stale"},currentExplanation:{status:"unavailable",reason:"current-attempt-unavailable",content:null}});s.result.attempts[0]!.current=false;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});const unknown=owner().getByRole("region",{name:"Current result · run-a"});expect(unknown.textContent).toContain("attempt unknown");expect(unknown.textContent).not.toContain("Saved work");
 s.result=savedRun();await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(owner().getByRole("alert").textContent).toContain("result-response-stale");const retained=owner().getByRole("region",{name:"Current result · run-a"});expect(retained.textContent).toContain("attempt unknown");expect(retained.textContent).not.toContain("Saved work");expect(s.panel.posts).toHaveLength(0);
});

it.each(["task","group"])("real App %s account switch resets remembered attempt authority",async consumer=>{
 const s=setup();s.result=savedRun({currentAttempt:2,currentExplanation:{status:"missing",reason:null,content:null}});s.result.attempts[0]!.current=false;const app=render(<AccountContext.Provider value={me("one")}><App/></AccountContext.Provider>);await open();if(consumer==="task")await openTask();s.result=savedRun();app.rerender(<AccountContext.Provider value={me("two")}><App/></AccountContext.Provider>);await flush();const owner=consumer==="task"?task():within(screen.getByRole("region",{name:"Group results"}));expect(owner.getByRole("region",{name:"Current result · run-a"}).textContent).toContain("attempt 1");expect(owner.queryByRole("alert")).toBeNull();
});
