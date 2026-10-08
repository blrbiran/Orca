// Integration spec §6.4, §6.5, §8: the `github-pr` delivery keeps one pull request per group, through a scripted `gh`
// (fixtures/fakeGh.mjs: an argv log and answers read from a state file). The remote's configured URL is a GitHub one,
// and `url.<bare>.insteadOf` sends every git transport to a local bare repository, so nothing leaves the machine.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setRunChildForTests, spawnRunChild } from "../../src/control/integrationGit.js";
import { integratePendingGroups, type IntegrationCrashPoint, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

const FAKE_GH = join(import.meta.dirname, "fixtures", "fakeGh.mjs");
const GITHUB_URL = "https://github.com/o/r.git";
const REPO = "github.com/o/r";

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

const groupBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeGroupBody = (store: ControlStore, body: Record<string, unknown>) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
const record = (store: ControlStore): GroupIntegration => readGroupIntegration(groupBody(store))!;
const setRecord = (store: ControlStore, integration: GroupIntegration) => writeGroupBody(store, { ...groupBody(store), integration });

const HUB_TASK: IntegrationScheme = { delivery: "github-pr", trigger: "task", target: "main", remote: "origin" };
const HUB_GROUP: IntegrationScheme = { ...HUB_TASK, trigger: "group" };

interface FakePr { number: number; url: string; state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean; head: string; base: string; owner?: string }
interface FakeState { prs?: FakePr[]; authOk?: boolean; refuseDraft?: boolean; fail?: Record<string, string>; hang?: Record<string, number> }
interface GhCall { argv: string[]; stdin?: string }

/** A commit on `ref` whose tree is its parent's with `files` written, made with plumbing (no checkout). */
function commitOn(repo: string, ref: string, files: Record<string, string>, message: string): string {
  const parent = g(repo, ["rev-parse", ref]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const tree = g(repo, ["write-tree"], { env });
  const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit, parent]);
  return commit;
}

/** The fixture's group "g" with a frozen `github-pr` record; its repository's `origin` names GitHub, its transport a local bare. */
async function world(scheme: IntegrationScheme, options: { goal?: string; state?: FakeState } = {}) {
  const h = await webFixture();
  const bare = join(h.root, "remote.git"), repo = join(h.root, "target"), ghDir = join(h.root, "gh");
  g(h.root, ["init", "-q", "--bare", "-b", "main", bare]);
  g(h.root, ["init", "-q", "-b", "main", repo]);
  g(repo, ["commit", "-q", "--allow-empty", "-m", "base"]);
  g(repo, ["remote", "add", "origin", GITHUB_URL]);
  g(repo, ["config", `url.${bare}.insteadOf`, GITHUB_URL]);
  g(repo, ["push", "-q", "origin", "main"]);
  g(repo, ["fetch", "-q", "origin"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "HEAD"]);
  await mkdir(ghDir);
  vi.stubEnv("FAKE_GH_DIR", ghDir);
  const writeState = (state: FakeState) => writeFileSync(join(ghDir, "state.json"), JSON.stringify({ prs: [], authOk: true, refuseDraft: false, fail: {}, ...state }));
  writeState(options.state ?? {});
  // The fixture's goal is "ship"; a criterion that changes it does not read the group's view (which checks the archived plan).
  if (options.goal !== undefined) { const body = groupBody(h.store); writeGroupBody(h.store, { ...body, plan: { ...(body.plan as object), goal: options.goal } }); }
  setRecord(h.store, { ...newGroupIntegration(scheme)!, frozen: true });
  let clock = 1_000_000;
  const deps = (extra: Partial<IntegrationDeps> = {}): IntegrationDeps => ({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => clock, ghBin: FAKE_GH, stopped: () => false, ...extra,
  });
  const calls = (): GhCall[] => {
    const path = join(ghDir, "calls.jsonl");
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as GhCall) : [];
  };
  const fake = (): Required<FakeState> => JSON.parse(readFileSync(join(ghDir, "state.json"), "utf8")) as Required<FakeState>;
  const complete = () => {
    const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as Record<string, unknown>;
    expect(work.kind).toBe("task");
    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, status: "done" }));
  };
  const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
  /** The owner's confirm of the group's current scheme (the proposal becomes confirmed; later scheme changes freeze at once). */
  const confirm = async () => {
    vi.stubEnv("ORCA_GH_BIN", FAKE_GH);
    expect(await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: record(h.store).schemeHash }))).toMatchObject({ result: { kind: "confirmed" } });
  };
  const setScheme = async (scheme: IntegrationScheme) =>
    expect(await service.setGroupIntegration(h.command("set-group-integration", { integration: scheme }))).toMatchObject({ result: { kind: "group-integration-set" } });
  return {
    ...h, bare, repo, deps, calls, fake, writeState, complete, confirm, setScheme,
    land: (files: Record<string, string>, message = "land") => commitOn(repo, "refs/heads/orca/g", files, message),
    pass: (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups(deps(extra)),
    remote: (branch: string): string | null => { try { return g(bare, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); } catch { return null; } },
    record: () => record(h.store),
    clock: () => clock,
  };
}

/** Every git and gh child the pass starts, by argv, still run for real. */
function spyChildren(): string[][] {
  const children: string[][] = [];
  __setRunChildForTests((bin, args, opts) => { children.push([bin, ...args]); return spawnRunChild(bin, args, opts); });
  return children;
}
afterEach(() => { __setRunChildForTests(null); vi.unstubAllEnvs(); });

const sub = (call: GhCall): string => call.argv.slice(0, 2).join(" ");
const subs = (calls: GhCall[]): string[] => calls.map(sub);
/** spec §6.4: every `pr` call names the repository from the remote's URL, so no gh default or other remote redirects it. */
function expectRepoOnEveryPrCall(calls: GhCall[]): void {
  for (const call of calls.filter((each) => each.argv[0] === "pr")) {
    const at = call.argv.indexOf("--repo");
    expect(at, call.argv.join(" ")).toBeGreaterThan(-1);
    expect(call.argv[at + 1]).toBe(REPO);
  }
}

describe("github-pr, trigger task (integration spec §6.4)", { timeout: 60_000 }, () => {
  it("the first integration lists then opens one draft PR; the next one opens none; completion marks it ready once", async () => {
    const w = await world(HUB_TASK); try {
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(first);
      const calls = w.calls();
      expect(subs(calls)).toEqual(["auth status", "pr list", "pr create"]);
      expect(calls[0]!.argv).toEqual(["auth", "status", "--hostname", "github.com"]);
      expect(calls[1]!.argv).toEqual(["pr", "list", "--repo", REPO, "--head", "orca/g", "--base", "main", "--state", "all", "--json", "url,number,state,isDraft,headRepositoryOwner"]);
      expect(calls[2]!.argv).toEqual(["pr", "create", "--repo", REPO, "--base", "main", "--head", "orca/g", "--draft", "--title=ship", "--body-file", "-"]);
      expect(calls[2]!.stdin).toContain("orca/g");
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: first, integratedCommit: first, pending: null,
        pr: { url: `https://${REPO}/pull/1`, number: 1, ready: false } });
      expect(readControlGroup(w.store, "epoch", "g").integration!.pr).toEqual({ url: `https://${REPO}/pull/1`, number: 1, ready: false });

      const second = w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(second);
      expect(subs(w.calls()).filter((each) => each === "pr create")).toHaveLength(1);
      expect(subs(w.calls()).slice(3)).toEqual(["auth status", "pr view"]);
      expect(w.calls()[4]!.argv).toEqual(["pr", "view", "--repo", REPO, "1", "--json", "state,isDraft"]);
      expect(w.record()).toMatchObject({ lastIntegrated: second, pr: { number: 1, ready: false } });
      // Integrated and the group still incomplete: nothing is due.
      expect(await w.pass()).toBe(false);
      expect(w.calls()).toHaveLength(5);

      // spec §5: the group completes with nothing new landed -- the pass only marks the PR ready, pushing nothing.
      w.complete();
      const children = spyChildren();
      expect(await w.pass()).toBe(true);
      expect(children.filter((argv) => argv[0] === "git" && argv.includes("push"))).toEqual([]);
      expect(subs(w.calls()).slice(5)).toEqual(["auth status", "pr view", "pr ready"]);
      expect(w.calls()[7]!.argv).toEqual(["pr", "ready", "--repo", REPO, "1"]);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: second, pr: { number: 1, ready: true } });
      expect(w.fake().prs).toMatchObject([{ number: 1, isDraft: false }]);
      // Ready and integrated: nothing is due, no gh runs.
      expect(await w.pass()).toBe(false);
      expect(w.calls()).toHaveLength(8);
      expectRepoOnEveryPrCall(w.calls());
    } finally { await w.dispose(); }
  });

  it("an open PR gh already lists for orca/g -> main is recorded, and none is created", async () => {
    const existing: FakePr = { number: 7, url: `https://${REPO}/pull/7`, state: "OPEN", isDraft: true, head: "orca/g", base: "main" };
    const w = await world(HUB_TASK, { state: { prs: [existing] } }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls())).toEqual(["auth status", "pr list"]);
      expect(w.record()).toMatchObject({ state: "idle", pr: { url: existing.url, number: 7, ready: false } });
    } finally { await w.dispose(); }
  });

  it("a closed PR from pr list, or a recorded PR later merged, blocks integration-pr-closed and opens nothing", async () => {
    const closed: FakePr = { number: 3, url: `https://${REPO}/pull/3`, state: "CLOSED", isDraft: false, head: "orca/g", base: "main" };
    const w = await world(HUB_TASK, { state: { prs: [closed] } }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-pr-closed", pending: null, pr: null });
      expect(subs(w.calls())).not.toContain("pr create");
    } finally { await w.dispose(); }
    const merged = await world(HUB_TASK); try {
      merged.land({ "a.txt": "a\n" });
      expect(await merged.pass()).toBe(true);
      merged.writeState({ prs: merged.fake().prs.map((pr) => ({ ...pr, state: "MERGED" })) });
      merged.land({ "b.txt": "b\n" });
      expect(await merged.pass()).toBe(true);
      expect(merged.record()).toMatchObject({ state: "blocked", reason: "integration-pr-closed", pr: { number: 1 } });
      expect(subs(merged.calls()).filter((each) => each === "pr create")).toHaveLength(1);
    } finally { await merged.dispose(); }
  });

  it("a plan without draft PRs blocks integration-pr-refused with gh's words", async () => {
    const w = await world(HUB_TASK, { state: { refuseDraft: true } }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", pr: null, pending: null });
      expect(w.record().reason).toMatch(/^integration-pr-refused:.*Draft pull requests are not supported/);
    } finally { await w.dispose(); }
  });

  it("a recorded draft PR the person already marked ready is recorded ready without a second pr ready", async () => {
    const w = await world(HUB_TASK); try {
      w.land({ "a.txt": "a\n" });
      await w.pass();
      w.writeState({ prs: w.fake().prs.map((pr) => ({ ...pr, isDraft: false })) });
      w.complete();
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls())).not.toContain("pr ready");
      expect(w.record().pr).toMatchObject({ number: 1, ready: true });
    } finally { await w.dispose(); }
  });

  it("a crash after pr create or after pr ready is finished by the next pass without a second create or ready", async () => {
    const w = await world(HUB_TASK); try {
      const tip = w.land({ "a.txt": "a\n" });
      const crashAt = (point: IntegrationCrashPoint) => (at: IntegrationCrashPoint) => { if (at === point) throw new Error(`crash ${at}`); };
      await expect(w.pass({ crash: crashAt("after-pr-create") })).rejects.toThrow("crash after-pr-create");
      expect(w.record()).toMatchObject({ pr: null, lastIntegrated: null, pending: { tip } });
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls()).filter((each) => each === "pr create")).toHaveLength(1);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, pending: null, pr: { number: 1, ready: false } });
      w.complete();
      await expect(w.pass({ crash: crashAt("after-pr-ready") })).rejects.toThrow("crash after-pr-ready");
      expect(w.record().pr).toMatchObject({ ready: false });
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls()).filter((each) => each === "pr ready")).toHaveLength(1);
      expect(w.record().pr).toMatchObject({ number: 1, ready: true });
    } finally { await w.dispose(); }
  });
});

describe("github-pr, trigger group (ruling R8)", { timeout: 60_000 }, () => {
  it("opens the PR ready, never as a draft, once the group is complete", async () => {
    const w = await world(HUB_GROUP); try {
      const tip = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(false);
      expect(w.calls()).toEqual([]);
      w.complete();
      expect(await w.pass()).toBe(true);
      const create = w.calls().find((call) => sub(call) === "pr create")!;
      expect(create.argv).not.toContain("--draft");
      expect(subs(w.calls())).not.toContain("pr ready");
      expect(w.record()).toMatchObject({ lastIntegrated: tip, pr: { number: 1, ready: true } });
      expect(w.fake().prs).toMatchObject([{ isDraft: false }]);
    } finally { await w.dispose(); }
  });
});

describe("the PR's title and body (integration spec §8)", { timeout: 60_000 }, () => {
  it("a goal starting with -- is one --title= element of its first line only; the body goes on stdin", async () => {
    const w = await world(HUB_TASK, { goal: "--evil\nsecond line" }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const create = w.calls().find((call) => sub(call) === "pr create")!;
      expect(create.argv.filter((arg) => arg.startsWith("--title"))).toEqual(["--title=--evil"]);
      expect(create.argv).not.toContain("--evil");
      expect(create.argv.join("\n")).not.toContain("second line");
      expect(create.argv.slice(-2)).toEqual(["--body-file", "-"]);
      expect(create.stdin).toMatch(/\S/);
    } finally { await w.dispose(); }
  });

  it("a first line longer than 256 characters is truncated to 256", async () => {
    const w = await world(HUB_TASK, { goal: `${"x".repeat(300)}\nmore` }); try {
      w.land({ "a.txt": "a\n" });
      await w.pass();
      const create = w.calls().find((call) => sub(call) === "pr create")!;
      expect(create.argv.filter((arg) => arg.startsWith("--title"))).toEqual([`--title=${"x".repeat(256)}`]);
    } finally { await w.dispose(); }
  });
});

describe("gh failures (integration spec §6.5)", { timeout: 60_000 }, () => {
  it("gh not logged in, or not there at all, blocks integration-gh-unavailable after the work branch is pushed", async () => {
    const w = await world(HUB_TASK, { state: { authOk: false } }); try {
      const tip = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-gh-unavailable", pending: null, pr: null });
      expect(subs(w.calls())).toEqual(["auth status"]);
    } finally { await w.dispose(); }
    const missing = await world(HUB_TASK); try {
      missing.land({ "a.txt": "a\n" });
      expect(await missing.pass({ ghBin: join(missing.root, "no-such-gh") })).toBe(true);
      expect(missing.record()).toMatchObject({ state: "blocked", reason: "integration-gh-unavailable" });
    } finally { await missing.dispose(); }
  });

  it("a gh network error backs off (stays idle) -- in auth status and in a pr call alike", async () => {
    for (const failing of ["auth status", "pr list"]) {
      const w = await world(HUB_TASK, { state: { fail: { [failing]: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com" } } }); try {
        w.land({ "a.txt": "a\n" });
        expect(await w.pass()).toBe(false);
        expect(w.record(), failing).toMatchObject({ state: "idle", reason: null, transient: 1, retryAfter: w.clock() + 30_000, pr: null, lastIntegrated: null });
      } finally { await w.dispose(); }
    }
  });

  it("any other gh failure -- of pr list, create, view or ready -- blocks integration-pr-refused with gh's words", async () => {
    const words = "HTTP 404: Not Found (https://api.github.com/graphql)";
    for (const failing of ["pr list", "pr create", "pr view", "pr ready"]) {
      const w = await world(HUB_TASK); try {
        w.land({ "a.txt": "a\n" });
        // pr view and pr ready need a recorded PR first.
        if (failing === "pr view" || failing === "pr ready") { expect(await w.pass()).toBe(true); w.land({ "b.txt": "b\n" }); w.complete(); }
        w.writeState({ ...w.fake(), fail: { [failing]: words } });
        expect(await w.pass()).toBe(true);
        expect(w.record(), failing).toMatchObject({ state: "blocked", reason: `integration-pr-refused:${words}` });
        expect(subs(w.calls()).at(-1), failing).toBe(failing);
      } finally { await w.dispose(); }
    }
  });

  it("a remote whose URL no longer names GitHub refuses the PR by name and runs no gh", async () => {
    const w = await world(HUB_TASK); try {
      g(w.repo, ["config", "remote.origin.url", w.bare]);
      const tip = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
      expect(w.record()).toMatchObject({ state: "blocked" });
      expect(w.record().reason).toMatch(/^integration-pr-refused:.*GitHub/);
      expect(w.calls()).toEqual([]);
    } finally { await w.dispose(); }
  });
});

describe("confirm's preflight (integration spec §3.3)", { timeout: 60_000 }, () => {
  it("names gh-auth when gh is not logged in for the remote's host, and passes once it is", async () => {
    const h = await webFixture(undefined, undefined, { integration: HUB_TASK }); try {
      const bare = join(h.root, "remote.git"), repo = join(h.root, "target"), ghDir = join(h.root, "gh");
      g(h.root, ["init", "-q", "--bare", "-b", "main", bare]);
      g(h.root, ["init", "-q", "-b", "main", repo]);
      g(repo, ["commit", "-q", "--allow-empty", "-m", "base"]);
      g(repo, ["remote", "add", "origin", GITHUB_URL]);
      g(repo, ["config", `url.${bare}.insteadOf`, GITHUB_URL]);
      g(repo, ["push", "-q", "origin", "main"]);
      await mkdir(ghDir);
      vi.stubEnv("FAKE_GH_DIR", ghDir);
      vi.stubEnv("ORCA_GH_BIN", FAKE_GH);
      writeFileSync(join(ghDir, "state.json"), JSON.stringify({ authOk: false }));
      const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
      const seen = readControlGroup(h.store, "epoch", "g").integration!.schemeHash;
      expect(await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: seen })))
        .toMatchObject({ error: { code: "integration-preflight-failed", message: "integration-preflight-failed:gh-auth" } });
      expect(readFileSync(join(ghDir, "calls.jsonl"), "utf8")).toBe(`${JSON.stringify({ argv: ["auth", "status", "--hostname", "github.com"] })}\n`);
      writeFileSync(join(ghDir, "state.json"), JSON.stringify({ authOk: true }));
      expect(await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: seen }))).toMatchObject({ result: { kind: "confirmed" } });
    } finally { await h.dispose(); }
  });
});

describe("fix round 1: PR records across scheme changes, gh timeouts, forks, blank titles", { timeout: 60_000 }, () => {
  it("R1: a group integrated under push-branch and switched to github-pr opens its PR at the next pass, with nothing new landed", async () => {
    const w = await world({ ...HUB_TASK, delivery: "push-branch" }); try {
      await w.confirm();
      const tip = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ lastIntegrated: tip, pr: null });
      await w.setScheme(HUB_TASK);
      expect(w.record()).toMatchObject({ frozen: true, lastIntegrated: tip, pr: null });
      const before = w.calls().length;
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls().slice(before))).toEqual(["auth status", "pr list", "pr create"]);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, pr: { number: 1, ready: false } });
      expect(await w.pass()).toBe(false);
    } finally { await w.dispose(); }
  });

  it("R2: a target change forgets the recorded PR (the next pass lists for the new base); a trigger change keeps it", async () => {
    const w = await world(HUB_TASK); try {
      await w.confirm();
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const pr = w.record().pr!;
      expect(pr).toMatchObject({ number: 1 });
      await w.setScheme({ ...HUB_TASK, trigger: "group" });
      expect(w.record().pr).toEqual(pr);
      await w.setScheme({ ...HUB_TASK, target: "dev" });
      expect(w.record().pr).toBeNull();
      const before = w.calls().length;
      expect(await w.pass()).toBe(true);
      const after = w.calls().slice(before);
      expect(subs(after)).toEqual(["auth status", "pr list", "pr create"]);
      expect(after[1]!.argv).toContain("dev");
      expect(w.record().pr).toMatchObject({ number: 2 });
    } finally { await w.dispose(); }
  });

  it("M1: a gh timeout on one group does not skip another group on the same remote in that round", async () => {
    vi.stubEnv("ORCA_INTEGRATION_TIMEOUT_MS", "3000");
    // The remote is named like the host, so gh's own argv (auth status --hostname github.com) names it too.
    const scheme: IntegrationScheme = { ...HUB_TASK, remote: "github.com" };
    const w = await world(scheme, { state: { hang: { "auth status": 20_000 } } }); try {
      g(w.repo, ["remote", "add", "github.com", GITHUB_URL]);
      const body = groupBody(w.store);
      w.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('h',?,?,?)")
        .run(Number(body.revision ?? 1), Number(body.graphVersion ?? 1), JSON.stringify({ ...body, groupId: "h" }));
      g(w.repo, ["update-ref", "refs/heads/orca/h", "HEAD"]);
      w.land({ "a.txt": "a\n" });
      const hTip = commitOn(w.repo, "refs/heads/orca/h", { "h.txt": "h\n" }, "land h");
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ state: "idle", transient: 1 });
      // h was tried in the same round: its branch was pushed and its own gh timed out too.
      expect(w.remote("orca/h")).toBe(hTip);
      const h = readGroupIntegration(JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='h'").get()!.body)))!;
      expect(h).toMatchObject({ state: "idle", transient: 1 });
    } finally { await w.dispose(); }
  });

  it("M2: an open PR from a fork's same-named branch is not the group's; the group's own PR is created", async () => {
    const fork: FakePr = { number: 1, url: `https://${REPO}/pull/1`, state: "OPEN", isDraft: false, head: "orca/g", base: "main", owner: "someone-else" };
    const w = await world(HUB_TASK, { state: { prs: [fork] } }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(subs(w.calls())).toEqual(["auth status", "pr list", "pr create"]);
      expect(w.record()).toMatchObject({ state: "idle", pr: { number: 2, ready: false } });
    } finally { await w.dispose(); }
  });

  it("M3: a goal whose first line is blank titles the PR orca/<g>", async () => {
    const w = await world(HUB_TASK, { goal: "   \nthe real goal" }); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const create = w.calls().find((call) => sub(call) === "pr create")!;
      expect(create.argv.filter((arg) => arg.startsWith("--title"))).toEqual(["--title=orca/g"]);
    } finally { await w.dispose(); }
  });
});
