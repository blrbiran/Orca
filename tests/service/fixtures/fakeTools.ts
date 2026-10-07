import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceConfigV1 } from "../../../src/service/config.js";
import type { ServiceContext } from "../../../src/service/manager.js";
import { servicePaths, type ServicePaths } from "../../../src/service/paths.js";
import { runTool } from "../../../src/service/tools.js";

/**
 * A fake launchctl/systemctl/loginctl/journalctl/tail/sudo. Each call appends "<name> <argv>" to argv.log. The
 * subcommand is $1, or $2 after --user. Exit codes come from <name>.<sub>.codes (one per line, consumed in order,
 * default 0); stdout from <name>.<sub>.out. No braces in the script: this is a template literal.
 * The queue is consumed with head and sed, never tail: tail is itself one of the fakes and is first on PATH.
 */
const SCRIPT = `#!/bin/sh
dir="$FAKE_TOOLS_DIR"
name=$(basename "$0")
printf '%s\\n' "$name $*" >> "$dir/argv.log"
sub="$1"
if [ "$1" = "--user" ]; then sub="$2"; fi
queue="$dir/$name.$sub.codes"
code=0
if [ -s "$queue" ]; then
  code=$(head -n 1 "$queue")
  sed '1d' "$queue" > "$queue.next"
  mv "$queue.next" "$queue"
fi
if [ -f "$dir/$name.$sub.out" ]; then cat "$dir/$name.$sub.out"; fi
exit "$code"
`;

export interface FakeTools {
  bin: string;
  env: NodeJS.ProcessEnv;
  codes(tool: string, sub: string, list: number[]): Promise<void>;
  output(tool: string, sub: string, text: string): Promise<void>;
  calls(): Promise<string[]>;
}

export async function fakeTools(root: string, names = ["launchctl", "systemctl", "loginctl", "journalctl", "tail", "sudo"]): Promise<FakeTools> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  for (const name of names) { await writeFile(join(bin, name), SCRIPT); await chmod(join(bin, name), 0o755); }
  return {
    bin,
    // /usr/bin:/bin stay on PATH for head/sed/mv inside the script and for the real ps. The script never calls a
    // faked name (tail is faked and first on PATH), so it must not use tail.
    env: { FAKE_TOOLS_DIR: root, PATH: `${bin}:/usr/bin:/bin` },
    codes: (tool, sub, list) => writeFile(join(root, `${tool}.${sub}.codes`), list.map((c) => `${c}\n`).join("")),
    output: (tool, sub, text) => writeFile(join(root, `${tool}.${sub}.out`), text),
    calls: async () => { try { return (await readFile(join(root, "argv.log"), "utf8")).split("\n").filter((l) => l.length > 0); } catch { return []; } },
  };
}

export const testPaths = (root: string): ServicePaths => servicePaths({
  ORCA_PANEL_DIR: join(root, "p"), ORCA_LAUNCH_AGENTS_DIR: join(root, "la"), ORCA_SYSTEMD_USER_DIR: join(root, "su"),
  ORCA_SERVICE_LABEL: "dev.orca.panel.test", ORCA_SERVICE_UNIT: "orca-panel-test",
});

export const sampleConfig = (paths: ServicePaths): ServiceConfigV1 => ({
  schema: "orca-panel-service-v1", node: process.execPath, entry: "/src/orca/dist/cli.js",
  args: ["--by", "ann", "--port", "7777", "--repo", "orca=/src/orca-web"],
  env: { HOME: "/home/ann", NODE_OPTIONS: "", ORCA_PANEL_DIR: paths.panelDir, PATH: "/usr/bin:/bin" },
});

/**
 * A context whose clock only moves when the code sleeps: deadlines are tested without waiting for them. Each sleep
 * still yields one macrotask, so code that lost its deadline fails by the test timeout instead of hanging the worker.
 */
export function fakeContext(fake: FakeTools, paths: ServicePaths, over: Partial<ServiceContext> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const ctx: ServiceContext = {
    paths, env: { ...process.env, ...fake.env }, run: runTool, uid: 501, user: "ann",
    out: (line) => out.push(line), err: (line) => err.push(line),
    sleep: async (ms) => { clock += ms; await new Promise((resolve) => setImmediate(resolve)); }, now: () => clock,
    isAlive: () => false, startTimeOf: () => null,
    bootstrapDeadlineMs: 2_000, exitWaitMs: 30_000, startWaitMs: 30_000,
    ...over,
  };
  return { ctx, out, err };
}
