import { openControlStore } from "../../../src/control/store.js";
import { writeSync } from "node:fs";
const store = await openControlStore({stateDir:process.argv[2]});
store.db.exec("BEGIN IMMEDIATE");
store.db.prepare("INSERT INTO meta VALUES ('half','uncommitted')").run();
writeSync(1,"IN_TRANSACTION\n");
setInterval(() => {}, 1000);
