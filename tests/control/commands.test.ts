import { describe, it, expect } from "vitest";
import { createGroup, putWork, setGroupStopped, setGroupLimit } from "../../src/control/commands.js";
import { getGroup, readVersions } from "../../src/control/queries.js";
import { fixtureAgent, openTestStore } from "./fixtures/store.js";
import type { GroupInput, WorkInput } from "../../src/control/types.js";
export const group:GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship checked change",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};
const meta = {commandId:"create",expectedRevision:0,by:"human"};
const work:WorkInput = {workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["a"]}},configHash:"config1",agent:fixtureAgent,grant:{work:{tokens:60,activeMs:100,attempts:1,sessions:1},handoff:{tokens:10,activeMs:10,attempts:0,sessions:0}}};
describe("control commands", () => {
  it("replays the original result before checking stale revisions, but rejects changed payload and author", async () => {
    const h = await openTestStore(); try {
      const first = createGroup(h.store,group,meta);
      expect(first.revision).toBe(1); expect(first.reserved.tokens).toBe(10);
      expect(readVersions(h.store,"g1")).toEqual({commandRevision:1,projectionSeq:1});
      setGroupStopped(h.store,"g1",true,{...meta,commandId:"stop",expectedRevision:1});
      expect(createGroup(h.store,{...group,limit:{sessions:10,attempts:10,activeMs:10000,tokens:100}},meta)).toEqual(first);
      expect(() => createGroup(h.store,{...group,goal:"Different"},meta)).toThrow("command-id-conflict");
      expect(() => createGroup(h.store,group,{...meta,by:"other"})).toThrow("command-id-conflict");
      expect(() => setGroupStopped(h.store,"g1",false,{...meta,commandId:"stale"})).toThrow("revision-conflict");
      expect(getGroup(h.store,"g1").stopped).toBe(true);
      expect(readVersions(h.store,"g1")).toEqual({commandRevision:2,projectionSeq:2});
    } finally { await h.dispose(); }
  });
  it("does not borrow another project's reserve or alter used amounts when limits increase", async () => {
    const h=await openTestStore();try {
      createGroup(h.store,group,meta);createGroup(h.store,{...group,groupId:"g2",projectKey:"different/repo"},meta);
      setGroupLimit(h.store,"g1",{...group.limit,tokens:200},{...meta,commandId:"raise",expectedRevision:1});
      expect(getGroup(h.store,"g1").used.tokens).toBe(0);expect(getGroup(h.store,"g2").limit.tokens).toBe(100);
      expect(() => setGroupLimit(h.store,"g1",{...group.limit,tokens:9},{...meta,commandId:"lower",expectedRevision:2})).toThrow("group-budget-unavailable");
      expect(getGroup(h.store,"g1").limit.tokens).toBe(200);
    }finally{await h.dispose();}
  });
  it.each([-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN])("rejects unsafe budget %s without creating state",async tokens=>{
    const h=await openTestStore();try{
      expect(()=>createGroup(h.store,{...group,limit:{...group.limit,tokens}},meta)).toThrow();
      expect(h.store.db.prepare("SELECT id FROM groups").all()).toHaveLength(0);
    }finally{await h.dispose();}
  });
  it("requires a goal and success condition, and refuses reserve larger than grant",async()=>{
    const h=await openTestStore();try{
      expect(()=>createGroup(h.store,{...group,goal:" "},meta)).toThrow();
      expect(()=>createGroup(h.store,{...group,successConditions:[]},meta)).toThrow();
      expect(()=>createGroup(h.store,{...group,reviewReserve:{...group.reviewReserve,tokens:101}},meta)).toThrow("group-budget-unavailable");
      expect(h.store.db.prepare("SELECT id FROM groups").all()).toHaveLength(0);
    }finally{await h.dispose();}
  });
  it("rejects dangling dependencies, duplicate task IDs and cycles while preserving approved graph",async()=>{
    const h=await openTestStore();try{
      createGroup(h.store,group,meta);
      const m={...meta,commandId:"work1",expectedRevision:1};
      putWork(h.store,"g1",work,m);
      expect(()=>putWork(h.store,"g1",{...work,workItemId:"T2",taskId:"T2",dependsOn:["missing"]},{...m,commandId:"dangling",expectedRevision:2})).toThrow("graph-dangling-dependency");
      expect(()=>putWork(h.store,"g1",{...work,workItemId:"T2"},{...m,commandId:"duplicate",expectedRevision:2})).toThrow("duplicate-task-id");
      putWork(h.store,"g1",{...work,workItemId:"T2",taskId:"T2",dependsOn:["T1"]},{...m,commandId:"work2",expectedRevision:2});
      expect(()=>putWork(h.store,"g1",{...work,dependsOn:["T2"]},{...m,commandId:"cycle",expectedRevision:3})).toThrow("graph-cycle");
      expect(getGroup(h.store,"g1").revision).toBe(3);
    }finally{await h.dispose();}
  });
  it("latches stop and retains a proposal instead of replacing an active contract",async()=>{
    const h=await openTestStore();try{
      createGroup(h.store,group,meta);putWork(h.store,"g1",work,{...meta,commandId:"work",expectedRevision:1});
      h.store.db.prepare("INSERT INTO runs VALUES ('r1','g1','T1',1,1,'{}')").run();
      const m={...meta,commandId:"change",expectedRevision:2};
      expect(()=>putWork(h.store,"g1",{...work,configHash:"new"},m)).toThrow("graph-change-needs-handoff");
      expect(()=>putWork(h.store,"g1",{...work,configHash:"new"},m)).toThrow("graph-change-needs-handoff");
      expect(getGroup(h.store,"g1").stopped).toBe(true);
      const stored=JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE id='T1'").get()?.body));
      expect(stored.configHash).toBe("config1");
      const body=JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g1'").get()?.body));
      expect(body.proposal.work.configHash).toBe("new");
      expect(()=>setGroupStopped(h.store,"g1",false,{...meta,commandId:"unstop",expectedRevision:3})).toThrow("graph-change-needs-handoff");
    }finally{await h.dispose();}
  });
});
