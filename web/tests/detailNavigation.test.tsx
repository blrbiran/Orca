// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
afterEach(()=>{cleanup();window.localStorage.clear();window.sessionStorage.clear();vi.restoreAllMocks();window.location.hash="";});
it.each(["progress", "start"] as const)("Overview %s opens its distinct owner region without commands", async(kind)=>{
 window.location.hash="";const panel=installFakePanel();const group=groupSummary("g",ALPHA,{state:"ready"});panel.summary.groups=[group];panel.groupViews.g=planGroupView(group);
 const base=globalThis.fetch;globalThis.fetch=(async(input,init)=>String(input)==="/api/control/overview"?new Response(JSON.stringify({schema:"orca-control-overview-v1",epoch:"epoch-a",changeSeq:1,groups:[group],steps:[{key:"start",groupId:"g",repoId:ALPHA,taskId:null,runId:null,kind:"start-review",reason:"start-review",ownerRequired:false,destination:{kind:"group",groupId:"g",region:"dispatch",taskId:null,runId:null}}],issues:[]})):base(input,init)) as typeof fetch;
 render(<App/>);const overview=screen.getByRole("region",{name:"Overview"});
 const region=within(overview).getByRole("region",{name:kind==="progress"?"Progress":"Needs your attention"});
 fireEvent.click(await within(region).findByRole("button"));await screen.findByRole("region",{name:"Control group g"});
 await waitFor(()=>expect(screen.getByRole("tab",{selected:true}).textContent).toBe(kind==="progress"?"Progress":"Preparation"));
 expect(panel.requests).toContain("GET /api/control/groups/g");expect(panel.posts).toHaveLength(0);
 expect(document.activeElement?.getAttribute("data-overview-region")).toBe(kind==="progress"?"progress":"dispatch");
});
