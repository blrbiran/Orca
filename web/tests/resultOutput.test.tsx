// @vitest-environment jsdom
import {cleanup,render,screen,fireEvent,act,within} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {ResultOutput} from "../src/ResultOutput.js";
import {noteAnswer} from "../src/api.js";
import {ControlGroupView} from "../src/ControlGroupView.js";
import {config,view} from "./fixtures/board.js";
import {savedGroup} from "./fixtures/results.js";
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(status="available",content:string|null="# Saved\n\n<script>alert(1)</script>\n\n[click](https://evil.test) ![img](https://evil.test/x)\n\n```html\n<b>code</b>\n```",downloadUrl:string|null="/api/control/runs/run-a/results/outputs/owned-output?download=1"){
 const requests:string[]=[];vi.stubGlobal("fetch",vi.fn(async(input)=>{const path=String(input);requests.push(path);return new Response(JSON.stringify(path.includes("/outputs/")?{schema:"orca-result-output-v1",runId:"run-a",groupId:"g",attempt:1,outputId:"owned-output",path:"a.html",status,byteLength:25,content,downloadUrl}:savedGroup()));}));const v=view([]);v.summary.state="done";const props={view:v,config,uncertain:[],drafts:{},onDraft:vi.fn(),onCommand:vi.fn()};const app=render(<ControlGroupView {...props}/>);return {requests,props,app};
}
it("saved HTML/script/link/image preview is inert and never fetches external resources",async()=>{
 const {requests}=mount();fireEvent.click(await within(await screen.findByRole("region",{name:"Current result · run-a"})).findByRole("button",{name:"Preview saved output · Saved HTML"}));const preview=await screen.findByRole("region",{name:"Saved output · a.html"});expect(preview.textContent).toContain("<script>alert(1)</script>");expect(preview.textContent).toContain("[click](https://evil.test)");expect(preview.querySelectorAll("script,img,a")).toHaveLength(0);expect(preview.querySelector("h1")?.textContent).toBe("Saved");expect(preview.querySelector("pre")?.textContent).toBe("<b>code</b>");expect(requests.some(p=>p.startsWith("https:"))).toBe(false);
});
it.each(["binary","too-large","deleted","changed","symlink","unsafe","missing","unavailable"])("%s output is explicit with no fabricated text or download",async status=>{
 mount(status,null,null);fireEvent.click(await within(await screen.findByRole("region",{name:"Current result · run-a"})).findByRole("button",{name:"Preview saved output · Saved HTML"}));expect((await screen.findByRole("region",{name:"Saved output · a.html"})).textContent).toContain(status);expect(screen.queryByRole("button",{name:"Download saved output · a.html"})).toBeNull();
});
it("preview rejects a response owned by a different attempt",async()=>{
 const {requests}=mount();await within(await screen.findByRole("region",{name:"Current result · run-a"})).findByRole("button",{name:"Preview saved output · Saved HTML"});vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({schema:"orca-result-output-v1",runId:"run-a",groupId:"g",attempt:2,outputId:"owned-output",path:"a.html",status:"available",content:"Foreign bytes",byteLength:13,downloadUrl:null}))));fireEvent.click(within(screen.getByRole("region",{name:"Current result · run-a"})).getByRole("button",{name:"Preview saved output · Saved HTML"}));await screen.findByText(/result-response-stale/);expect(screen.queryByText("Foreign bytes")).toBeNull();
});
it("a pending preview is discarded when Results is hidden",async()=>{
 const {props,app}=mount();await within(await screen.findByRole("region",{name:"Current result · run-a"})).findByRole("button",{name:"Preview saved output · Saved HTML"});let release!:(r:Response)=>void;vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>release=r)));fireEvent.click(within(screen.getByRole("region",{name:"Current result · run-a"})).getByRole("button",{name:"Preview saved output · Saved HTML"}));fireEvent.click(screen.getByRole("tab",{name:"Progress"}));await act(async()=>release(new Response(JSON.stringify({schema:"orca-result-output-v1",runId:"run-a",groupId:"g",attempt:1,outputId:"owned-output",path:"a.html",status:"available",content:"Late bytes",byteLength:10,downloadUrl:null}))));fireEvent.click(screen.getByRole("tab",{name:"Results"}));expect(screen.queryByText("Late bytes")).toBeNull();
});

// Held download bytes prove that auth revocation retires the browser-side capability synchronously.
function outputOwner(status="available", path="saved.bin") {
 const runId="run /中文",outputId="output /#";const url="/api/control/runs/run%20%2F%E4%B8%AD%E6%96%87/results/outputs/output%20%2F%23?download=1";
 const props={runId,groupId:"g",attempt:1,active:true,identity:"owner-one",output:{outputId,path,label:"Saved bytes",origin:"reported" as const,status:"available" as const,byteLength:4}};
 const answer={schema:"orca-result-output-v1",runId,groupId:"g",attempt:1,outputId,path,status,byteLength:4,content:null,downloadUrl:url};return {props,answer,url};
}
it.each(["binary","too-large"])("%s preview retains an authorized download with exact saved bytes and encoded owner",async status=>{
 const {props,answer,url}=outputOwner(status);const bytes=new Uint8Array([0,255,13,10]);let downloaded:Blob|null=null;let attachment="";const calls:string[]=[];
 vi.stubGlobal("fetch",vi.fn(async(input)=>{calls.push(String(input));return String(input).endsWith("?download=1")?new Response(bytes):new Response(JSON.stringify(answer));}));
 Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn((blob:Blob)=>{downloaded=blob;return "blob:saved";})});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){attachment=this.download;});
 render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));fireEvent.click(await screen.findByRole("button",{name:"Download saved output · saved.bin"}));await act(async()=>{});
 expect(calls).toEqual([url.replace("?download=1",""),url]);expect(attachment).toBe("output /#");expect(Array.from(new Uint8Array(await downloaded!.arrayBuffer()))).toEqual([0,255,13,10]);
});
it("auth revoke aborts a held download blob and prevents a late attachment before parent rerender",async()=>{
 const {props,answer}=outputOwner();let release!:(blob:Blob)=>void;let signal:AbortSignal|null|undefined;const held=new Promise<Blob>(r=>release=r);const create=vi.fn();Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});
 vi.stubGlobal("fetch",vi.fn(async(input,init)=>{if(String(input).endsWith("?download=1")){signal=init?.signal;return {ok:true,blob:()=>held} as Response;}return new Response(JSON.stringify(answer));}));
 render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));fireEvent.click(await screen.findByRole("button",{name:"Download saved output · saved.bin"}));await act(async()=>{});act(()=>noteAnswer(401,{error:{code:"login-required"}}));expect(signal?.aborted).toBe(true);await act(async()=>{release(new Blob(["late bytes"]));});expect(create).not.toHaveBeenCalled();expect(screen.queryByRole("region",{name:"Saved output · saved.bin"})).toBeNull();
});
it("preview refusal removes formerly admitted saved content",async()=>{
 const {props,answer}=outputOwner();let refuse=false;vi.stubGlobal("fetch",vi.fn(async()=>refuse?new Response(JSON.stringify({error:{code:"result-output-unavailable"}}),{status:409}):new Response(JSON.stringify({...answer,content:"previous bytes"}))));render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));await screen.findByText("previous bytes");refuse=true;fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));await screen.findByRole("alert");expect(screen.queryByText("previous bytes")).toBeNull();expect(screen.queryByRole("button",{name:"Download saved output · saved.bin"})).toBeNull();
});
it("foreign download URL never creates a download capability",async()=>{
 const {props,answer}=outputOwner();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...answer,downloadUrl:"https://foreign.test/bytes"}))));render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));await screen.findByRole("alert");expect(screen.queryByRole("button",{name:"Download saved output · saved.bin"})).toBeNull();
});
it.each(["hide","scope","remove"])("held saved download cannot complete after owner %s",async kind=>{
 const {props,answer}=outputOwner();let release!:(blob:Blob)=>void;let signal:AbortSignal|null|undefined;const held=new Promise<Blob>(r=>release=r);const create=vi.fn();Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});vi.stubGlobal("fetch",vi.fn(async(input,init)=>String(input).endsWith("?download=1")?(signal=init?.signal,{ok:true,blob:()=>held} as Response):new Response(JSON.stringify(answer))));const app=render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));fireEvent.click(await screen.findByRole("button",{name:"Download saved output · saved.bin"}));await act(async()=>{});if(kind==="remove")app.unmount();else app.rerender(<ResultOutput {...props} active={kind!=="hide"} identity={kind==="scope"?"owner-two":props.identity}/>);expect(signal?.aborted).toBe(true);await act(async()=>{release(new Blob(["obsolete"]));});expect(create).not.toHaveBeenCalled();
});

it.each([403,401])("saved download refusal %i never attaches bytes or bypasses session permission",async status=>{
 const {props,answer}=outputOwner();const create=vi.fn();Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});const code=status===401?"login-required":"permission-denied";vi.stubGlobal("fetch",vi.fn(async(input)=>String(input).endsWith("?download=1")?new Response(JSON.stringify({error:{code}}),{status}):new Response(JSON.stringify(answer))));render(<ResultOutput {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Preview saved output · Saved bytes"}));fireEvent.click(await screen.findByRole("button",{name:"Download saved output · saved.bin"}));await act(async()=>{});expect(create).not.toHaveBeenCalled();if(status===401)expect(screen.queryByRole("region",{name:"Saved output · saved.bin"})).toBeNull();else expect(screen.getByRole("alert").textContent).toContain("permission-denied");
});
