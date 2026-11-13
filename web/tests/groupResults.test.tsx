// @vitest-environment jsdom
import {cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import i18n from "../src/i18n.js";
import {GroupResults} from "../src/GroupResults.js";
import {TaskResults} from "../src/TaskResults.js";
import {ControlGroupView} from "../src/ControlGroupView.js";
import {config,view,workItem} from "./fixtures/board.js";
import {savedGroup,savedRun} from "./fixtures/results.js";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("group coverage, unfinished tasks, goal review and delivery are independent",async()=>{
 const data=savedGroup();data.coverage={total:2,available:1,partial:0,missing:0,unavailable:0,notProduced:1};data.tasks.push({taskId:"unfinished",status:"ready",currentRunId:null,pendingRunId:null,lineageRunIds:[],availability:"not-produced",runs:[]});
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(data))));const v=view([]);v.summary.state="done";render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);
 expect((await screen.findByRole("region",{name:"Group results"})).textContent).toContain("2 tasks");expect(screen.getByText(/unfinished.*ready/)).toBeTruthy();expect(screen.getByText("Goal review has not run.")).toBeTruthy();expect(screen.getByText("Git delivery is unavailable.")).toBeTruthy();
});
it.each(["failed","not-run","in-progress","unavailable"] as const)("actual %s verification keeps Agent claims attributed",async(verification)=>{
 const data=savedRun();data.attempts[0]!.verification=verification;data.attempts[0]!.execution="partial";
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(savedGroup(data)))));const v=view([]);v.summary.state="done";render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);
 const region=await screen.findByRole("region",{name:"Current result · run-a"});expect(region.textContent).toContain("Execution: partial");expect(region.textContent).toContain("Verification: "+verification);expect(region.textContent).toContain("Agent claims success");
});
it("tabs use roving keyboard navigation and preserve panel ownership",()=>{
 render(<ControlGroupView view={view([])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);const first=screen.getByRole("tab",{name:"Progress"});first.focus();fireEvent.keyDown(first,{key:"End"});expect(document.activeElement?.textContent).toBe("Technical details");expect(screen.getByRole("tab",{selected:true}).textContent).toBe("Technical details");fireEvent.keyDown(document.activeElement!,{key:"Home"});expect(document.activeElement).toBe(first);fireEvent.keyDown(first,{key:"ArrowLeft"});expect(document.activeElement?.textContent).toBe("Technical details");
});

it("Chinese saved results translate actual outcome and Git delivery state",async()=>{
 await i18n.changeLanguage("zh");const data=savedGroup();data.delivery={scheme:{delivery:"local",trigger:"group",method:"merge",target:"main"},schemeHash:"s",frozen:true,state:"conflict",reason:null,lastIntegrated:null,integratedCommit:null,pr:null};vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(data))));render(<GroupResults view={view([])} active scope="locale-owner"/>);const region=await screen.findByRole("region",{name:"当前结果 · run-a"});expect(region.textContent).toContain("成功");expect(screen.getByText(/交付：有冲突/)).toBeTruthy();await i18n.changeLanguage("en");
});

// Tester #117: the result views show the status the graph and table show (shownWorkStatus), not the raw stored one.
it("group and task results show a running task whose run is blocked as blocked",async()=>{
 const data=savedGroup();data.tasks[0]={...data.tasks[0]!,status:"active",category:"blocked"};
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(data))));
 render(<GroupResults view={view([])} active scope="shown-status"/>);
 // mutation: GroupResults reads task.status -> "task acceptance: active", red
 expect(await screen.findByText(/a · task acceptance: blocked/)).toBeTruthy();
 cleanup();
 const item=workItem({status:"active",category:"blocked"});
 render(<TaskResults view={view([item])} item={item} active scope="shown-status-task"/>);
 // mutation: TaskResults reads item.status -> "task acceptance: active", red
 expect(screen.getByText(/a · task acceptance: blocked/)).toBeTruthy();
});

// Review 2026-11-09: the collapsed badge must agree with the graph's displayed status.
it("counts a running task with a blocked category in the collapsed task badge",()=>{
  // Ruling (2026-11-13, tester follow-up J): 「#303 => 批，这一轮允许改写必要判据」 -- #303/#304: the list's one name is its disclosure, "Work items (n)" (was a "Work items" heading plus a "Tasks (n)" button), and the label filter is named "Filter by label (n)" (was "Labels (n)").
 const data=view([workItem({status:"active",category:"blocked"})]);
 render(<ControlGroupView view={data} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);
 expect(screen.getByRole("button",{name:"Work items (1)"}).getAttribute("aria-expanded")).toBe("false");
 expect(screen.getByText("1 blocked")).toBeTruthy();
});

it("counts only filtered blocked tasks beside Tasks and offers a way to reveal hidden blocked tasks",()=>{
  // Ruling (2026-11-13, tester follow-up J): 「#303 => 批，这一轮允许改写必要判据」 -- #303/#304: the list's one name is its disclosure, "Work items (n)" (was a "Work items" heading plus a "Tasks (n)" button), and the label filter is named "Filter by label (n)" (was "Labels (n)").
 const data=view([
  workItem({taskId:"blocked",status:"blocked",labels:["urgent"]}),
  workItem({taskId:"visible",status:"active",labels:["normal"]}),
 ]);
 render(<ControlGroupView view={data} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:"normal"}));
 expect(screen.getByRole("button",{name:"Work items (1)"})).toBeTruthy();
 expect(screen.queryByText("1 blocked")).toBeNull();
 expect(screen.getByTestId("hidden-blocked-count").textContent).toContain("1 blocked");
 expect(screen.getByTestId("hidden-blocked-count").textContent).toContain("Filter by label (1)");
 fireEvent.click(within(screen.getByTestId("hidden-blocked-count")).getByRole("button",{name:"Clear labels"}));
 expect(screen.getByRole("button",{name:"Work items (2)"})).toBeTruthy();
 expect(screen.getByText("1 blocked")).toBeTruthy();
});
