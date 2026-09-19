import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
export function fakePeer(root:string,mode=""):ExecutionPort {
 const request=async(method:string,payload:unknown)=>JSON.parse((await promisify(execFile)(process.execPath,[resolve("tests/control/fixtures/fake-control-peer.mjs"),root,method,JSON.stringify(payload),mode])).stdout);
 return {capabilities:()=>request("capabilities",{}),accept:input=>request("accept",input),inspect:input=>request("inspect",input),collect:(input,afterSeq)=>request("collect",{input,afterSeq})};
}
