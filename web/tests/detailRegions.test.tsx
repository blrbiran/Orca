// @vitest-environment jsdom
/** Task4: region defaults are presentation; eligibility remains with existing controls. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { AccountContext } from "../src/AuthGate.js";
import { config, view, workItem, run } from "./fixtures/board.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
afterEach(cleanup);
const mount = (value: GroupViewV1, focus?: import("../src/ControlGroupView.js").ControlGroupViewProps["focus"]) => render(<ControlGroupView view={value} focus={focus} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
const select = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const selected = () => screen.getByRole("tab", { selected: true }).textContent;
it.each([["draft", "Preparation"], ["running", "Progress"], ["review", "Progress"], ["done", "Results"]] as const)("stored %s defaults to %s", (state, region) => {
 const value = view([]); value.summary.state = state; mount(value);
 expect(selected()).toBe(region);
 if (state === "done") expect(screen.getByRole("tabpanel").textContent).toContain("explanation is missing");
});
it("explicit problem owner overrides default and a poll preserves manual region and focus", () => {
 const value = view([workItem({taskId:"a"})]); const focus = {kind:"group",groupId:"g",region:"problem",taskId:"a",runId:null} as const;
 const app=mount(value,focus); expect(selected()).toBe("Problems"); select("Technical details");
 const tab=screen.getByRole("tab",{name:"Technical details"}); tab.focus();
 app.rerender(<ControlGroupView view={{...value,summary:{...value.summary,state:"done"},changeSeq:5}} focus={focus} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
 expect(selected()).toBe("Technical details"); expect(document.activeElement).toBe(tab);
});
it("task form input stays mounted across regions and polls", () => {
 const value=view([workItem({taskId:"a"})]); const app=mount(value);
 fireEvent.click(screen.getAllByRole("button",{name:"a"})[0]!);
 const input=screen.getByRole("textbox",{name:"Custom label"}) as HTMLInputElement;
 fireEvent.change(input,{target:{value:"keep my unfinished text"}}); select("Preparation"); select("Progress");
 app.rerender(<ControlGroupView view={{...value,changeSeq:5}} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
 expect((screen.getByRole("textbox",{name:"Custom label"}) as HTMLInputElement).value).toBe("keep my unfinished text");
});
it("active and failed task facts remain visible together without inferring success", () => {
 const failed=run({runId:"failed",taskId:"b",state:"settled-failed",outcome:"failed",stopReason:"Error: codex-event-error"});
 mount(view([workItem({taskId:"a",status:"active"}),workItem({taskId:"b",status:"blocked",currentRunId:"failed",lineageRunIds:["failed"]})],[failed]));
 const panel=screen.getByRole("tabpanel");expect(panel.textContent).toContain("active");expect(panel.textContent).toContain("blocked");expect(within(panel).getByText(/reported an error/)).toBeTruthy();
 select("Problems");expect(screen.getByRole("tabpanel").textContent).toContain("settled-failed");
});
it("every region of an archived group remains read-only with unarchive available", () => {
 const value=view([workItem({taskId:"a",labels:["bug"]})]);value.summary.archived=true; mount(value);
 for(const name of ["Progress","Preparation","Problems","Results","Runs and evidence","Technical details"]){
  select(name); expect(screen.queryAllByRole("button",{name:/^(Start|Pause dispatch|Handoff stop|Resume|Continue|Retry|Set limit|Save|Confirm|Archive group)/})).toHaveLength(0);
  expect(screen.queryAllByRole("textbox").filter(x=>!(x as HTMLInputElement).readOnly)).toHaveLength(0);
 }
 expect(screen.getByRole("button",{name:"Unarchive"})).toBeTruthy();
});
it("member preparation preserves the owner-only limit restriction", () => {
 render(<AccountContext.Provider value={{user:{id:"m",name:"Member",roles:["member"],mustChangePassword:false},expiresAt:0,sessionDays:1}}><ControlGroupView view={view([])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} /></AccountContext.Provider>);
 select("Preparation"); expect(screen.queryByRole("button",{name:"Set limit"})).toBeNull();expect(screen.getByText("Only an owner can change the group limit.")).toBeTruthy();
});

it("repeated explicit navigation reopens the requested region and task after manual changes", () => {
 const value=view([workItem({taskId:"a"})]);const focus={kind:"group",groupId:"g",region:"problem",taskId:"a",runId:null} as const;
 const props={view:value,focus,config,uncertain:[],drafts:{},onDraft:vi.fn(),onCommand:vi.fn()};
 const app=render(<ControlGroupView {...props} focusRequest={1}/>);select("Progress");fireEvent.click(screen.getAllByRole("button",{name:"a"})[0]!);
 app.rerender(<ControlGroupView {...props} focusRequest={2}/>);
 expect(selected()).toBe("Problems");expect(screen.getByRole("region",{name:"Task a"})).toBeTruthy();
});
it("problem run navigation opens and focuses the exact existing run controls without sending commands", () => {
 const failed=run({runId:"failed",taskId:"b",state:"blocked",outcome:"failed"});const onCommand=vi.fn();
 render(<ControlGroupView view={view([workItem({taskId:"b",status:"blocked",currentRunId:"failed",lineageRunIds:["failed"]})],[failed])} focus={{kind:"group",groupId:"g",region:"problem",taskId:null,runId:"failed"}} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand}/>);
 fireEvent.click(screen.getByRole("button",{name:"Open run controls and evidence · failed"}));
 expect(selected()).toBe("Runs and evidence");expect(document.activeElement?.getAttribute("data-run-id")).toBe("failed");expect(screen.getByRole("button",{name:"Retry task b"})).toBeTruthy();expect(onCommand).not.toHaveBeenCalled();
});
it("integration alias shows retained Git controls inside Results", () => {
 mount(view([]),{kind:"group",groupId:"g",region:"integration",taskId:null,runId:null});
 expect(selected()).toBe("Results");expect(screen.getByRole("region",{name:"Git"})).toBeTruthy();expect(screen.getByRole("region",{name:"Integration of this group"})).toBeTruthy();
});
it("hidden panels are inaccessible while technical evidence remains navigable", () => {
 mount(view([workItem({taskId:"a"})],[run({runId:"evidence-run",evidenceIds:["raw-evidence"]})]));
 expect(screen.queryByRole("region",{name:"Budget proposal"})).toBeNull();
 for(const panel of document.querySelectorAll('[role="tabpanel"]'))expect((panel as HTMLElement).hidden).toBe(panel.getAttribute("data-overview-region")!=="progress");
 select("Runs and evidence");expect(screen.getByRole("tabpanel").textContent).toContain("raw-evidence");
});

it("Results before completion honestly says not produced and keeps evidence reachable", () => {
 mount(view([]));select("Results");expect(screen.getByRole("status").textContent).toContain("has not been produced");
});
it("a focus belonging to another owner does not override this group's stored default or task", () => {
 mount(view([workItem({taskId:"a"})]),{kind:"group",groupId:"other",region:"results",taskId:"a",runId:null});
 expect(selected()).toBe("Progress");expect(screen.queryByRole("region",{name:"Task a"})).toBeNull();
});
it("all real failure, driver block, unsettled-usage and requested run facts have exact navigation", () => {
 const failed=run({runId:"f",outcome:"failed",state:"settled-recoverable"});const blocked=run({runId:"b",state:"blocked",blockedReason:"driver-block"});const unknown=run({runId:"u",unknownUsageSettlement:{generation:1,highWater:1,remaining:{work:run({}).remaining,handoff:run({}).remaining},allowed:false,refusalReason:"proof-required"}});const requested=run({runId:"r"});const ordinary=run({runId:"o"});
 mount(view([], [failed,blocked,unknown,requested,ordinary]),{kind:"group",groupId:"g",region:"problem",taskId:null,runId:"r"});
 for(const id of ["f","b","u","r"])expect(screen.getByRole("button",{name:"Open run controls and evidence · "+id})).toBeTruthy();
 expect(screen.queryByRole("button",{name:"Open run controls and evidence · o"})).toBeNull();
});
it("ControlPanel forwards an explicit repeated owner request independently of polls", async () => {
 const {ControlPanel}=await import("../src/ControlPanel.js");const value=view([]);const focus={kind:"group",groupId:"g",region:"problem",taskId:null,runId:null} as const;
 const props={focus,view:value,config,summary:{schema:"orca-control-summary-v1" as const,epoch:"epoch-a",changeSeq:4,resetRequired:false,dispatchBlocked:false,groups:[value.summary]},recovery:{schema:"orca-control-recovery-v1" as const,epoch:"epoch-a",dispatchBlocked:false,blockers:[]},groups:{g:value},selected:"g",drafts:{},uncertain:[],refusal:null,refetchRequired:false,onSelect:vi.fn(),onDraft:vi.fn(),onCommand:vi.fn()};
 const app=render(<ControlPanel {...props} focusRequest={1}/>);select("Results");app.rerender(<ControlPanel {...props} focusRequest={2}/>);expect(selected()).toBe("Problems");
});

it("unsaved integration form stays mounted through region changes", () => {
 mount(view([]));select("Results");const region=screen.getByRole("region",{name:"Integration of this group"});
 fireEvent.change(within(region).getByRole("combobox",{name:"Delivery"}),{target:{value:"local"}});
 fireEvent.change(within(region).getByRole("textbox",{name:"Target branch"}),{target:{value:"my unfinished target"}});
 select("Progress");select("Results");expect((within(screen.getByRole("region",{name:"Integration of this group"})).getByRole("textbox",{name:"Target branch"}) as HTMLInputElement).value).toBe("my unfinished target");
});
it("completed Results with missing explanation opens its exact existing evidence run", () => {
 const value=view([],[run({runId:"result-run",state:"settled-recoverable"})]);value.summary.state="done";mount(value);
 expect(screen.getByRole("status").textContent).toContain("explanation is missing");
 fireEvent.click(screen.getByRole("button",{name:"Open run controls and evidence · result-run"}));expect(selected()).toBe("Runs and evidence");expect(document.activeElement?.getAttribute("data-run-id")).toBe("result-run");
 expect(screen.getByRole("button",{name:"evidence"})).toBeTruthy();
});
