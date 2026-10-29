// @vitest-environment jsdom
/** Task2 review I1/I2/I3: explicit fresh decision owner reads, accepted-owner focus and recoverable navigation errors. */
import {cleanup,render,screen,within,fireEvent,waitFor,act} from "@testing-library/react";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {App} from "../src/App.js";
import {installFakePanel,decisionRow} from "./fixtures/twoProjects.js";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import {rowKey} from "../src/DecisionList.js";
import { pickOption } from "./selectControl.js";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
beforeEach(()=>{window.location.hash="";});
afterEach(()=>{cleanup();window.localStorage.clear();window.sessionStorage.clear();vi.restoreAllMocks();});
function setup(){const panel=installFakePanel(); panel.todo=[decisionRow("alpha","a"),decisionRow("alpha","b")];for(const row of panel.todo)panel.decisions[rowKey(row)]={id:row.id,question:"question-"+row.id,chose:"c",because:"b",alternatives:[]};const base=globalThis.fetch;globalThis.fetch=(async(input,init)=>String(input)==="/api/control/overview"?json({schema:"orca-control-overview-v1",epoch:"epoch-a",changeSeq:4,groups:[],steps:[],issues:[]}):base(input,init)) as typeof fetch;return panel;}
async function open(id:string){const page=screen.getByRole("region",{name:"Overview"});fireEvent.click(await within(page).findByRole("button",{name:"Review decision · "+id}));await waitFor(()=>expect(screen.getByTestId("decision-question").textContent).toBe("question-"+id));}
it("reopened decision always does a live owner GET while overview todo refresh is pending",async()=>{const panel=setup();render(<App/>);await open("a");const count=()=>panel.requests.filter(r=>r.includes("/api/decision?")).length;const reads=count();const base=globalThis.fetch;globalThis.fetch=(async(input,init)=>String(input)==="/api/todo"?new Promise<Response>(()=>{}):base(input,init)) as typeof fetch;fireEvent.click(screen.getByRole("link",{name:"Overview"}));await waitFor(()=>expect(document.querySelector('[data-section="overview"]')?.getAttribute("data-active")).toBe("true"));await open("a");expect(count()).toBe(reads+1);expect(panel.posts).toHaveLength(0);});
it("switching overview decision retains requested focus after the new detail arrives",async()=>{const panel=setup();render(<App/>);await open("a");fireEvent.click(screen.getByRole("link",{name:"Overview"}));await waitFor(()=>expect(document.querySelector('[data-section="overview"]')?.getAttribute("data-active")).toBe("true"));const base=globalThis.fetch;let release!:(x:Response)=>void;const held=new Promise<Response>(r=>release=r);globalThis.fetch=(async(input,init)=>String(input).includes("decisionId=b")?held:base(input,init)) as typeof fetch;fireEvent.click(await within(screen.getByRole("region",{name:"Overview"})).findByRole("button",{name:"Review decision · b"}));await act(async()=>{release(json({decision:panel.decisions[rowKey(panel.todo[1]!)]}));});await waitFor(()=>expect(screen.getByTestId("decision-question").textContent).toBe("question-b"));expect(document.activeElement?.getAttribute("data-overview-region")).toBe("decision");expect(panel.posts).toHaveLength(0);});
it("removed decision owner leaves overview available with navigation failure",async()=>{const panel=setup();render(<App/>);await within(screen.getByRole("region",{name:"Overview"})).findByRole("button",{name:"Review decision · a"});const base=globalThis.fetch;globalThis.fetch=(async(input,init)=>String(input).includes("decisionId=a")?json({code:"decision-not-found",message:"not found"},404):base(input,init)) as typeof fetch;fireEvent.click(within(screen.getByRole("region",{name:"Overview"})).getByRole("button",{name:"Review decision · a"}));await waitFor(()=>expect(screen.queryByRole("region",{name:"Overview"})).not.toBeNull());await waitFor(()=>expect(screen.queryByRole("link",{name:"Overview"})).not.toBeNull());await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("no longer available"));});

it("a late refused Overview decision read cannot replace the shell after a newer section navigation", async () => {
 const panel = setup(); render(<App />); await within(screen.getByRole("region", { name: "Overview" })).findByRole("button", { name: "Review decision · b" });
 const base = globalThis.fetch; let release!: (value: Response) => void; const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input).includes("decisionId=b") ? held : base(input, init)) as typeof fetch;
 fireEvent.click(within(screen.getByRole("region", { name: "Overview" })).getByRole("button", { name: "Review decision · b" }));
 fireEvent.click(screen.getByRole("link", { name: "Metrics" }));
 await waitFor(() => expect(document.querySelector('[data-section="metrics"]')?.getAttribute("data-active")).toBe("true"));
 await act(async () => { release(json({ code: "decision-not-found", message: "late refused owner" }, 404)); });
 expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
 expect(document.querySelector('[data-section="metrics"]')?.getAttribute("data-active")).toBe("true");
 expect(screen.queryByText(/late refused owner/)).toBeNull();
 expect(panel.posts).toHaveLength(0);
});
it("a late refused Overview decision read cannot replace a newer accepted decision owner", async () => {
 const panel = setup(); render(<App />); await within(screen.getByRole("region", { name: "Overview" })).findByRole("button", { name: "Review decision · a" });
 const base = globalThis.fetch; let release!: (value: Response) => void; const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input).includes("decisionId=a") ? held : base(input, init)) as typeof fetch;
 fireEvent.click(within(screen.getByRole("region", { name: "Overview" })).getByRole("button", { name: "Review decision · a" }));
 await open("b"); await act(async () => { release(json({ code: "decision-not-found", message: "late refused previous owner" }, 404)); });
 expect(screen.getByTestId("decision-question").textContent).toBe("question-b");
 expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy(); expect(panel.posts).toHaveLength(0);
});

it("an older successful Overview decision read cannot reopen after a newer section navigation", async () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): a scope switch made through the sidebar picker drops the old decision owner reply
 const panel = setup(); render(<App />); await within(screen.getByRole("region", { name: "Overview" })).findByRole("button", { name: "Review decision · a" });
 const base = globalThis.fetch; let release!: (value: Response) => void; const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input).includes("decisionId=a") ? held : base(input, init)) as typeof fetch;
 fireEvent.click(within(screen.getByRole("region", { name: "Overview" })).getByRole("button", { name: "Review decision · a" }));
 fireEvent.click(screen.getByRole("link", { name: "Metrics" }));
 await waitFor(() => expect(document.querySelector('[data-section="metrics"]')?.getAttribute("data-active")).toBe("true"));
 await act(async () => { release(json({ decision: panel.decisions[rowKey(panel.todo[0]!)] })); });
 expect(document.querySelector('[data-section="metrics"]')?.getAttribute("data-active")).toBe("true");
 expect(screen.queryByTestId("decision-question")).toBeNull(); expect(panel.posts).toHaveLength(0);
});
it.each(["auth", "scope", "epoch"] as const)("an Overview decision owner response is ignored after %s changes", async (context) => {
 const panel = setup(); const me = (id: string): Me => ({ user: { id, name: id, roles: ["owner"], mustChangePassword: false }, expiresAt: 100000, sessionDays: 1 });
 const app = render(<AccountContext.Provider value={me("one")}><App /></AccountContext.Provider>);
 await within(screen.getByRole("region", { name: "Overview" })).findByRole("button", { name: "Review decision · a" });
 const base = globalThis.fetch; let release!: (value: Response) => void; const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input).includes("decisionId=a") ? held : base(input, init)) as typeof fetch;
 fireEvent.click(within(screen.getByRole("region", { name: "Overview" })).getByRole("button", { name: "Review decision · a" }));
 if (context === "auth") app.rerender(<AccountContext.Provider value={me("two")}><App /></AccountContext.Provider>);
 if (context === "scope") await pickOption(screen.getByRole("combobox", { name: "Project" }), "Beta");
 if (context === "epoch") { panel.summary.epoch = "epoch-b"; panel.recovery.epoch = "epoch-b"; await screen.findByText("epoch epoch-b", {}, { timeout: 3000 }); }
 await act(async () => { release(json({ decision: panel.decisions[rowKey(panel.todo[0]!)] })); });
 expect(document.querySelector('[data-section="overview"]')?.getAttribute("data-active")).toBe("true");
 expect(screen.queryByTestId("decision-question")).toBeNull(); expect(panel.posts).toHaveLength(0);
});
it("ordinary Decisions selection remains independently readable after an accepted Overview decision", async () => {
 const panel = setup(); render(<App />); await open("a");
 const ownerReads = panel.requests.filter((r) => r.includes("/api/decision?")).length;
 const b = [...document.querySelectorAll<HTMLButtonElement>(".decision-list button")].find((row) => row.textContent?.includes("b"))!;
 fireEvent.click(b);
 await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe("question-b"));
 expect(panel.requests.filter((r) => r.includes("/api/decision?"))).toHaveLength(ownerReads + 1); expect(panel.posts).toHaveLength(0);
});
