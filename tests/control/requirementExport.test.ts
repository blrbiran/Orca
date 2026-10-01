import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAdmissionGate } from "../../src/control/admissionGate.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { exportPendingRequirements, exportRequirementDocument } from "../../src/control/requirementExport.js";
import { readDraft, readRequirementGroup } from "../../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
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
 * A `git` first on PATH that runs the real one and then, for the criterion, records what Orca's scratch files look like
 * after every git child (ORCA_T11_LOG), or plays a concurrent creator of the branch at `update-ref` (ORCA_T11_UPDATE_REF:
 * "race" creates the ref with the same arguments first, "fail" refuses without creating it).
 */
async function withGitShim<T>(dir: string, env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "git"), `#!/bin/sh
is_update_ref=no
for a in "$@"; do [ "$a" = update-ref ] && is_update_ref=yes; done
if [ "$is_update_ref" = yes ] && [ "$ORCA_T11_UPDATE_REF" = race ]; then "${real}" "$@"; fi
if [ "$is_update_ref" = yes ] && [ "$ORCA_T11_UPDATE_REF" = fail ]; then exit 1; fi
"${real}" "$@"; rc=$?
if [ -n "$ORCA_T11_LOG" ]; then for f in "$ORCA_T11_SCRATCH"/index-* "$ORCA_T11_SCRATCH"/document-* "$ORCA_T11_SCRATCH"/message-*; do
  [ -e "$f" ] && ls -ln "$f" >> "$ORCA_T11_LOG"; done; fi
exit $rc
`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, env, { PATH: `${dir}:${process.env.PATH ?? ""}` });
  try { return await body(); } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
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
      await expect(exportRequirementDocument({ ...exportDeps(x), gitTimeoutMs: 1 }, "r")).rejects.toThrow();
      expect(() => x.git("rev-parse", "--verify", "-q", "refs/heads/orca/r")).toThrow();
      expect(readRequirementGroup(x.store, "r").requirement.export.state).toBe("pending");
    } finally { await x.dispose(); }
  });
});

describe("the export's files outside the repository (controller ruling PR-I6, spec §13)", () => {
  it("keeps the temporary index and both scratch files 0600 in a 0700 directory after every git child, and removes them", async () => {
    const { x } = await accepted();
    const umask = process.umask(0o022);
    try {
      const scratch = `${x.store.stateDir}.overview`, log = join(x.root, "modes.log");
      const outcome = await withGitShim(join(x.root, "shim"), { ORCA_T11_LOG: log, ORCA_T11_SCRATCH: scratch }, () => exportRequirementDocument(exportDeps(x), "r"));
      expect(outcome).toBe("done");
      const lines = readFileSync(log, "utf8").trim().split("\n");
      for (const name of ["index-r", "document-r.md", "message-r.txt"]) expect(lines.some((line) => line.endsWith(`/${name}`))).toBe(true);
      // `ls -l` may follow the permission bits with an extended-attribute or ACL mark (macOS `@`, `+`; SELinux `.`).
      expect(lines.filter((line) => !/^-rw-------[@+.]? /.test(line))).toEqual([]);
      expect(statSync(scratch).mode & 0o777).toBe(0o700);
      expect(readdirSync(scratch).filter((name) => /^(index|document|message)-r/.test(name))).toEqual([]);
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
