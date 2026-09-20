import { spawn } from "node:child_process";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { openControlStore } from "../../../src/control/store.js";
import { roundPeer } from "./roundPeer.js";
import { getGroup } from "../../../src/control/queries.js";
import { git } from "./archive.js";
export async function crashCase(point:string,worker="crash-worker.mjs") {
 const root=await mkdtemp(join(tmpdir(),"orca-crash-matrix-"));
 const canonical=await (await import("node:fs/promises")).realpath(root);
 const child=spawn(process.execPath,["--import","tsx",resolve("tests/control/fixtures",worker),canonical,point],{stdio:["ignore","pipe","pipe"]});
 let output="",resolveMarker:()=>void=()=>{},rejectMarker:(error:Error)=>void=()=>{};
 const marker=new Promise<void>((resolve,reject)=>{resolveMarker=resolve;rejectMarker=reject;});
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once("exit",(code,signal)=>{resolve({code,signal});rejectMarker(new Error(`worker exited before marker: ${code}/${signal}\n${output}`));}));
 child.stdout.on("data",bytes=>{output+=bytes.toString();if(output.includes("MARKER "+point+"\n"))resolveMarker();});child.stderr.on("data",bytes=>{output+=bytes.toString();});
 const timer=setTimeout(()=>rejectMarker(new Error("marker timeout\n"+output)),20000);
 try{await marker;}catch(error){child.kill("SIGKILL");await done;await rm(root,{recursive:true,force:true});throw error;}finally{clearTimeout(timer);}
 if(await readFile(join(root,"marker"),"utf8")!==point)throw new Error("wrong marker");
 child.kill("SIGKILL");const exit=await done;if(exit.signal!=="SIGKILL")throw new Error("worker was not killed");
 process.stdout.write(`crash ${point}: marker observed, ${exit.signal}\n`);
 const info=JSON.parse(await readFile(join(root,"run.json"),"utf8"));
 const store=await openControlStore({stateDir:join(root,"state"),recovery:true});
 return {root:canonical,store,info,async recover(){
   const {recoverControl}=await import("../../../src/control/recovery.js");
   const result=await recoverControl(store,roundPeer(join(canonical,"peer")));
   let launches=0;try{launches=Number(await readFile(join(root,"peer",info.runId,"launches"),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   const referencedHashes=store.db.prepare("SELECT id,hash FROM artifacts ORDER BY id").all();
   return {...result,used:getGroup(store,"g1").used,launches,landingCount:Number(git(info.target,"rev-list","--merges","--count","orca/w").toString()),referencedHashes};
  },async dispose(){store.close();await rm(root,{recursive:true,force:true});}};
}
