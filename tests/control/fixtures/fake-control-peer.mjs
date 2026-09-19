import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
const [root,method,payload,mode] = process.argv.slice(2);
mkdirSync(root,{recursive:true,mode:0o700});
const input=JSON.parse(payload);const file=join(root,"accepted.json");const counter=join(root,"launches");
const persist=(path,bytes)=>{const fd=openSync(path,"w",0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const dir=openSync(root,"r");try{fsyncSync(dir);}finally{closeSync(dir);}};
let accepted=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
if(method==="capabilities") console.log(JSON.stringify({protocol:1,durableAccept:true,ownershipIsolation:true,evidenceRetention:true,usageObservation:"realtime",budgetEnforcement:"bounded",requestBoundEvidence:"offline-peer-v1"}));
else if(method==="collect") console.log(existsSync(join(root,"report.json"))?readFileSync(join(root,"report.json"),"utf8"):JSON.stringify({events:[],candidate:null,terminal:null}));
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
