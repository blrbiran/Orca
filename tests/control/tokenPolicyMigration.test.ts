import { expect,it } from "vitest";
import { openTestStore,seedBudgetCase } from "./fixtures/store.js";
import { openControlStore } from "../../src/control/store.js";
it("upgrades schema10 with derived finite policies while preserving historical bodies and command hashes",async()=>{
 const h=await openTestStore();let reopened:Awaited<ReturnType<typeof openControlStore>>|undefined;
 try {
  seedBudgetCase(h.store);
  const before={groups:h.store.db.prepare("SELECT * FROM groups ORDER BY id").all(),work:h.store.db.prepare("SELECT * FROM work_items ORDER BY id").all(),commands:h.store.db.prepare("SELECT * FROM commands ORDER BY id").all()};
  h.store.db.exec("DROP TABLE funded_allowances; DROP TABLE token_policies; UPDATE meta SET value='10' WHERE key='schemaVersion'");h.store.close();
  reopened=await openControlStore({stateDir:h.store.stateDir});
  expect(reopened.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("11");
  expect({groups:reopened.db.prepare("SELECT * FROM groups ORDER BY id").all(),work:reopened.db.prepare("SELECT * FROM work_items ORDER BY id").all(),commands:reopened.db.prepare("SELECT * FROM commands ORDER BY id").all()}).toEqual(before);
  expect(reopened.db.prepare("SELECT work_item_id,mode,tokens FROM token_policies ORDER BY work_item_id").all()).toEqual([{work_item_id:"",mode:"finite-legacy",tokens:100},{work_item_id:"T1",mode:"finite-legacy",tokens:60},{work_item_id:"T2",mode:"finite-legacy",tokens:25}]);
 }finally{reopened?.close();await h.dispose();}
});
