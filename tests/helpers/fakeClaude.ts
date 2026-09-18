import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "chain", "fixtures");

export type Step =
  | { do: "commit"; file: string; content?: string }
  | { do: "write"; file: string; content?: string }
  | { do: "touch"; path: string }
  | { do: "rm"; path: string }
  | { do: "git"; args: string[] }
  | {
      do: "exitCheckpoint";
      status: "continue" | "done" | "blocked";
      why?: string;
      next?: string[];
      awaitingHuman?: Array<{ kind: string; what: string }>;
      measurements?: Array<{ command: string; exitCode: number }>;
    }
  | { do: "midCheckpoint"; next?: string[] }
  | { do: "background"; seconds?: number }
  | { do: "ignoreTerm" }
  | { do: "sleep"; ms: number };
export interface Scenario {
  steps?: Step[];
  result?: { subtype: string; cost: number | null } | null;
  exitCode?: number;
  stderr?: string;
}
export interface FakeCall {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  stdinIsDevNull: boolean;
  pid: number;
}
export interface FakeClaude {
  bin: string;
  /** Absolute path of this fake's `claude`: tests that need it NOT to be found by a PATH walk use this (plan PC-24). */
  claude: string;
  dir: string;
  env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  scenario(n: number, s: Scenario): Promise<void>;
  call(n: number): Promise<FakeCall | null>;
  calls(): Promise<Array<{ name: string; argv: string[] }>>;
  residue(): Promise<string[]>;
  teardown(): Promise<void>;
}

/** A command line this helper may kill: only its own fake or the fake's background sleep (review M3: pids get reused). */
const OWNED = (command: string): boolean => command.includes("fake-claude.mjs") || /\bsleep 3171\b/.test(command);

/**
 * Plan PC-24 (review C1): the real PATH minus every directory holding an executable `claude`. `execvp` keeps walking
 * PATH after an ENOENT from a bad interpreter, and on this machine the next `claude` is the real one (a cmux shim).
 */
function pathWithoutRealClaude(path: string): string {
  return path
    .split(":")
    .filter((d) => {
      try {
        accessSync(join(d, "claude"), constants.X_OK);
        return false;
      } catch {
        return true;
      }
    })
    .join(":");
}

const wrapper = (target: string, ...pre: string[]): string => `#!/bin/sh\nexec node '${target}' ${pre.map((p) => `'${p}'`).join(" ")} "$@"\n`;

/** A PATH directory with a fake `claude`, an `osascript` recorder and failing `orca`/`tsx`/`npx` stubs (D-launch spec §8.1). */
export async function fakeClaude(opts: { brokenShebang?: boolean } = {}): Promise<FakeClaude> {
  const root = await mkdtemp(join(tmpdir(), "orca-fake-claude-"));
  const bin = join(root, "bin");
  const dir = join(root, "state");
  await mkdir(bin);
  await mkdir(dir);
  // Plan PC-19: user-level settings are read from here, never from the person's ~/.claude.
  const claudeConfig = join(root, "claude-config");
  await mkdir(claudeConfig);
  await writeFile(join(bin, "claude"), opts.brokenShebang ? "#!/nonexistent/interpreter\n" : wrapper(join(FIXTURES, "fake-claude.mjs")), { mode: 0o755 });
  await writeFile(join(bin, "osascript"), wrapper(join(FIXTURES, "record-call.mjs"), "osascript"), { mode: 0o755 });
  for (const name of ["orca", "tsx", "npx"]) {
    await writeFile(join(bin, name), wrapper(join(FIXTURES, "record-call.mjs"), `forbidden-${name}`), { mode: 0o755 });
  }
  const pids = async (): Promise<number[]> =>
    readFile(join(dir, "pids"), "utf8").then((t) => t.split("\n").filter((l) => l !== "").map(Number), () => []);
  return {
    bin,
    claude: join(bin, "claude"),
    dir,
    env: (extra = {}) => ({
      ...process.env,
      PATH: `${bin}:${pathWithoutRealClaude(process.env.PATH ?? "")}`,
      FAKE_CLAUDE_DIR: dir,
      CLAUDE_CONFIG_DIR: claudeConfig,
      ...extra,
    }),
    scenario: (n, s) => writeFile(join(dir, `${n}.json`), JSON.stringify(s)),
    call: (n) => readFile(join(dir, `call-${n}.json`), "utf8").then((t) => JSON.parse(t) as FakeCall, () => null),
    calls: () =>
      readFile(join(dir, "calls.jsonl"), "utf8").then(
        (t) => t.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { name: string; argv: string[] }),
        () => [],
      ),
    residue: async () => {
      const own = await pids();
      if (own.length === 0) return [];
      const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,pgid=,command="]);
      return stdout.split("\n").filter((line) => {
        const [pid, pgid] = line.trim().split(/\s+/).map(Number);
        return (own.includes(pid) || own.includes(pgid)) && OWNED(line);
      });
    },
    // Explicit teardown that works even when the adapter's own cleanup is the thing a mutation deleted: each recorded
    // pid is killed as a group and alone (a non-detached child is not a group leader) — but only after `ps` confirms it
    // is still one of ours (review M3).
    teardown: async () => {
      for (const pid of await pids()) {
        const command = await promisify(execFile)("ps", ["-o", "command=", "-p", String(pid)]).then((r) => r.stdout, () => "");
        if (!OWNED(command)) continue;
        for (const target of [-pid, pid]) {
          try {
            process.kill(target, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
