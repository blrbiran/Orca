// @vitest-environment jsdom
import {cleanup,render,screen,within,fireEvent,waitFor,act} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {ControlGroupView} from "../src/ControlGroupView.js";
import {config,view,workItem,run} from "./fixtures/board.js";
import {savedRun,savedGroup} from "./fixtures/results.js";
import type {RunResultsV1} from "../src/controlTypes.js";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(value=savedRun(), active=true){
 const calls:string[]=[];vi.stubGlobal("fetch",vi.fn(async(input)=>{calls.push(String(input));return new Response(JSON.stringify(String(input).includes("/groups/")?savedGroup(value):value));}));
 const v=view([workItem({taskId:"a",status:"completed",currentRunId:"run-a",lineageRunIds:["run-a"]})],[run({state:"settled-recoverable",outcome:"succeeded"})]);v.summary.state="done";
 const props={view:v,config,uncertain:[],drafts:{},onDraft:vi.fn(),onCommand:vi.fn(),active};const app=render(<ControlGroupView {...props}/>);return {calls,props,app};
}
it("shows saved explanation with independent actual verification and immutable identity",async()=>{
 mount();expect(screen.getByRole("tab",{selected:true}).textContent).toBe("Results");
 const current=await screen.findByRole("region",{name:"Current result · run-a"});
 expect(current.textContent).toContain("Saved work");expect(current.textContent).toContain("Agent explanation");expect(current.textContent).toContain("Verification: passed");expect(current.textContent).toContain("snapshot 1");expect(current.textContent).toContain("Needs operator review");
});
it("current missing attempt never borrows a previous available explanation",async()=>{
 const value=savedRun({currentAttempt:2,currentExplanation:{status:"missing",reason:null,content:null}});value.attempts[0]!.current=false;mount(value);
 const current=await screen.findByRole("region",{name:"Current result · run-a"});expect(current.textContent).not.toContain("Saved work");expect(current.textContent).toContain("missing");
 fireEvent.click(screen.getByText("Saved attempt history · run-a"));expect(screen.getByRole("region",{name:"Saved attempt 1 · run-a"}).textContent).toContain("Saved work");
});
it("unknown current attempt and unavailable source keep saved history explicitly previous",async()=>{
 mount(savedRun({currentAttempt:null,source:{status:"stale",reason:"capture-stale"},currentExplanation:{status:"unavailable",reason:"capture-stale",content:null}}));
 const current=await screen.findByRole("region",{name:"Current result · run-a"});expect(current.textContent).toContain("unknown");expect(current.textContent).not.toContain("Saved work");expect(screen.getByText(/Source: stale/)).toBeTruthy();
});
it.each(["invalid","missing"] as const)("actual successful task survives %s explanation with original evidence navigation",async(status)=>{
 mount(savedRun({currentExplanation:{status,reason:"report-unreadable",content:null}}));const current=await screen.findByRole("region",{name:"Current result · run-a"});expect(current.textContent).toContain("succeeded");expect(current.textContent).toContain("Verification: passed");
 fireEvent.click(screen.getByRole("button",{name:"Open run controls and evidence · run-a"}));expect(screen.getByRole("tab",{selected:true}).textContent).toBe("Runs and evidence");expect(screen.getByRole("button",{name:"evidence"})).toBeTruthy();
});
it("hidden pane and hidden App section make no result reads",async()=>{
 const {calls,props,app}=mount(savedRun(),false);await act(async()=>{});expect(calls).toHaveLength(0);
 app.rerender(<ControlGroupView {...props} active/>);await screen.findByRole("region",{name:"Current result · run-a"});fireEvent.click(screen.getByRole("tab",{name:"Progress"}));calls.length=0;
 app.rerender(<ControlGroupView {...props} active view={{...props.view,changeSeq:5}}/>);await act(async()=>{});expect(calls.filter(p=>p.includes("/results"))).toHaveLength(0);
});
it("late older epoch or owner responses cannot populate the new current result or steal focus",async()=>{
 let release!:(r:Response)=>void;const held=new Promise<Response>(r=>release=r);const {props,app}=mount();vi.stubGlobal("fetch",vi.fn(()=>held));
 app.rerender(<ControlGroupView {...props} view={{...props.view,epoch:"new-epoch",changeSeq:5}}/>);const tab=screen.getByRole("tab",{name:"Results"});tab.focus();
 await act(async()=>{release(new Response(JSON.stringify(savedGroup())));});expect(screen.queryByText("Saved work")).toBeNull();expect(document.activeElement).toBe(tab);expect(props.onCommand).not.toHaveBeenCalled();
});
