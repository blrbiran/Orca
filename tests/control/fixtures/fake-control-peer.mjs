import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
const [root,method,payload,mode] = process.argv.slice(2);
mkdirSync(root,{recursive:true,mode:0o700});
const input=JSON.parse(payload);const file=join(root,"accepted.json");const counter=join(root,"launches");
const persist=(path,bytes)=>{const fd=openSync(path,"w",0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const dir=openSync(root,"r");try{fsyncSync(dir);}finally{closeSync(dir);}};
let accepted=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
// Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): this peer's
// response is upgraded from the v1 wire shape to v2. Correction (final fix dispatch, 2026-09-24,
// I3): `requestBoundEvidence` (string|null) is renamed/retyped to `requestBoundProof`
// (descriptor|null) below -- that one is a real mapping. The other three v1 fields
// (durableAccept/ownershipIsolation/evidenceRetention) are NOT renamed to anything -- G1 deleted
// those three gates outright, because ccloop always answered them as an unconditional `true`, so
// they never gated anything. Nothing in v2 replaces them; `handoffControl` and `requestBoundProof`
// are separate guarantees (handoff latching and per-request bound evidence, respectively) that
// are also gated on (handoffControl in every budget mode, requestBoundProof in strict mode), not successors to the deleted booleans.
if(method==="capabilities") console.log(JSON.stringify({protocol:2,usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}}));
else if(method==="collect") console.log(existsSync(join(root,"report.json"))?readFileSync(join(root,"report.json"),"utf8"):JSON.stringify({events:[],candidate:null,terminal:null}));
else if(method==="handoff") console.log(JSON.stringify({kind:"latched",requestId:input.request.requestId}));
else if(method==="inspect") console.log(JSON.stringify(mode==="unknown"?{kind:"unknown"}:accepted?accepted.status:{kind:"absent"}));
else if(method==="accept") {
 if(accepted && JSON.stringify(accepted.input)!==JSON.stringify(input)) throw new Error("peer-envelope-conflict");
 if(!accepted || mode==="non-idempotent") {
  const n=existsSync(counter)?Number(readFileSync(counter,"utf8"))+1:1;
  accepted={input,status:{kind:"accepted",executionId:"execution-"+n,configHash:input.claim.configHash}};
  persist(file,JSON.stringify(accepted));persist(counter,n+"\n");
 }
 if(mode==="drop") process.exit(23);
 console.log(JSON.stringify(accepted.status));
} else throw new Error("invalid-peer-method");
