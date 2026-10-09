import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionGate } from "../../src/control/admissionGate.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { documentPathOf } from "../../src/control/requirementDocument.js";
import { exportPendingRequirements, exportRequirementDocument } from "../../src/control/requirementExport.js";
import { readDraft, readRequirementGroup } from "../../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { requirementSummaryOf } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// N1 spec §9.2-§9.3: git plumbing only, create-only ref, idempotent, a conflicting branch blocks and is never moved;
// start waits for the export, confirm does not.
async function accepted() {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
  const document = readRequirementGroup(x.store, "r").requirement.document!;
  return { x, text: JSON.parse(readCanonicalRecord(x.store, document.recordHash)).text as string, sha: document.sha256 };
}
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
const exportDeps = (x: Harness) => ({ store: x.store, resolveRepository: () => x.repo });
const resetExport = (x: Harness) => {
  const group = readRequirementGroup(x.store, "r");
  group.requirement.export = { state: "pending", path: null, commit: null, parent: null, detail: null };
  x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
};
/** Every entry of the working tree outside .git, directories included: path, mode, size and mtime. */
function tree(root: string, at = ""): string[] {
  const here = join(root, at), stat = lstatSync(here);
  const line = `${at || "."} ${stat.mode.toString(8)} ${stat.size} ${stat.mtimeMs}`;
  if (!stat.isDirectory()) return [line];
  return [line, ...readdirSync(here).filter((name) => at !== "" || name !== ".git").sort().flatMap((name) => tree(root, at === "" ? name : join(at, name)))];
}
// Preflight m11: `--no-optional-locks` so the status read cannot refresh (rewrite) the index it is compared with.
const human = (x: Harness) => ({ status: x.git("--no-optional-locks", "status", "--porcelain"), head: x.git("rev-parse", "HEAD"),
  index: createHash("sha256").update(readFileSync(join(x.repo, ".git", "index"))).digest("hex"), tree: tree(x.repo) });

/**
 * A `git` first on PATH that runs the real one, and plays a concurrent creator of the branch at `update-ref`
 * (ORCA_T11_UPDATE_REF: "race" creates the ref with the same arguments first, "fail" refuses without creating it).
 */
async function withGitShim<T>(dir: string, env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "git"), `#!/bin/sh
is_update_ref=no
for a in "$@"; do [ "$a" = update-ref ] && is_update_ref=yes; done
if [ "$is_update_ref" = yes ] && [ "$ORCA_T11_UPDATE_REF" = race ]; then "${real}" "$@"; fi
if [ "$is_update_ref" = yes ] && [ "$ORCA_T11_UPDATE_REF" = fail ]; then exit 1; fi
exec "${real}" "$@"
`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, env, { PATH: `${dir}:${process.env.PATH ?? ""}` });
  try { return await body(); } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}

/**
 * The tree git's own index builds from the exported commit's parent plus the exported blob at its path -- what the
 * export built through a temporary index before the controller's ruling. The mktree path must give the same tree id.
 */
function indexTree(x: Harness): { built: string; expected: string } {
  const tip = x.git("rev-parse", "refs/heads/orca/r"), path = readRequirementGroup(x.store, "r").requirement.export.path!;
  const env = { ...process.env, GIT_INDEX_FILE: join(x.root, "expected-index") };
  const g = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: x.repo, env, encoding: "utf8" }).trim();
  g("read-tree", `${tip}^^{tree}`);
  g("update-index", "--add", "--cacheinfo", `100644,${x.git("rev-parse", `${tip}:${path}`)},${path}`);
  return { built: x.git("rev-parse", `${tip}^{tree}`), expected: g("write-tree") };
}
const commitIn = async (x: Harness, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) { await mkdir(join(x.repo, path, ".."), { recursive: true }); await writeFile(join(x.repo, path), content); }
  x.git("add", "-A"); x.git("commit", "-qm", "earlier .orca content");
};
/** Every entry under `root` with its full st_mode, keyed by its path relative to `root`. */
function modes(root: string, at = "", into = new Map<string, number>()): Map<string, number> {
  const stat = lstatSync(join(root, at));
  if (at !== "") into.set(at, stat.mode);
  if (stat.isDirectory()) for (const name of readdirSync(join(root, at))) modes(root, at === "" ? name : join(at, name), into);
  return into;
}

describe("exporting the requirement document (N1 spec §9.2)", () => {
  it("commits the frozen document as the first commit of orca/<groupId>, leaving the working tree and index alone", async () => {
    const { x, text, sha } = await accepted();
    try {
      await writeFile(join(x.repo, "README.md"), "# edited, not committed\n");
      await writeFile(join(x.repo, "staged.txt"), "s"); x.git("add", "staged.txt");
      const before = human(x), head = x.head();
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      expect(human(x)).toEqual(before);
      const tip = x.git("rev-parse", "refs/heads/orca/r");
      expect(x.git("rev-parse", `${tip}^`)).toBe(head);
      expect(x.git("show", `${tip}:.orca/requirements/${readRequirementGroup(x.store, "r").requirement.createdOn}-markdown-export.md`)).toBe(text.trimEnd());
      expect(x.git("log", "-1", "--format=%an <%ae>|%cn <%ce>|%s", tip)).toBe("Orca <orca@localhost>|Orca <orca@localhost>|docs(requirements): markdown-export");
      expect(x.git("log", "-1", "--format=%(trailers:key=Orca-Document-Sha256,valueonly)", tip)).toBe(sha);
      expect(readRequirementGroup(x.store, "r").requirement.export).toMatchObject({ state: "done", commit: tip, parent: head });
      // No .orca in HEAD: both levels are created, and the tree is the one git's index builds.
      const trees = indexTree(x);
      expect(trees.built).toBe(trees.expected);
    } finally { await x.dispose(); }
  });

  it("is idempotent: a re-run after a lost record finds its own commit and records done without moving the ref", async () => {
    const { x } = await accepted();
    try {
      await exportRequirementDocument(exportDeps(x), "r");
      const tip = x.git("rev-parse", "refs/heads/orca/r");
      resetExport(x);
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      expect(x.git("rev-parse", "refs/heads/orca/r")).toBe(tip);
      expect(readRequirementGroup(x.store, "r").requirement.export).toMatchObject({ state: "done", commit: tip });
    } finally { await x.dispose(); }
  });

  it("blocks requirement-export-conflict on an orca/<groupId> it did not make, and never moves it", async () => {
    const { x } = await accepted();
    try {
      x.git("branch", "orca/r");
      const tip = x.git("rev-parse", "refs/heads/orca/r");
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("conflict");
      expect(x.git("rev-parse", "refs/heads/orca/r")).toBe(tip);
      expect(readRequirementGroup(x.store, "r").requirement.export).toMatchObject({ state: "conflict", detail: expect.stringContaining("requirement-export-conflict") });
      expect(requirementSummaryOf(x.store, "r")).toMatchObject({ exportState: "conflict", reasonCode: "requirement-export-conflict" });
    } finally { await x.dispose(); }
  });

  it("suffixes the file name when HEAD already has one by that name", async () => {
    const { x } = await accepted();
    try {
      const createdOn = readRequirementGroup(x.store, "r").requirement.createdOn;
      await mkdir(join(x.repo, ".orca", "requirements"), { recursive: true });
      await writeFile(join(x.repo, ".orca", "requirements", `${createdOn}-markdown-export.md`), "earlier\n");
      x.git("add", ".orca"); x.git("commit", "-qm", "an earlier requirement");
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      expect(readRequirementGroup(x.store, "r").requirement.export.path).toBe(`.orca/requirements/${createdOn}-markdown-export-2.md`);
      const trees = indexTree(x);
      expect(trees.built).toBe(trees.expected);
    } finally { await x.dispose(); }
  });
});

describe("the tree the export builds, level by level (controller ruling on the Task 11 review)", () => {
  it("keeps every other entry of a .orca that has no requirements directory", async () => {
    const { x } = await accepted();
    try {
      await commitIn(x, { ".orca/notes.txt": "notes\n", ".orca/deep/x.txt": "x\n" });
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      const trees = indexTree(x);
      expect(trees.built).toBe(trees.expected);
      expect(x.git("show", "refs/heads/orca/r:.orca/deep/x.txt")).toBe("x");
    } finally { await x.dispose(); }
  });

  it("keeps the other documents of an existing requirements directory, and needs no suffix for a new name", async () => {
    const { x } = await accepted();
    try {
      await commitIn(x, { ".orca/requirements/2020-01-01-other.md": "other\n", ".orca/notes.txt": "notes\n" });
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      expect(readRequirementGroup(x.store, "r").requirement.export.path).toBe(`.orca/requirements/${readRequirementGroup(x.store, "r").requirement.createdOn}-markdown-export.md`);
      const trees = indexTree(x);
      expect(trees.built).toBe(trees.expected);
      expect(x.git("show", "refs/heads/orca/r:.orca/requirements/2020-01-01-other.md")).toBe("other");
    } finally { await x.dispose(); }
  });

  it("keeps an entry whose name is not valid UTF-8 byte for byte, at the root and beside the document", async () => {
    const { x } = await accepted();
    try {
      // Bytes 0xff 0xfe in the names, which no JS string can carry: written through the shell's printf. The fixture
      // repository has no hooks, so the commit needs no override.
      execFileSync("/bin/sh", ["-c", [
        "B=$(printf 'odd\\n' | git hash-object -w --stdin)",
        "git update-index --add --cacheinfo \"100644,$B,$(printf 'bad\\377\\376.txt')\"",
        "git update-index --add --cacheinfo \"100644,$B,$(printf '.orca/requirements/bad\\377\\376.md')\"",
        "git -c user.name=t -c user.email=t@t commit -qm odd",
      ].join(" && ")], { cwd: x.repo });
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      const trees = indexTree(x);
      expect(trees.built).toBe(trees.expected);
      const names = (tree: string) => execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", tree], { cwd: x.repo });
      for (const name of [Buffer.from([0x62, 0x61, 0x64, 0xff, 0xfe, 0x2e, 0x74, 0x78, 0x74]), Buffer.concat([Buffer.from(".orca/requirements/bad"), Buffer.from([0xff, 0xfe]), Buffer.from(".md")])]) {
        expect(names("refs/heads/orca/r").includes(Buffer.concat([name, Buffer.from([0])]))).toBe(true);
      }
    } finally { await x.dispose(); }
  });
});

describe("a .orca level in HEAD that is not a directory (controller ruling, fix round 2)", () => {
  for (const [path, reason] of [[".orca", ".orca in HEAD is not a directory"], [".orca/requirements", ".orca/requirements in HEAD is not a directory"]] as const) {
    it(`blocks requirement-export-path-blocked on a ${path} file, delivers its wake once, never replaces it and names the reason in the summary`, async () => {
      const { x } = await accepted();
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await commitIn(x, { [path]: "a file\n" });
        expect(await exportPendingRequirements(exportDeps(x))).toBe(true);
        expect(await exportPendingRequirements(exportDeps(x))).toBe(false);
        expect(stderr.mock.calls.filter(([line]) => String(line).includes("requirement export"))).toEqual([]);
        expect(readRequirementGroup(x.store, "r").requirement.export).toEqual({ state: "conflict", path: null, commit: null, parent: null, detail: `requirement-export-path-blocked:${reason}` });
        expect(x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get()).toEqual({ delivered: 1 });
        expect(requirementSummaryOf(x.store, "r")).toMatchObject({ exportState: "conflict", reasonCode: "requirement-export-path-blocked" });
        expect(() => x.git("rev-parse", "--verify", "-q", "refs/heads/orca/r")).toThrow();
      } finally { stderr.mockRestore(); await x.dispose(); }
    });
  }

  it("exports after the person fixes HEAD and asks recovery-retry", async () => {
    const { x, text } = await accepted();
    try {
      await commitIn(x, { ".orca": "a file\n" });
      await exportPendingRequirements(exportDeps(x));
      x.git("rm", "-q", ".orca"); x.git("commit", "-qm", "the person moves .orca away");
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { resolved: true, wakeIds: ["scheduler-wake:r:requirement-export"] } });
      expect(await exportPendingRequirements(exportDeps(x))).toBe(true);
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("done");
      expect(x.git("show", `refs/heads/orca/r:${readRequirementGroup(x.store, "r").requirement.export.path}`)).toBe(text.trimEnd());
    } finally { await x.dispose(); }
  });
});

describe("the export runs nothing the target configures (N1 spec §15 item 10)", () => {
  it("fires no filter, no hook and no signing program of the target, and the commit carries no signature", async () => {
    const { x, text } = await accepted();
    try {
      const marker = (name: string) => join(x.root, `${name}-ran`);
      await writeFile(join(x.repo, ".git", "info", "attributes"), "* filter=marker\n");
      x.git("config", "filter.marker.clean", `touch '${marker("clean")}'; cat`);
      x.git("config", "filter.marker.smudge", `touch '${marker("smudge")}'; cat`);
      for (const hook of ["reference-transaction", "pre-commit", "post-commit", "commit-msg"]) {
        await writeFile(join(x.repo, ".git", "hooks", hook), `#!/bin/sh\ntouch '${marker(hook)}'\n`); chmodSync(join(x.repo, ".git", "hooks", hook), 0o755);
      }
      await writeFile(join(x.root, "gpg"), `#!/bin/sh\ntouch '${marker("gpg")}'\nexit 1\n`); chmodSync(join(x.root, "gpg"), 0o755);
      x.git("config", "commit.gpgSign", "true"); x.git("config", "gpg.program", join(x.root, "gpg"));
      const outcome = await exportRequirementDocument(exportDeps(x), "r").catch((error: unknown) => error);
      expect(["clean", "smudge", "reference-transaction", "pre-commit", "post-commit", "commit-msg", "gpg"].filter((name) => existsSync(marker(name)))).toEqual([]);
      expect(outcome).toBe("done");
      const tip = x.git("rev-parse", "refs/heads/orca/r");
      expect(x.git("cat-file", "commit", tip)).not.toContain("gpgsig");
      expect(x.git("show", `${tip}:${readRequirementGroup(x.store, "r").requirement.export.path}`)).toBe(text.trimEnd());
    } finally { await x.dispose(); }
  });

  it("bounds every git child: past the time cap the export fails, creates no branch and stays pending", async () => {
    const { x } = await accepted();
    try {
      await expect(exportRequirementDocument({ ...exportDeps(x), gitTimeoutMs: 1 }, "r")).rejects.toMatchObject({ killed: true, signal: "SIGKILL" });
      expect(() => x.git("rev-parse", "--verify", "-q", "refs/heads/orca/r")).toThrow();
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("pending");
    } finally { await x.dispose(); }
  });
});

describe("what the export writes (Rule 17; controller ruling on the Task 11 review)", () => {
  it("writes its objects into the target with the modes git gives them under the target's umask, and nothing outside the repository", async () => {
    const { x } = await accepted();
    const umask = process.umask(0o022);
    try {
      const objects = join(x.repo, ".git", "objects");
      const outside = () => [...modes(x.root).keys()].filter((path) => path !== "repo" && !path.startsWith("repo/")).sort();
      const before = modes(objects), outsideBefore = outside();
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("done");
      const created = [...modes(objects)].filter(([path]) => !before.has(path));
      expect(created.filter(([, mode]) => (mode & 0o170000) === 0o100000).length).toBeGreaterThanOrEqual(4);
      expect(created.filter(([, mode]) => mode !== ((mode & 0o170000) === 0o040000 ? 0o040755 : 0o100444)).map(([path, mode]) => `${path} ${mode.toString(8)}`)).toEqual([]);
      expect(outside()).toEqual(outsideBefore);
    } finally { process.umask(umask); await x.dispose(); }
  });
});

describe("a branch created while the export ran (N1 spec §9.2, create-only)", () => {
  it("finds its own commit when a concurrent creator made the same one, and records done", async () => {
    const { x } = await accepted();
    try {
      const outcome = await withGitShim(join(x.root, "shim"), { ORCA_T11_UPDATE_REF: "race" }, () => exportRequirementDocument(exportDeps(x), "r"));
      expect(outcome).toBe("done");
      expect(readRequirementGroup(x.store, "r").requirement.export).toMatchObject({ state: "done", commit: x.git("rev-parse", "refs/heads/orca/r") });
    } finally { await x.dispose(); }
  });

  it("throws, and stays pending, when update-ref fails with no branch there", async () => {
    const { x } = await accepted();
    try {
      const outcome = await withGitShim(join(x.root, "shim"), { ORCA_T11_UPDATE_REF: "fail" },
        () => Promise.race([exportRequirementDocument(exportDeps(x), "r").catch(() => "threw"), new Promise((resolve) => setTimeout(() => resolve("still running"), 3_000))]));
      expect(outcome).toBe("threw");
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("pending");
    } finally { await x.dispose(); }
  });
});

describe("the export commit's identity (DR21)", () => {
  it("dates the commit at the freeze, so the same frozen document exported into a clone gives the same commit id", async () => {
    const { x } = await accepted();
    try {
      const clone = join(x.root, "clone");
      x.git("clone", "-q", "--local", x.repo, clone);
      await exportRequirementDocument(exportDeps(x), "r");
      const first = x.git("rev-parse", "refs/heads/orca/r");
      resetExport(x);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await exportRequirementDocument({ store: x.store, resolveRepository: () => clone }, "r");
      expect(readRequirementGroup(x.store, "r").requirement.export.commit).toBe(first);
    } finally { await x.dispose(); }
  });
});

describe("the driver's export pass (DR14)", () => {
  it("exports on the driver's round and marks the wake delivered", async () => {
    const { x } = await accepted();
    try {
      await x.driver.round();
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("done");
      expect(x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get()).toEqual({ delivered: 1 });
    } finally { await x.dispose(); }
  });

  it("ends on a draining panel without delivering the wake", async () => {
    const { x } = await accepted();
    try {
      const gate = createAdmissionGate(); gate.beginDrain();
      await expect(exportPendingRequirements({ ...exportDeps(x), admissionGate: gate })).rejects.toMatchObject({ code: "panel-draining" });
      expect(x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get()).toEqual({ delivered: 0 });
    } finally { await x.dispose(); }
  });
});

describe("the start gate (N1 spec §9.3)", () => {
  it("confirm does not wait for the export; start is refused requirement-export-pending until it is done", async () => {
    const { x } = await accepted();
    try {
      const hash = x.profile.profileHash;
      const selections = await resolveGroupSelections({ store: x.store, port: x.deps.router.list()[0]!.port }, "r", "human");
      const confirmed = await x.service.confirm(x.command("confirm", { planHash: readArchivedPlan(x.store, "r").planHash, proposalVersion: readBudgetProposal(x.store, "r").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: selections.selectionsHash! }));
      expect(confirmed).toMatchObject({ result: { kind: "confirmed" } });
      expect(await x.service.start(x.command("start", {}))).toMatchObject({ error: { code: "requirement-export-pending" } });
      await exportRequirementDocument(exportDeps(x), "r");
      expect(await x.service.start(x.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
    } finally { await x.dispose(); }
  });
});

// Final review fix wave, triage (deferred T11): a GIT_* variable in Orca's own environment must not redirect the
// export's objects and ref into another repository.
describe("the export's git children and Orca's environment (final review triage)", () => {
  it("exports into the target even when Orca's environment carries GIT_DIR for another repository", async () => {
    const { x } = await accepted();
    try {
      const decoy = join(x.root, "decoy");
      await mkdir(decoy);
      const d = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: decoy, encoding: "utf8" }).trim();
      d("init", "-q", "-b", "main"); d("commit", "-q", "--allow-empty", "-m", "decoy");
      const saved = process.env.GIT_DIR;
      process.env.GIT_DIR = join(decoy, ".git");
      let outcome;
      try { outcome = await exportRequirementDocument(exportDeps(x), "r"); }
      finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved; }
      expect(outcome).toBe("done");
      expect(x.git("rev-parse", "refs/heads/orca/r^")).toBe(x.head());
      expect(d("for-each-ref", "refs/heads/orca")).toBe("");
    } finally { await x.dispose(); }
  });
});

// Final review fix wave, triage (deferred T11): the export's own commit always has HEAD as its one parent, so a tip with
// the trailer and the one document but no parent is somebody else's commit, and blocks.
describe("an existing branch whose tip is not the export's shape (final review triage)", () => {
  it("blocks requirement-export-conflict on a parentless tip that carries the trailer and only the document", async () => {
    const { x, text, sha } = await accepted();
    try {
      const requirement = readRequirementGroup(x.store, "r").requirement;
      const name = documentPathOf(requirement.createdOn, requirement.slug!, 1).slice(".orca/requirements/".length);
      const plumb = (args: string[], input: string) => execFileSync("git", args, { cwd: x.repo, input, encoding: "utf8" }).trim();
      const blob = plumb(["hash-object", "-w", "--stdin"], text);
      const requirements = plumb(["mktree"], `100644 blob ${blob}\t${name}\n`);
      const orca = plumb(["mktree"], `040000 tree ${requirements}\trequirements\n`);
      const root = plumb(["mktree"], `040000 tree ${orca}\t.orca\n`);
      const tip = plumb(["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", root], `docs(requirements): ${requirement.slug}\n\nOrca-Document-Sha256: ${sha}\n`);
      x.git("update-ref", "refs/heads/orca/r", tip, "");
      expect(await exportRequirementDocument(exportDeps(x), "r")).toBe("conflict");
      expect(readRequirementGroup(x.store, "r").requirement.export).toMatchObject({ state: "conflict", commit: null });
      expect(x.git("rev-parse", "refs/heads/orca/r")).toBe(tip);
    } finally { await x.dispose(); }
  });
});

describe("an archived group's requirement is not exported (issue-fixes spec §6.3)", () => {
  it("leaves the export pending and its wake undelivered while archived, and exports once unarchived", async () => {
    const { x, text } = await accepted();
    try {
      const wake = () => x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get();
      const archived = await x.service.archiveGroup(x.command("archive-group", {}));
      if ("error" in archived) throw new Error(JSON.stringify(archived));
      expect(await exportPendingRequirements(exportDeps(x))).toBe(false);
      expect(wake()).toEqual({ delivered: 0 });
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("pending");
      expect(() => x.git("rev-parse", "--verify", "-q", "refs/heads/orca/r")).toThrow();
      await x.service.unarchiveGroup(x.command("unarchive-group", {}));
      expect(await exportPendingRequirements(exportDeps(x))).toBe(true);
      expect(wake()).toEqual({ delivered: 1 });
      expect(x.git("show", `refs/heads/orca/r:${readRequirementGroup(x.store, "r").requirement.export.path}`)).toBe(text.trimEnd());
    } finally { await x.dispose(); }
  });
});
