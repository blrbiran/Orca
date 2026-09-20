import { openControlStore } from "../../../src/control/store.js";
import { claimWork } from "../../../src/control/budget.js";
const store=await openControlStore({stateDir:process.argv[2]});
try { console.log(JSON.stringify(claimWork(store,JSON.parse(process.argv[3])))); await new Promise<void>(resolve=>{process.stdin.resume();process.stdin.once("end",resolve);}); }
finally { store.close(); }
