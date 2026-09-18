import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { startChainBody } from "../src/api.js";
import { BANNER_TEXT, DISMISSED_KEY, bannersFor, readDismissed, writeDismissed } from "../src/chainBanner.js";
import { ChainPanel } from "../src/ChainPanel.js";
import type { ChainOutcome } from "../src/ChainPanel.js";
import type { ChainRepoView, ChainStopCategory, ChainView } from "../src/types.js";

const chain = (over: Partial<ChainView> = {}): ChainView => ({
  chainId: "chain-0000000a", goal: "distinct goal text", by: "distinct-by", via: "panel", startedAt: "2026-09-18T00:00:00.000Z",
  state: "running", holderGone: false, sessionsDone: 1, costUsd: 1.25, stop: null, ...over,
});
const stopped = (category: ChainStopCategory, reason = "distinct-reason", awaitingHuman: string[] = []): ChainView =>
  chain({ state: "stopped", stop: { reason, category, at: "2026-09-18T01:00:00.000Z", awaitingHuman, detail: null } });
const repo = (c: ChainView | null, over: Partial<ChainRepoView> = {}): ChainRepoView => ({ repoKey: "distinct-repo", defaultSessionTimeoutMin: 360, chain: c, problem: null, ...over });
const html = (repos: ChainRepoView[], outcome?: ChainOutcome) =>
  renderToStaticMarkup(<ChainPanel repos={repos} banners={bannersFor(repos, new Set())} outcome={outcome ?? null} />);

describe("ChainPanel (D-launch spec §6.2)", () => {
  it("V1 a running chain: goal, by, the session in progress, the cost, and a stop button that says when it takes effect", () => {
    const h = html([repo(chain())]);
    for (const text of ["distinct goal text", "distinct-by", "session 2; USD 1.25", 'data-action="stop-chain"', "Stops after the current session ends."]) expect(h).toContain(text);
  });
  it("V2 a running record whose supervisor is gone says so, with no stop button", () => {
    const h = html([repo(chain({ holderGone: true }))]);
    expect(h).toContain("running (supervisor is gone)");
    expect(h).not.toContain('data-action="stop-chain"');
  });
  it("V3 a stopped chain shows its reason and category; an unreadable cost says so", () => {
    const h = html([repo({ ...stopped("anomaly"), costUsd: null })]);
    expect(h).toContain("stopped: distinct-reason (anomaly)");
    expect(h).toContain("cost unreadable");
    expect(h).not.toContain('data-action="stop-chain"');
  });
  it("V4 one banner per stopped chain not yet dismissed, worded by category", () => {
    expect(BANNER_TEXT).toEqual({ done: "Chain finished", blocked: "Chain is waiting for you", limit: "Chain stopped at a limit", anomaly: "Chain stopped on an anomaly" });
    for (const category of ["done", "blocked", "limit", "anomaly"] as const) {
      expect(bannersFor([repo(stopped(category))], new Set())).toEqual([
        { repoKey: "distinct-repo", chainId: "chain-0000000a", category, text: BANNER_TEXT[category], reason: "distinct-reason", awaitingHuman: [] },
      ]);
    }
    expect(bannersFor([repo(stopped("done"))], new Set(["chain-0000000a"]))).toEqual([]);
    expect(bannersFor([repo(chain())], new Set())).toEqual([]);
    const h = html([repo(stopped("blocked", "blocked", ["[irreversible] push main"]))]);
    for (const text of ["Chain is waiting for you", "distinct-repo: blocked", "[irreversible] push main", 'data-action="dismiss"']) expect(h).toContain(text);
  });
  it("V5 dismissals live in the browser's storage only; a storage that throws remembers nothing and breaks nothing", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeDismissed(storage, new Set(["chain-0000000a"]));
    expect(store.get(DISMISSED_KEY)).toBe('["chain-0000000a"]');
    expect(readDismissed(storage)).toEqual(new Set(["chain-0000000a"]));
    const broken = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); } };
    expect(readDismissed(broken)).toEqual(new Set());
    expect(() => writeDismissed(broken, new Set(["x"]))).not.toThrow();
    expect(readDismissed(undefined)).toEqual(new Set());
  });
  it("V6 the form preselects the first repository and prefills its configured timeout", () => {
    const h = html([repo(null), repo(null, { repoKey: "other-repo", defaultSessionTimeoutMin: 90 })]);
    expect(h).toMatch(/name="sessionTimeoutMin"[^>]*value="360"/);
    expect(h).toContain("No chain yet.");
  });
  it("V7 a refused start shows the server's code and message", () => {
    const h = html([repo(null)], { kind: "refused", refusal: { status: 409, code: "worktree-dirty", message: "distinct refusal" } });
    expect(h).toContain("worktree-dirty");
    expect(h).toContain("distinct refusal");
  });
  it("V8 startChainBody sends numbers and leaves a blank timeout out, so .orca/chain.json decides", () => {
    expect(startChainBody({ repoKey: "r", goal: "g", maxSessions: "3", maxCostUsd: "2.5", sessionTimeoutMin: " " })).toStrictEqual({ repoKey: "r", goal: "g", maxSessions: 3, maxCostUsd: 2.5 });
    expect(startChainBody({ repoKey: "r", goal: "g", maxSessions: "3", maxCostUsd: "2.5", sessionTimeoutMin: "90" }).sessionTimeoutMin).toBe(90);
  });
});
