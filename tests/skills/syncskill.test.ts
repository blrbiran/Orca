import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROFILE_NAME_PATTERN, SyncskillError, injectSkills, isSafeSkillName, profileMembers, type SyncskillOptions } from "../../src/skills/syncskill.js";

/**
 * Syncskill integration spec §4.5 / §10.8 C18. Each promise is pinned on what the fake was actually called with
 * (the exact argv: a dropped --no-refresh makes syncskill write under its sync dir) and on the code a refusal carries.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function world(mode: string, over: Partial<SyncskillOptions> = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-fake-syncskill-")));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const log = join(dir, "calls.jsonl");
  const o: SyncskillOptions = { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_MODE: mode, FAKE_SYNCSKILL_LOG: log }, ...over };
  const calls = (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]) : []);
  return { dir, o, calls };
}
async function refusal(p: Promise<unknown>): Promise<SyncskillError> {
  return p.then(
    () => { throw new Error("expected a refusal, got a value"); },
    (err: unknown) => { if (err instanceof SyncskillError) return err; throw err; },
  );
}

describe("profileMembers", () => {
  it("runs exactly --json --no-refresh profile ls <p> (C18: profile ls without --no-refresh writes the sync dir)", async () => {
    const w = await world("profile-ok");
    await profileMembers(w.o, "my-prof_1");
    expect(w.calls()).toEqual([["--json", "--no-refresh", "profile", "ls", "my-prof_1"]]);
  });

  it("returns members sorted and unique, so a frozen set does not depend on syncskill's order", async () => {
    const w = await world("profile-dupes");
    expect(await profileMembers(w.o, "p")).toEqual(["alpha", "beta"]);
  });

  it("refuses an empty profile as skills-profile-empty", async () => {
    expect((await refusal(profileMembers((await world("profile-empty")).o, "p"))).code).toBe("skills-profile-empty");
  });

  it("refuses a member holding a comma as skills-shape, because inject --skills would split it", async () => {
    expect((await refusal(profileMembers((await world("profile-comma")).o, "p"))).code).toBe("skills-shape");
  });

  it("refuses a profile name that breaks PROFILE_NAME_PATTERN without spawning", async () => {
    const w = await world("profile-ok");
    expect((await refusal(profileMembers(w.o, "a b"))).code).toBe("skills-shape");
    expect(PROFILE_NAME_PATTERN.test("a-b_C9")).toBe(true);
    expect(w.calls()).toEqual([]);
  });

  it("names the error event's code: syncskill-failed:E_PROFILE_NOT_FOUND (exit 2)", async () => {
    expect((await refusal(profileMembers((await world("profile-missing")).o, "p"))).code).toBe("syncskill-failed:E_PROFILE_NOT_FOUND");
  });

  it("reads the error event from stderr too", async () => {
    expect((await refusal(profileMembers((await world("error-on-stderr")).o, "p"))).code).toBe("syncskill-failed:E_SKILL_NOT_FOUND");
  });

  it("names the exit status when there is no error event: syncskill-failed:1", async () => {
    expect((await refusal(profileMembers((await world("crash")).o, "p"))).code).toBe("syncskill-failed:1");
  });

  it("refuses output with no result event as syncskill-output-invalid", async () => {
    expect((await refusal(profileMembers((await world("garbage")).o, "p"))).code).toBe("syncskill-output-invalid");
  });

  it("refuses a result that does not list the asked profile as syncskill-output-invalid", async () => {
    expect((await refusal(profileMembers((await world("profile-other")).o, "p"))).code).toBe("syncskill-output-invalid");
  });
});

describe("injectSkills", () => {
  it("runs exactly --json inject --skills a,b --target <t> and returns the lock entries", async () => {
    const w = await world("inject-ok");
    const target = join(w.dir, "t");
    const lock = await injectSkills(w.o, ["a", "b"], target);
    expect(w.calls()).toEqual([["--json", "inject", "--skills", "a,b", "--target", target]]);
    expect(lock).toEqual([
      { name: "a", source: { name: "src", type: "git", url: "https://example.invalid/s.git", branch: "main" }, resolved_commit: "abc123", content_md5: "md5-a" },
      { name: "b", source: null, resolved_commit: null, content_md5: "md5-b" },
    ]);
    expect(await readFile(join(target, "a", "SKILL.md"), "utf8")).toBe("# a\n");
  });

  it("refuses a name that breaks the name rule as skills-shape, before spawning", async () => {
    const w = await world("inject-ok");
    for (const bad of ["a,b", " a", "a ", ".hidden", "a/b", "", "a\\b", "a\0b"]) expect((await refusal(injectSkills(w.o, [bad], join(w.dir, "t")))).code).toBe("skills-shape");
    expect((await refusal(injectSkills(w.o, [], join(w.dir, "t")))).code).toBe("skills-shape");
    expect(w.calls()).toEqual([]);
  });

  it("refuses a lock entry with a field the schema does not know as syncskill-output-invalid", async () => {
    const w = await world("inject-bad-shape");
    expect((await refusal(injectSkills(w.o, ["a", "b"], join(w.dir, "t")))).code).toBe("syncskill-output-invalid");
  });

  it("refuses a source object with a field the schema does not know as syncskill-output-invalid", async () => {
    const w = await world("inject-bad-source");
    expect((await refusal(injectSkills(w.o, ["a", "b"], join(w.dir, "t")))).code).toBe("syncskill-output-invalid");
  });

  it("names the error event's code on failure", async () => {
    expect((await refusal(injectSkills((await world("error-on-stderr")).o, ["a"], "/x"))).code).toBe("syncskill-failed:E_SKILL_NOT_FOUND");
  });
});

describe("isSafeSkillName (spec §10.4)", () => {
  it("is syncskill's rule plus no comma and no edge whitespace", () => {
    expect(["alpha", "a b", "a-b_c.d"].map(isSafeSkillName)).toEqual([true, true, true]);
    expect(["", ".x", "a/b", "a\\b", "a\0b", "a,b", " a", "a ", "\ta"].map(isSafeSkillName)).toEqual(Array(9).fill(false));
  });
});

describe("starting syncskill", () => {
  it("a null bin is syncskill-unconfigured and starts nothing", async () => {
    const w = await world("profile-ok", { bin: null });
    expect((await refusal(profileMembers(w.o, "p"))).code).toBe("syncskill-unconfigured");
    expect((await refusal(injectSkills(w.o, ["a"], "/x"))).code).toBe("syncskill-unconfigured");
    expect(w.calls()).toEqual([]);
  });

  it("a relative bin is syncskill-missing and starts nothing", async () => {
    const w = await world("profile-ok", { bin: "syncskill" });
    expect((await refusal(profileMembers(w.o, "p"))).code).toBe("syncskill-missing");
    expect(w.calls()).toEqual([]);
  });

  it("an absolute path that does not exist is syncskill-missing (ENOENT)", async () => {
    const w = await world("profile-ok");
    expect((await refusal(profileMembers({ ...w.o, bin: join(w.dir, "nope") }, "p"))).code).toBe("syncskill-missing");
  });

  it("a file without the execute bit is syncskill-missing (EACCES)", async () => {
    const w = await world("profile-ok");
    await chmod(w.o.bin!, 0o644);
    expect((await refusal(profileMembers(w.o, "p"))).code).toBe("syncskill-missing");
  });

  it("a spawn errno Node throws instead of calling back is named, not thrown (ENOEXEC)", async () => {
    const w = await world("profile-ok");
    const bin = join(w.dir, "noshebang");
    await writeFile(bin, "\x00\x01 not a program\n", { mode: 0o755 });
    const err = await refusal(profileMembers({ ...w.o, bin }, "p"));
    expect(err.code).toMatch(/^syncskill-failed:[A-Z][A-Z0-9_]*$/);
  });

  it("a run past the timeout is syncskill-timeout", async () => {
    expect((await refusal(profileMembers((await world("sleep", { timeoutMs: 300 })).o, "p"))).code).toBe("syncskill-timeout");
  });

  it("output past maxBuffer is syncskill-output-too-large", async () => {
    expect((await refusal(profileMembers((await world("big", { maxBufferBytes: 1000 })).o, "p"))).code).toBe("syncskill-output-too-large");
  });

  it("stdin is closed, so a syncskill that waits for EOF on it does not hang", async () => {
    const w = await world("waits-for-stdin", { timeoutMs: 5000 });
    expect(await profileMembers(w.o, "p")).toEqual(["alpha"]);
  });
});
