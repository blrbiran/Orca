import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CheckpointSchema } from "../../src/checkpoint/schema.js";
import { claudeProjectsRoot, findTranscript } from "../../src/checkpoint/transcript.js";
import { writeCheckpoint } from "../../src/checkpoint/write.js";
import { git } from "../../src/scheduler/gitExec.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { checkpointFixture } from "../helpers/checkpoint.js";
import { runCli } from "../helpers/runCli.js";
import { NOW, checkpointSession, writeTranscript } from "../helpers/session.js";
import { SESSION } from "../helpers/transcript.js";

const FILE = ".orca/checkpoints/orca-dev-0a1b2c3d.json";
const head = async (repo: string): Promise<string> => (await git(repo, ["rev-parse", "HEAD"])).trim();
const write = (s: { repo: string; transcriptPath: string; draftPath: string }) =>
  writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });
const stored = async (repo: string) => JSON.parse(await readFile(join(repo, FILE), "utf8"));
/** Empty directories for CLAUDE_CONFIG_DIR and HOME, so a mutation that drops a branch still never reads ~/.claude. */
const decoy = () => mkdtemp(join(tmpdir(), "orca-decoy-"));
async function projectsWith(...dirs: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orca-projects-"));
  for (const d of dirs) {
    await mkdir(join(root, d));
    await writeTranscript(join(root, d, `${SESSION}.jsonl`), 400_000);
  }
  return root;
}

describe("checkpoint write in a chain (D-launch spec §3.1, §3.4)", () => {
  isolateChainEnv();

  it("C1 a done exit checkpoint keeps its chain mark and may have no next step", async () => {
    const s = await checkpointSession(400_000, { next: [], chain: { status: "done", why: "goal met" } });
    await write(s);
    const cp = await stored(s.repo);
    expect(cp.chain).toEqual({ status: "done", why: "goal met" });
    expect(cp.next).toEqual([]);
  });

  it("C2 refuses an empty next unless the chain is done, and writes nothing", async () => {
    const s = await checkpointSession(400_000, { next: [], chain: { status: "continue", why: "w" } });
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "draft-invalid" });
    await expect(write(s)).rejects.toThrow("next: must name at least one next step unless chain.status is done");
    expect(existsSync(join(s.repo, FILE))).toBe(false);
    expect(await head(s.repo)).toBe(before);
  });

  it("C3 refuses a blocked mark with nothing awaiting a human", async () => {
    const s = await checkpointSession(400_000, { next: ["n"], chain: { status: "blocked", why: "w" } });
    await expect(write(s)).rejects.toThrow("awaitingHuman: must not be empty when chain.status is blocked");
    expect(existsSync(join(s.repo, FILE))).toBe(false);
  });

  it("C4 accepts a blocked mark that names what waits", async () => {
    const s = await checkpointSession(400_000, {
      next: ["n"],
      awaitingHuman: [{ kind: "irreversible", what: "push main" }],
      chain: { status: "blocked", why: "only the push is left" },
    });
    await write(s);
    const cp = await stored(s.repo);
    expect(cp.chain).toEqual({ status: "blocked", why: "only the push is left" });
    expect(cp.awaitingHuman).toEqual([{ kind: "irreversible", what: "push main" }]);
  });

  it("S1 a checkpoint without chain still parses (v stays 1)", () => {
    expect(CheckpointSchema.safeParse(checkpointFixture()).success).toBe(true);
  });

  it("S2 CheckpointSchema: done allows an empty next", () => {
    expect(CheckpointSchema.safeParse(checkpointFixture({ next: [], chain: { status: "done", why: "w" } })).success).toBe(true);
  });

  it("S3 CheckpointSchema: continue with an empty next fails", () => {
    expect(CheckpointSchema.safeParse(checkpointFixture({ next: [], chain: { status: "continue", why: "w" } })).success).toBe(false);
  });

  it("S4 CheckpointSchema: blocked without awaitingHuman fails", () => {
    expect(CheckpointSchema.safeParse(checkpointFixture({ chain: { status: "blocked", why: "w" } })).success).toBe(false);
  });

  it("S5 CheckpointSchema: an unknown status fails", () => {
    expect(CheckpointSchema.safeParse({ ...checkpointFixture(), chain: { status: "paused", why: "w" } }).success).toBe(false);
  });

  it("T1 finds the transcript by session id under ORCA_CLAUDE_PROJECTS_DIR when --transcript is not given", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    const root = await projectsWith("-a-project");
    await mkdir(join(root, "-another-project"));
    const d = await decoy();
    await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, draftPath: s.draftPath, now: NOW, env: { ORCA_CLAUDE_PROJECTS_DIR: root, CLAUDE_CONFIG_DIR: d, HOME: d } });
    // 400_001 = the looked-up transcript's 400_000 prompt tokens + 1 output token; s.transcriptPath (prompt 1) was not read.
    expect((await stored(s.repo)).level).toEqual({ kind: "reading", level: 400_001, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 1 });
  });

  it("T2 refuses by name when no directory, or more than one, has the transcript; writes nothing", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    const d = await decoy();
    const none = await mkdtemp(join(tmpdir(), "orca-projects-"));
    await expect(
      writeCheckpoint({ repo: s.repo, sessionRef: SESSION, draftPath: s.draftPath, now: NOW, env: { ORCA_CLAUDE_PROJECTS_DIR: none, CLAUDE_CONFIG_DIR: d, HOME: d } }),
    ).rejects.toMatchObject({ code: "transcript-not-found" });
    const two = await projectsWith("-p1", "-p2");
    const refused = writeCheckpoint({ repo: s.repo, sessionRef: SESSION, draftPath: s.draftPath, now: NOW, env: { ORCA_CLAUDE_PROJECTS_DIR: two, CLAUDE_CONFIG_DIR: d, HOME: d } });
    await expect(refused).rejects.toMatchObject({ code: "transcript-ambiguous" });
    await expect(refused).rejects.toThrow(`${join(two, "-p1", `${SESSION}.jsonl`)}, ${join(two, "-p2", `${SESSION}.jsonl`)}`);
    expect(existsSync(join(s.repo, FILE))).toBe(false);
  });

  it("T3 falls back to $CLAUDE_CONFIG_DIR/projects (review M2: the cmux wrapper moves it)", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    const config = await mkdtemp(join(tmpdir(), "orca-config-"));
    await mkdir(join(config, "projects", "-p"), { recursive: true });
    await writeTranscript(join(config, "projects", "-p", `${SESSION}.jsonl`), 400_000);
    const d = await decoy();
    await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, draftPath: s.draftPath, now: NOW, env: { CLAUDE_CONFIG_DIR: config, HOME: d } });
    expect((await stored(s.repo)).level.level).toBe(400_001);
  });

  it("T4 an empty ORCA_CLAUDE_PROJECTS_DIR wins over a CLAUDE_CONFIG_DIR that has the transcript (spec §8.2-10: the redirection takes effect)", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    const config = await mkdtemp(join(tmpdir(), "orca-config-"));
    await mkdir(join(config, "projects", "-p"), { recursive: true });
    await writeTranscript(join(config, "projects", "-p", `${SESSION}.jsonl`), 400_000);
    const empty = await mkdtemp(join(tmpdir(), "orca-projects-"));
    const d = await decoy();
    await expect(
      writeCheckpoint({ repo: s.repo, sessionRef: SESSION, draftPath: s.draftPath, now: NOW, env: { ORCA_CLAUDE_PROJECTS_DIR: empty, CLAUDE_CONFIG_DIR: config, HOME: d } }),
    ).rejects.toMatchObject({ code: "transcript-not-found" });
  });

  it("T6 a session ref that would climb out of the projects root is session-ref-unusable, though a file waits there (final review, T2)", async () => {
    // runIdFor accepts anything that starts with 8 hex digits (schema.ts), so this ref reaches findTranscript.
    const parent = await mkdtemp(join(tmpdir(), "orca-escape-"));
    const root = join(parent, "projects");
    await mkdir(join(root, "-p"), { recursive: true });
    // Where the ref would land from <root>/-p/: <parent>/outside.jsonl. It exists, so only the guard stands between.
    await writeFile(join(parent, "outside.jsonl"), "");
    const d = await decoy();
    const ref = "abcdef12/../../../outside";
    await expect(findTranscript(ref, { ORCA_CLAUDE_PROJECTS_DIR: root, CLAUDE_CONFIG_DIR: d, HOME: d })).rejects.toMatchObject({
      code: "session-ref-unusable",
      message: `session ${JSON.stringify(ref)} cannot name a transcript file`,
    });
  });

  it("T5 projects root precedence: ORCA_CLAUDE_PROJECTS_DIR, then $CLAUDE_CONFIG_DIR/projects, then $HOME/.claude/projects", () => {
    expect(claudeProjectsRoot({ ORCA_CLAUDE_PROJECTS_DIR: "/o", CLAUDE_CONFIG_DIR: "/c", HOME: "/h" })).toBe("/o");
    expect(claudeProjectsRoot({ CLAUDE_CONFIG_DIR: "/c", HOME: "/h" })).toBe("/c/projects");
    expect(claudeProjectsRoot({ HOME: "/h" })).toBe("/h/.claude/projects");
  });

  it("P1 in a chain session, refuses a --session other than ORCA_CHAIN_SESSION and writes nothing; the same id passes", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    const other = "ffffffff-0000-4000-8000-000000000000";
    await expect(
      writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW, env: { ORCA_CHAIN_SESSION: other } }),
    ).rejects.toMatchObject({ code: "session-mismatch" });
    expect(existsSync(join(s.repo, FILE))).toBe(false);
    await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW, env: { ORCA_CHAIN_SESSION: SESSION } });
    expect(existsSync(join(s.repo, FILE))).toBe(true);
  });

  it("CLI1 through the real process: --transcript may be left out", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    const root = await projectsWith("-p");
    const d = await decoy();
    const out = await runCli(["checkpoint", "write", "--repo", s.repo, "--session", SESSION, "--draft", s.draftPath], "", undefined, {
      ...process.env,
      ORCA_CLAUDE_PROJECTS_DIR: root,
      CLAUDE_CONFIG_DIR: d,
      HOME: d,
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("level 400001 of 1000000 (T1 330000, T2 450000, band 1)\n");
  });
});
