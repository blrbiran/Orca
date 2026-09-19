import { describe,it,expect } from "vitest";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { archiveRun,readArtifact } from "../../src/control/archive.js";
import { verifySnapshot } from "../../src/control/snapshot.js";
import { archiveCase, git } from "./fixtures/archive.js";
describe("dirty snapshots",()=>{
 it("keeps detached HEAD, index and worktree bytes separately, including ignored files and symlinks",async()=>{
  const h=await archiveCase();try{
   const result=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof});
   await rename(h.sourceDir,h.sourceDir+"-retained");
   const snapshot=JSON.parse((await readArtifact(h.store,result.snapshot!)).toString());
   const tracked=snapshot.tree.find((e:{path:string})=>e.path==="tracked");const indexed=snapshot.index.find((e:{path:string})=>e.path==="tracked");
   expect((await readArtifact(h.store,tracked.ref)).toString()).toBe("WORKTREE\n");
   expect((await readArtifact(h.store,indexed.ref)).toString()).toBe("INDEX\n");
   expect(await readArtifact(h.store,snapshot.tree.find((e:{path:string})=>e.path==="binary").ref)).toEqual(Buffer.from([0,255,128,1]));
   expect((await readArtifact(h.store,snapshot.tree.find((e:{path:string})=>e.path==="ignored").ref)).toString()).toBe("kept ignored\n");
   expect(snapshot.tree.find((e:{path:string})=>e.path==="link").target).toBe("/outside/not-followed");
   expect(snapshot.tree.find((e:{path:string})=>e.path==="executable").mode & 0o111).toBe(0o111);
   expect(snapshot.deleted).toContain("deleted");expect(snapshot.head).toMatch(/^[a-f0-9]{40}$/);
   await verifySnapshot(h.store,result.snapshot!);
  }finally{await h.dispose();}
 });
 it("reports special files without opening a FIFO and treats source mutation as partial",async()=>{
  const h=await archiveCase();try{
   execFileSync("mkfifo",[join(h.repoDir,"fifo")]);
   const r=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof});
   expect(r.missing).toContain("special:repo/fifo");
   await expect(verifySnapshot(h.store,r.snapshot!)).rejects.toThrow("snapshot-partial");
   let changed=false;
   const changing=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof},{afterCopy:async path=>{if(path.endsWith("/tracked")&&!changed){changed=true;await writeFile(path,"changed during snapshot");}}});
   expect(changing.missing.some(item=>item.includes("changed:"))).toBe(true);
  }finally{await h.dispose();}
 });
 it("preserves all three unmerged index stages independently of the working file",async()=>{
  const h=await archiveCase();try{
   const oid=git(h.repoDir,"rev-parse","HEAD:tracked").toString().trim();
   execFileSync("git",["-C",h.repoDir,"update-index","--index-info"],{input:`0 0000000000000000000000000000000000000000\ttracked\n100644 ${oid} 1\ttracked\n100644 ${oid} 2\ttracked\n100644 ${oid} 3\ttracked\n`});
   const result=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:h.stopProof});
   const snapshot=JSON.parse((await readArtifact(h.store,result.snapshot!)).toString());
   expect(snapshot.index.filter((e:{path:string})=>e.path==="tracked").map((e:{stage:number})=>e.stage)).toEqual([1,2,3]);
   for(const e of snapshot.index.filter((e:{path:string})=>e.path==="tracked")) expect((await readArtifact(h.store,e.ref)).toString()).toBe("HEAD\n");
   await verifySnapshot(h.store,result.snapshot!);
  }finally{await h.dispose();}
 });

});
