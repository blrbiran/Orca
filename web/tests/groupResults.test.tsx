// @vitest-environment jsdom
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import i18n from "../src/i18n.js";
import {GroupResults} from "../src/GroupResults.js";
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
