# Panel as a per-user service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution (decided, not to be asked again):** subagent-driven, in a **new session**. One implementer subagent per task, a fresh reviewer per task, a whole-branch review at the end. Work in a `git worktree` on a new branch `panel-service` (superpowers:using-git-worktrees): another agent may be committing to `main` at the same time (memory: parallel agents use a worktree branch). Merging into `main` is the human's (Rule 15). Ledger: `.superpowers/sdd/2026-10-07-panel-service/progress.md` (skeleton committed with this plan; gitignored directory, `git add -f`).

**Goal:** Run the Orca panel as a per-user service (launchd LaunchAgent on macOS, systemd user unit on Linux, a detached process where neither exists) installed and driven by `orca panel install|uninstall|start|stop|restart|status|logs`, with a single-instance lock, a `panel.json` discovery file and log rotation.

**Architecture:** Orca never daemonizes itself. `orca panel install <panel args>` records everything the panel needs in `~/.orca/panel/service.json` (+ `service.env`, `run.sh`), then a platform `ServiceManager` (launchd / systemd / detached, one interface) writes its definition from pure generators and loads it with `launchctl` / `systemctl --user`. The managed process is `node dist/cli.js panel run --service <args>`: only that form takes the `O_EXCL` lock, writes `panel.json`, rotates logs and exits 78 on a bind failure. `status` combines the manager's view with a real request over the control socket.

**Tech Stack:** TypeScript (ESM, NodeNext, Node ≥ 22.13.1), `tsc` for the new `dist/` build, express 5, zod 3, vitest 5; `launchctl`, `systemctl`, `loginctl`, `journalctl`, `tail`, `ps` as external tools (faked on a test PATH).

**Spec:** `docs/superpowers/specs/2026-10-07-panel-service-design.md` (§1–§9, human-approved 2026-10-07), plus §10 plan-time decisions appended by Task 0. Conventions follow `docs/superpowers/plans/2026-10-07-agent-entry.md`.

## Global Constraints

- Never touch the human's real service, `~/Library/LaunchAgents`, `~/.config/systemd`, or `~/.orca` in any criterion (Rule 17). Every path is relocatable by env: `ORCA_PANEL_DIR` (default `~/.orca/panel`), `ORCA_LAUNCH_AGENTS_DIR` (default `~/Library/LaunchAgents`), `ORCA_SYSTEMD_USER_DIR` (default `${XDG_CONFIG_HOME:-~/.config}/systemd/user`), `ORCA_SERVICE_LABEL` (default `dev.orca.panel`), `ORCA_SERVICE_UNIT` (default `orca-panel`). `tests/setup/relocateUserData.ts` sets all five for every test file (Task 2).
- Never run the real `launchctl`/`systemctl`/`loginctl`/`journalctl` in a criterion: command sequences run against fake scripts on a test PATH that log argv (`tests/service/fixtures/fakeTools.ts`, Task 5). The one real smoke (Task 12) is opt-in (`ORCA_SERVICE_REAL=1`), macOS only, under a relocated label and state dir, and is **not** run by the gate.
- New directories `0700`, new files `0600`, created with an explicit mode (never from umask); an existing directory's mode is never changed. Generated files (`service.json`, `service.env`, `run.sh`, plist, unit, `panel.json`, `panel.lock`, log files) are written `0600`.
- Orca never runs `sudo`. Agents never install, start, stop or uninstall the human's service: those are human-run commands (spec §7), listed under awaitingHuman.
- Plain `orca panel <args>` and `orca panel run <args>` (no `--service`) stay byte-for-byte as today: no lock, no `panel.json`, same stdout ready line `orca-panel ready url=<url> token=<token>`, same exit codes (plan decision D2).
- Exit codes: `orca panel run --service`: 0 clean exit or another live panel holds the lock, 78 port or socket bind failed, 1 other refusal. `orca panel <service subcommand>`: 0 success (for `status`: the panel answered), 1 anything else.
- Named refusal codes (prefix `rejected: <code>: <message>` on stderr): `service-name-invalid`, `service-dist-missing`, `service-dist-stale`, `service-path-not-absolute`, `service-panel-args-invalid`, `service-argument-reserved`, `service-value-newline`, `service-env-value-unsupported`, `service-not-installed`, `service-config-invalid`, `service-manager-invalid`, `service-platform-unsupported`, `service-detach-required`, `service-argument-invalid`, `panel-lock-contended`; panel: `panel-bind-failed` (exit 78).
- Code, comments, commits, ledger: English. Commits end with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and the session's `Claude-Session:` line. Use `/usr/bin/git`, `/bin/rm`, `/bin/cp`. `git add <paths>` only, never `-A`.
- Verification output is redirected to a file and read back whole; never piped through grep/tail/head (Rule 14). `$SCRATCH` is the executing session's scratchpad directory.
- Rule 9: every new branch gets a named deletion mutation, run only in a `git clone --local` copy (`$SCRATCH/mut-tN`), seen red, and restored (`git diff | wc -c` and `git diff --cached | wc -c` both 0 in the clone). Each task lists its own; Task 13 collects them.

## Review Focus

1. **The old `~/.orca/panel.sh` panel is still running on port 7777 when the service starts.** The service must exit 78 (no restart loop under systemd, throttled under launchd) and `status` must say "not answering" and show the bind error from the log, not "running". Pinned in Task 8 (port-held → 78) and Task 9 (`statusLines` with an error tail).
2. **A lock or `panel.json` left by a crash or `kill -9`, whose pid was later reused by an unrelated process.** The lock must be taken over (start time differs), and `stop` (detached) must refuse to SIGTERM the unrelated process. Pinned in Task 8 (start-time mismatch takeover) and Task 10 (stop refuses on mismatch, process stays alive).
3. **`orca panel restart` after an Orca upgrade changed the plist template.** `kickstart -k` would keep running the old plist; restart must bootout, wait for the pid to exit, and bootstrap. Pinned in Task 6 (changed vs unchanged plist branches, and the never-exiting pid).
4. **Install from a shell where a flag or variable is a relative path, or `node` lives under nvm.** The service does not run in that shell's directory and nvm versions get removed: relative paths are refused by name, the nvm case warns. Pinned in Task 3.
5. **An existing criterion that boots `orca panel` with no `--service`** (dozens do, concurrently). It must not take a lock, write `panel.json`, or reach the real `~/.orca/panel`. Pinned by decision D2 (Task 8 test "plain run takes no lock") and by the relocation guard (Task 2).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tsconfig.build.json` | create | compile `src/` alone to `dist/` (`src/cli.ts` → `dist/cli.js`) |
| `package.json` | modify | `build` script; `verify` runs it |
| `src/service/rejection.ts` | create | `ServiceRejection` (named refusals) |
| `src/service/paths.ts` | create | label/unit names and every service path, relocatable by env |
| `src/service/config.ts` | create | `service.json` content from install args + env; dist freshness |
| `src/service/render.ts` | create | pure generators: `service.env`, `run.sh`, plist, unit; quoting |
| `src/service/files.ts` | create | private dirs/files (explicit modes), atomic writes, read config, tail |
| `src/service/tools.ts` | create | run an external tool (argv, env, exit code) |
| `src/service/manager.ts` | create | `ServiceManager` interface, `ServiceContext`, `waitExit`, default context |
| `src/service/launchd.ts` | create | macOS manager |
| `src/service/systemd.ts` | create | Linux manager + preflight (XDG/DBus env, linger) |
| `src/service/processInfo.ts` | create | process start time (`ps -o lstart=`), liveness |
| `src/service/instance.ts` | create | `panel.lock` (O_EXCL via link), `panel.json` read/write |
| `src/service/logRotate.ts` | create | copy-truncate rotation, 10 MiB, keep 3 |
| `src/service/servicePanel.ts` | create | `orca panel run --service`: lock → panel → panel.json → release |
| `src/service/identify.ts` | create | socket (or TCP) identify of the panel `panel.json` names |
| `src/service/status.ts` | create | combine manager state + identify into lines and an exit code |
| `src/service/detached.ts` | create | detached fallback manager |
| `src/service/command.ts` | create | `orca panel <subcommand>` parsing, manager selection, install/dry-run |
| `src/panel/server.ts` | modify | `PanelMode.service`: bind failures → `panel-bind-failed` (78); `panelReadyLines` |
| `src/panel/rejection.ts` | modify | `PanelExitCode` gains 78; `PANEL_BIND_FAILED` |
| `src/entry/discovery.ts` | modify | `panel.json` is the first source after the explicit flag |
| `src/cli.ts` | modify | `panel run` / service subcommands dispatch; `--service`; USAGE |
| `skills/orca-control/SKILL.md` | modify | service commands are "ask the human" |
| `tests/setup/relocateUserData.ts` | modify | relocate the five service variables; guard real plist/unit |
| `tests/service/*.test.ts`, `tests/service/fixtures/*` | create | criteria and fakes |
| `tests/entry/discovery.test.ts`, `tests/panel/usage.test.ts` | modify | explicit `ORCA_PANEL_DIR` in env objects; usage text |

---

### Task 0: Record plan-time decisions in the spec

**Files:** Modify: `docs/superpowers/specs/2026-10-07-panel-service-design.md` (append only — Rule 13: the text above stays verbatim)

- [ ] **Step 1: Append §10:**

```markdown
## 10. Plan-time decisions (2026-10-07, session 9a20ac38)

- D1. The unit uses `Restart=on-failure`, not §4's `Restart=always`. §5 requires that a second instance exiting 0 "does not loop" under systemd; `Restart=always` restarts after a clean exit too, so the two sentences contradict and §5's behaviour is the one that matters. `on-failure` with `SuccessExitStatus=0 143` and `RestartPreventExitStatus=78` matches launchd's `KeepAlive={SuccessfulExit:false}`.
- D2. The single-instance lock, `panel.json`, log rotation and exit 78 belong to `orca panel run --service` only — the form `run.sh` and the unit execute. Plain `orca panel` / `orca panel run` are unchanged: dozens of criteria boot panels concurrently, and a lock in `~/.orca/panel` would make all but one exit 0 and would write into the real home (Rule 17).
- D3. Captured variables add `ORCA_CORRECTIONS_DIR`, `ORCA_PROJECTS_FILE` and `ORCA_PANEL_DIR` to §3's list: a relocated install (the opt-in smoke) must keep every user-data path relocated inside the service, or the service writes the real `~/.orca`.
- D4. The build is `tsc -p tsconfig.build.json` with `rootDir: src`, `outDir: dist`, so `src/cli.ts` → `dist/cli.js` and `src/panel/x.ts` → `dist/panel/x.js`. Modules locate the checkout as `../..` from their own file (`staticFiles.ts`, `chains.ts`, `chain/run.ts`, `level/invocation.ts`); that stays the checkout root from `dist/`. `npm run verify` runs the build so a `src` import from outside `src` (TS6059) is caught.
- D5. The unit names `service.env` and the working directory by absolute path (escaped `%` → `%%`) instead of `%h/.orca/panel`: identical for the default, and correct for a relocated panel directory.
- D6. A relative path in a path-valued panel flag (`--repo`, `--root`, `--profile`, `--projects-file`, `--control-state-dir`, `--dist`, `--plan`) or captured variable is refused at install (`service-path-not-absolute`), not resolved against the installing shell's directory.
- D7. Install validates the panel arguments with the panel's own parser (`parsePanelArgs`) and refuses before writing anything (`service-panel-args-invalid`).
- D8. `service.env` lines are `KEY="value"`, readable by both `/bin/sh` (`set -a; . file`) and systemd `EnvironmentFile=`. A value containing `"`, `\`, `$`, a backtick or a line break is refused (`service-env-value-unsupported`) rather than escaped two different ways.
- D9. A process's start time is `ps -o lstart= -p <pid>` with `LC_ALL=C`, on both platforms (one-second resolution).
- D10. The lock is created by `link()` from a complete temp file, so no reader sees a half-written lock; a stale lock is removed only if its bytes are unchanged since it was judged stale.
- D11. Log rotation is copy-truncate: launchd opens `StandardOutPath`/`StandardErrorPath` before the panel runs, so a rename would leave the panel writing into the rotated file.
- D12. With no control socket (`--no-control`), liveness is `GET /` on the panel's URL; with a socket it is `GET /api/control/summary` over the socket (§5).
- D13. In service mode a control-socket bind failure also exits 78 (§5 says "port or socket"); outside service mode it stays fail-soft (agent entry spec §3).
- D14. `orca panel start --detach` forces the detached manager. When no manager is detected, `start` without `--detach` is refused (`service-detach-required`), so the person types the flag that says "no restart, no reboot survival".
- D15. Test relocation knobs beyond Rule 17's paths: `ORCA_SERVICE_MANAGER` (`launchd|systemd|detached`) and `ORCA_SERVICE_CHECKOUT` (the checkout whose `dist/cli.js` is installed; default: the running checkout).
- D16. The Linux real smoke is not in this round: no Linux host, and `systemctl --user enable` writes a `default.target.wants` link into the real `~/.config/systemd/user`. Linux behaviour is pinned by generator snapshots and fake-tool sequences only; a real Linux smoke is an open item.
- D17. `orca panel install --dry-run <args>` prints every file it would write and runs no tool, so the person can compare it to their launcher before anything touches launchd.
- D18. The systemd preflight (XDG_RUNTIME_DIR, DBus, linger) runs before every `systemctl --user` command (§4 "before any").
- D19. `uninstall` removes exactly what §4 lists (plist or unit, and `run.sh` on macOS); `service.json`, `service.env` and logs stay.
- D20. Restart re-renders `service.env` and `run.sh` from `service.json` before asking the manager, so an Orca upgrade that changes the renderer takes effect on restart.
```

- [ ] **Step 2: Commit** — `git add docs/superpowers/specs/2026-10-07-panel-service-design.md`; message `docs(spec): record the panel service plan-time decisions`.

---

### Task 1: A node build of the CLI (`dist/cli.js`)

**Files:**
- Create: `tsconfig.build.json`
- Modify: `package.json` (`scripts.build`, `scripts.verify`)
- Test: `tests/service/build.test.ts`

**Interfaces:**
- Produces: `npm run build` → `dist/cli.js` (+ `dist/<dir>/<file>.js` mirroring `src/`). Later tasks: `checkDist` (Task 3) refuses a missing/stale `dist/cli.js`; the gate (Task 13) boots `node dist/cli.js panel run --service`.

- [ ] **Step 1: Write the failing test** `tests/service/build.test.ts`:

```ts
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

describe("the service runs a node build, never tsx (spec §3, plan D4)", () => {
  it("compiles src alone, so src/cli.ts lands at dist/cli.js and every module keeps ../.. as the checkout root", async () => {
    const config = JSON.parse(await readFile("tsconfig.build.json", "utf8")) as { compilerOptions: Record<string, unknown>; include: string[] };
    expect(config.compilerOptions.rootDir).toBe("src");
    expect(config.compilerOptions.outDir).toBe("dist");
    expect(config.include).toEqual(["src/**/*.ts"]);
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts.verify).toContain("npm run build");
  });

  it("the compiled CLI runs under plain node and boots a panel that exits 0 on SIGTERM", async () => {
    const out = await mkdtemp(join(tmpdir(), "bd-"));
    roots.push(out);
    const tsc = spawnSync(join("node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", join(out, "dist")], { encoding: "utf8" });
    expect(tsc.status, `${tsc.stdout}${tsc.stderr}`).toBe(0);
    // The checkout's package.json makes .js ESM, and its node_modules resolves express; give the copy both.
    await writeFile(join(out, "package.json"), JSON.stringify({ type: "module" }));
    await symlink(join(process.cwd(), "node_modules"), join(out, "node_modules"));
    const usage = spawnSync(process.execPath, [join(out, "dist", "cli.js")], { encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("orca panel");

    const dist = join(out, "web-dist");
    await mkdir(dist);
    await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
    const repo = join(out, "repo");
    await mkdir(repo);
    const child = spawn(process.execPath, [join(out, "dist", "cli.js"), "panel", "--by", "t", "--repo", `p=${repo}`, "--port", "0", "--dist", dist], {
      env: { ...process.env, ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ORCA_CONTROL_DIR: join(out, "c"), ORCA_CORRECTIONS_DIR: join(out, "k") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => { if (stdout.includes("orca-panel ready url=")) { clearInterval(timer); resolve(); } }, 50);
        setTimeout(() => { clearInterval(timer); reject(new Error(`no ready line in 30s; stderr: ${stderr}`)); }, 30_000);
        void exited.then((code) => { clearInterval(timer); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
      });
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    } finally { if (child.exitCode === null) child.kill("SIGKILL"); }
  }, 120_000);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/build.test.ts > $SCRATCH/t1.txt 2>&1; echo rc=$? >> $SCRATCH/t1.txt` and read the file whole. Expected: FAIL — `tsconfig.build.json` ENOENT (first test) and tsc exit non-zero (second).

- [ ] **Step 3: Implement.** Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

In `package.json` `scripts`, add `"build": "tsc -p tsconfig.build.json",` after `"typecheck"`, and in `verify` insert `npm run build && ` immediately after `npm run typecheck && `. (`dist/` is already in `.gitignore`.) Probe measured at plan time (commit 53697dd, `tsc -p` of this exact config in a `git clone --local`): rc 0, and `node dist/cli.js` printed USAGE with rc 1.

- [ ] **Step 4: Run** the test file into a file as in Step 2 → PASS (2 tests). Then `npm run build > $SCRATCH/t1b.txt 2>&1; echo rc=$?` → 0, and `npm run typecheck > $SCRATCH/t1tc.txt 2>&1; echo rc=$?` → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t1`).** (a) `rootDir` → `"."` → first test red (`expected "." to be "src"`); (b) delete the `build` script → first test red; (c) remove `npm run build && ` from `verify` → first test red. Restore; record in the ledger.

- [ ] **Step 6: Commit** `build: compile the CLI to dist/cli.js for the panel service` (`git add tsconfig.build.json package.json tests/service/build.test.ts`).

---

### Task 2: Service paths and the relocation guard

**Files:**
- Create: `src/service/rejection.ts`, `src/service/paths.ts`
- Modify: `tests/setup/relocateUserData.ts`
- Test: `tests/service/paths.test.ts`

**Interfaces:**
- Produces:
  - `class ServiceRejection extends Error { constructor(readonly code: string, message: string) }`
  - `DEFAULT_SERVICE_LABEL = "dev.orca.panel"`, `DEFAULT_SERVICE_UNIT = "orca-panel"`
  - `interface ServicePaths { label; unit; panelDir; logsDir; configFile; envFile; runScript; lockFile; panelJson; outLog; errLog; plistFile; unitFile }` (all `string`)
  - `panelDir(env: NodeJS.ProcessEnv): string`, `servicePaths(env: NodeJS.ProcessEnv): ServicePaths`

- [ ] **Step 1: Write the failing test** `tests/service/paths.test.ts`:

```ts
import { homedir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVICE_LABEL, servicePaths } from "../../src/service/paths.js";

afterEach(() => { vi.unstubAllEnvs(); });

describe("service paths (spec §2, §3; Rule 17)", () => {
  it("defaults to the documented locations under HOME", () => {
    vi.stubEnv("HOME", "/home/ann");
    expect(homedir()).toBe("/home/ann");
    const p = servicePaths({});
    expect(p).toEqual({
      label: "dev.orca.panel", unit: "orca-panel",
      panelDir: "/home/ann/.orca/panel", logsDir: "/home/ann/.orca/panel/logs",
      configFile: "/home/ann/.orca/panel/service.json", envFile: "/home/ann/.orca/panel/service.env",
      runScript: "/home/ann/.orca/panel/run.sh", lockFile: "/home/ann/.orca/panel/panel.lock",
      panelJson: "/home/ann/.orca/panel/panel.json",
      outLog: "/home/ann/.orca/panel/logs/panel.out.log", errLog: "/home/ann/.orca/panel/logs/panel.err.log",
      plistFile: "/home/ann/Library/LaunchAgents/dev.orca.panel.plist",
      unitFile: "/home/ann/.config/systemd/user/orca-panel.service",
    });
    expect(servicePaths({ XDG_CONFIG_HOME: "/x" }).unitFile).toBe("/x/systemd/user/orca-panel.service");
  });

  it("relocates every path a criterion could otherwise write into a real home", () => {
    const p = servicePaths({ ORCA_PANEL_DIR: "/t/p", ORCA_LAUNCH_AGENTS_DIR: "/t/la", ORCA_SYSTEMD_USER_DIR: "/t/su", ORCA_SERVICE_LABEL: "dev.orca.panel.x", ORCA_SERVICE_UNIT: "orca-x" });
    expect([p.panelDir, p.plistFile, p.unitFile, p.label, p.unit]).toEqual(["/t/p", "/t/la/dev.orca.panel.x.plist", "/t/su/orca-x.service", "dev.orca.panel.x", "orca-x"]);
  });

  it("refuses a label or unit name that would escape its directory", () => {
    expect(() => servicePaths({ ORCA_SERVICE_LABEL: "../evil" })).toThrow(expect.objectContaining({ code: "service-name-invalid" }));
    expect(() => servicePaths({ ORCA_SERVICE_UNIT: "a/b" })).toThrow(expect.objectContaining({ code: "service-name-invalid" }));
  });

  it("every test process runs with the service relocated away from the real home (setup file)", () => {
    const p = servicePaths(process.env);
    expect(p.label).not.toBe(DEFAULT_SERVICE_LABEL);
    for (const path of [p.panelDir, p.plistFile, p.unitFile]) expect(path.startsWith(homedir())).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/paths.test.ts > $SCRATCH/t2.txt 2>&1; echo rc=$? >> $SCRATCH/t2.txt`; read whole. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/service/rejection.ts`:

```ts
/** Panel service spec: a named refusal. The CLI prints `rejected: <code>: <message>` and exits 1. */
export class ServiceRejection extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ServiceRejection";
  }
}
```

`src/service/paths.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { ServiceRejection } from "./rejection.js";

export const DEFAULT_SERVICE_LABEL = "dev.orca.panel";
export const DEFAULT_SERVICE_UNIT = "orca-panel";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ServicePaths {
  label: string; unit: string;
  panelDir: string; logsDir: string;
  configFile: string; envFile: string; runScript: string;
  lockFile: string; panelJson: string;
  outLog: string; errLog: string;
  plistFile: string; unitFile: string;
}

const given = (value: string | undefined): string | undefined => (value !== undefined && value.length > 0 ? value : undefined);

/** Spec §3/§5: ~/.orca/panel, relocated by ORCA_PANEL_DIR (Rule 17). Computed per call; never frozen at import. */
export function panelDir(env: NodeJS.ProcessEnv): string {
  return given(env.ORCA_PANEL_DIR) ?? join(homedir(), ".orca", "panel");
}

export function servicePaths(env: NodeJS.ProcessEnv): ServicePaths {
  const label = given(env.ORCA_SERVICE_LABEL) ?? DEFAULT_SERVICE_LABEL;
  const unit = given(env.ORCA_SERVICE_UNIT) ?? DEFAULT_SERVICE_UNIT;
  for (const [name, value] of [["ORCA_SERVICE_LABEL", label], ["ORCA_SERVICE_UNIT", unit]] as const) {
    if (!NAME.test(value)) throw new ServiceRejection("service-name-invalid", `${name} ${JSON.stringify(value)} must match ${NAME}`);
  }
  const dir = panelDir(env);
  const logsDir = join(dir, "logs");
  const agents = given(env.ORCA_LAUNCH_AGENTS_DIR) ?? join(homedir(), "Library", "LaunchAgents");
  const units = given(env.ORCA_SYSTEMD_USER_DIR) ?? join(given(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), "systemd", "user");
  return {
    label, unit, panelDir: dir, logsDir,
    configFile: join(dir, "service.json"), envFile: join(dir, "service.env"), runScript: join(dir, "run.sh"),
    lockFile: join(dir, "panel.lock"), panelJson: join(dir, "panel.json"),
    outLog: join(logsDir, "panel.out.log"), errLog: join(logsDir, "panel.err.log"),
    plistFile: join(agents, `${label}.plist`), unitFile: join(units, `${unit}.service`),
  };
}
```

- [ ] **Step 4: Relocation guard.** In `tests/setup/relocateUserData.ts`, after the `ORCA_PROJECTS_FILE` line, add:

```ts
// Panel service plan Task 2: the service's own paths, for the same reason. A criterion that forgets lands here.
process.env.ORCA_PANEL_DIR = join(relocated, "panel");
process.env.ORCA_LAUNCH_AGENTS_DIR = join(relocated, "LaunchAgents");
process.env.ORCA_SYSTEMD_USER_DIR = join(relocated, "systemd-user");
process.env.ORCA_SERVICE_LABEL = "dev.orca.panel.test";
process.env.ORCA_SERVICE_UNIT = "orca-panel-test";
```

and extend the snapshot so a criterion that reaches the person's real service definition goes red by name: add

```ts
/** The real plist and unit, by stat: their absence or bytes must not change during a test file. */
function realServiceDefinitions(): string[] {
  return [join(homedir(), "Library", "LaunchAgents", "dev.orca.panel.plist"), join(homedir(), ".config", "systemd", "user", "orca-panel.service")]
    .map((path) => { try { const s = statSync(path); return `${path}:${s.size}:${s.mtimeMs}`; } catch { return `${path}:absent`; } });
}
const definitionsBefore = realServiceDefinitions();
```

and inside the existing `afterAll`, after the `~/.orca` expectation: `expect(realServiceDefinitions(), "this test file touched the real service definition (CLAUDE.md Rule 17)").toEqual(definitionsBefore);`

- [ ] **Step 5: Run** the test file → PASS (4). Then `npx vitest run tests/entry tests/panel/usage.test.ts > $SCRATCH/t2b.txt 2>&1; echo rc=$?` → 0 (the new variables change nothing yet).

- [ ] **Step 6: Mutations (clone `$SCRATCH/mut-t2`).** (a) delete `given(env.ORCA_PANEL_DIR) ??` → relocation test red; (b) delete the `ORCA_SERVICE_LABEL` line from the setup file → "every test process" test red; (c) delete the `NAME.test` check → refusal test red.

- [ ] **Step 7: Commit** `feat(service): name every panel service path, relocatable by env`.

---

### Task 3: What the service carries (`service.json`)

**Files:**
- Create: `src/service/config.ts`
- Test: `tests/service/config.test.ts`

**Interfaces:**
- Consumes: `ServiceRejection` (Task 2); `parsePanelArgs`, `panelArgsWithDefaultProjects` (`src/panel/server.ts`); `PanelRejection` (`src/panel/rejection.ts`).
- Produces:
  - `CAPTURED_ENV: readonly string[]` = `ORCA_AGENTS_TABLE, ORCA_CCMEM_BIN, ORCA_SYNCSKILL_BIN, ORCA_CCLOOP_BIN, ORCA_CONTROL_DIR, SYNCSKILL_DIR, CCMEM_DATA_ROOT, ORCA_CORRECTIONS_DIR, ORCA_PROJECTS_FILE`
  - `SYSTEM_PATH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]`
  - `interface ServiceConfigV1 { schema: "orca-panel-service-v1"; node: string; entry: string; args: string[]; env: Record<string, string> }` (`env` keys sorted)
  - `interface ServiceConfigInput { args: string[]; env: NodeJS.ProcessEnv; execPath: string; checkout: string; home: string; panelDir: string; isDirectory?: (path: string) => boolean }`
  - `buildServiceConfig(input: ServiceConfigInput): { config: ServiceConfigV1; warnings: string[] }`
  - `checkDist(checkout: string): string` (returns the absolute entry)

- [ ] **Step 1: Write the failing test** `tests/service/config.test.ts`:

```ts
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServiceConfig, checkDist } from "../../src/service/config.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

/** A checkout whose dist/cli.js is newer than every src file. */
async function checkout(opts: { dist?: boolean; srcNewer?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "sc-"));
  roots.push(root);
  await mkdir(join(root, "src", "panel"), { recursive: true });
  await writeFile(join(root, "src", "panel", "a.ts"), "export {};\n");
  await utimes(join(root, "src", "panel", "a.ts"), new Date("2026-01-01"), new Date("2026-01-01"));
  if (opts.dist !== false) {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "cli.js"), "\n");
    await utimes(join(root, "dist", "cli.js"), new Date("2026-02-01"), new Date("2026-02-01"));
  }
  if (opts.srcNewer === true) await utimes(join(root, "src", "panel", "a.ts"), new Date("2026-03-01"), new Date("2026-03-01"));
  return root;
}

// The human's launcher, ~/.orca/panel.sh as written 2026-10-03, with $HOME expanded as the shell would.
const PANEL_SH_ARGS = ["--by", "biran", "--port", "7777", "--repo", "orca=/Users/biran/code/orca/orca-web",
  "--profile", "/Users/biran/.orca/profile.json", "--estimator-profile", "all", "--estimate-mode", "soft"];
const PANEL_SH_ENV = {
  ORCA_AGENTS_TABLE: "/Users/biran/.orca/agents.json",
  ORCA_CCMEM_BIN: "/usr/local/bin/ccmem",
  ORCA_SYNCSKILL_BIN: "/Users/biran/.nvm/versions/node/v22.13.1/bin/syncskill",
};
const NVM_NODE = "/Users/biran/.nvm/versions/node/v22.13.1/bin/node";

const input = async (over: Partial<Parameters<typeof buildServiceConfig>[0]> = {}) => ({
  args: PANEL_SH_ARGS, env: { ...PANEL_SH_ENV, SHELL: "/bin/zsh", ORCA_UNRELATED: "x", EDITOR: "vim" },
  execPath: NVM_NODE, checkout: await checkout(), home: "/Users/biran", panelDir: "/Users/biran/.orca/panel",
  isDirectory: () => true, ...over,
});

describe("service.json (spec §3)", () => {
  it("reproduces the human's launcher one-to-one: same panel args, only the named variables, plus HOME/PATH/NODE_OPTIONS", async () => {
    const i = await input();
    const { config } = buildServiceConfig(i);
    expect(config).toEqual({
      schema: "orca-panel-service-v1",
      node: NVM_NODE,
      entry: join(i.checkout, "dist", "cli.js"),
      args: PANEL_SH_ARGS,
      env: {
        HOME: "/Users/biran", NODE_OPTIONS: "",
        ORCA_AGENTS_TABLE: "/Users/biran/.orca/agents.json", ORCA_CCMEM_BIN: "/usr/local/bin/ccmem",
        ORCA_PANEL_DIR: "/Users/biran/.orca/panel",
        ORCA_SYNCSKILL_BIN: "/Users/biran/.nvm/versions/node/v22.13.1/bin/syncskill",
        PATH: "/Users/biran/.nvm/versions/node/v22.13.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });
    expect(Object.keys(config.env)).toEqual([...Object.keys(config.env)].sort());
  });

  it("puts only existing directories on PATH, node's own first", async () => {
    const { config } = buildServiceConfig(await input({ execPath: "/usr/local/bin/node", isDirectory: (p) => p !== "/opt/homebrew/bin" }));
    expect(config.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("warns when node lives under a version manager, and not otherwise", async () => {
    expect(buildServiceConfig(await input()).warnings.join("\n")).toContain("version manager");
    expect(buildServiceConfig(await input({ execPath: "/usr/local/bin/node" })).warnings).toEqual([]);
  });

  it("captures the relocation variables (plan D3) when the installing shell sets them", async () => {
    const { config } = buildServiceConfig(await input({ env: { ...PANEL_SH_ENV, ORCA_CONTROL_DIR: "/t/c", ORCA_CORRECTIONS_DIR: "/t/k", ORCA_PROJECTS_FILE: "/t/p.json" } }));
    expect([config.env.ORCA_CONTROL_DIR, config.env.ORCA_CORRECTIONS_DIR, config.env.ORCA_PROJECTS_FILE]).toEqual(["/t/c", "/t/k", "/t/p.json"]);
  });

  it("refuses a relative path in a panel flag or a captured variable (plan D6)", async () => {
    const flag = await input({ args: ["--by", "a", "--repo", "x=rel/repo"] });
    expect(() => buildServiceConfig(flag)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
    const variable = await input({ env: { ...PANEL_SH_ENV, ORCA_AGENTS_TABLE: "agents.json" } });
    expect(() => buildServiceConfig(variable)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
  });

  it("refuses arguments the panel itself would refuse, before writing anything (plan D7)", async () => {
    const i = await input({ args: ["--port", "7777"] });
    expect(() => buildServiceConfig(i)).toThrow(expect.objectContaining({ code: "service-panel-args-invalid" }));
    const reserved = await input({ args: [...PANEL_SH_ARGS, "--service"] });
    expect(() => buildServiceConfig(reserved)).toThrow(expect.objectContaining({ code: "service-argument-reserved" }));
  });

  it("refuses a missing or stale dist (spec §3)", async () => {
    expect(() => checkDist(await checkout({ dist: false }))).toThrow(expect.objectContaining({ code: "service-dist-missing" }));
    expect(() => checkDist(await checkout({ srcNewer: true }))).toThrow(expect.objectContaining({ code: "service-dist-stale" }));
    const fresh = await checkout();
    expect(checkDist(fresh)).toBe(join(fresh, "dist", "cli.js"));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/config.test.ts > $SCRATCH/t3.txt 2>&1; echo rc=$? >> $SCRATCH/t3.txt`; read whole. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/service/config.ts`:

```ts
import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { PanelRejection } from "../panel/rejection.js";
import { panelArgsWithDefaultProjects, parsePanelArgs } from "../panel/server.js";
import { ServiceRejection } from "./rejection.js";

/** Spec §3 plus plan D3: the only variables taken from the installing shell. Every one of them is a path. */
export const CAPTURED_ENV = [
  "ORCA_AGENTS_TABLE", "ORCA_CCMEM_BIN", "ORCA_SYNCSKILL_BIN", "ORCA_CCLOOP_BIN", "ORCA_CONTROL_DIR",
  "SYNCSKILL_DIR", "CCMEM_DATA_ROOT", "ORCA_CORRECTIONS_DIR", "ORCA_PROJECTS_FILE",
] as const;
export const SYSTEM_PATH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
export const SERVICE_CONFIG_SCHEMA = "orca-panel-service-v1";

export interface ServiceConfigV1 { schema: typeof SERVICE_CONFIG_SCHEMA; node: string; entry: string; args: string[]; env: Record<string, string> }
export interface ServiceConfigInput {
  args: string[]; env: NodeJS.ProcessEnv; execPath: string; checkout: string; home: string; panelDir: string;
  isDirectory?: (path: string) => boolean;
}

/** Plan D6: flags whose value is (or ends in) a path. */
const PATH_FLAGS = new Set(["--repo", "--root", "--profile", "--projects-file", "--control-state-dir", "--dist", "--plan"]);
const pathOf = (flag: string, value: string): string =>
  flag === "--repo" ? value.slice(value.indexOf("=") + 1) : flag === "--plan" ? value.split("=").slice(2).join("=") : value;
const VERSION_MANAGER = /\/(\.nvm|\.fnm|fnm|\.volta|\.asdf)\//;

const defaultIsDirectory = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };

export function buildServiceConfig(input: ServiceConfigInput): { config: ServiceConfigV1; warnings: string[] } {
  const { args } = input;
  if (args.includes("--service")) throw new ServiceRejection("service-argument-reserved", "--service is added by the service itself; leave it out");
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i + 1];
    if (PATH_FLAGS.has(args[i]!) && value !== undefined && !isAbsolute(pathOf(args[i]!, value))) {
      throw new ServiceRejection("service-path-not-absolute", `${args[i]} ${value}: the service does not run in this shell's directory; give an absolute path`);
    }
  }
  if (!isAbsolute(input.panelDir)) throw new ServiceRejection("service-path-not-absolute", `ORCA_PANEL_DIR=${input.panelDir}: give an absolute path`);
  // Plan D7: the panel's own parser, so install refuses exactly what the service would refuse at every start.
  try { parsePanelArgs(panelArgsWithDefaultProjects(args, input.env), input.env); }
  catch (error) {
    if (error instanceof PanelRejection) throw new ServiceRejection("service-panel-args-invalid", `${error.code}: ${error.message}`);
    throw error;
  }
  const env: Record<string, string> = {};
  for (const name of CAPTURED_ENV) {
    const value = input.env[name];
    if (value === undefined || value === "") continue;
    if (!isAbsolute(value)) throw new ServiceRejection("service-path-not-absolute", `${name}=${value}: the service does not run in this shell's directory; give an absolute path`);
    env[name] = value;
  }
  const isDirectory = input.isDirectory ?? defaultIsDirectory;
  const pathDirs = [dirname(input.execPath), ...SYSTEM_PATH_DIRS].filter((dir, index, all) => all.indexOf(dir) === index && isDirectory(dir));
  env.HOME = input.home;
  env.PATH = pathDirs.join(":");
  env.NODE_OPTIONS = "";
  env.ORCA_PANEL_DIR = input.panelDir;
  const sorted = Object.fromEntries(Object.keys(env).sort().map((key) => [key, env[key]!]));
  const entry = checkDist(input.checkout);
  const warnings = VERSION_MANAGER.test(input.execPath)
    ? [`node ${input.execPath} is managed by a version manager; uninstalling that version stops the service. Re-run orca panel install after changing node.`]
    : [];
  return { config: { schema: SERVICE_CONFIG_SCHEMA, node: input.execPath, entry, args: [...args], env: sorted }, warnings };
}

/** Spec §3: the service runs the built dist/cli.js; a missing or stale build is refused by name. */
export function checkDist(checkout: string): string {
  const entry = join(checkout, "dist", "cli.js");
  let built: number;
  try { built = statSync(entry).mtimeMs; }
  catch { throw new ServiceRejection("service-dist-missing", `${entry} does not exist; run npm run build in ${checkout}`); }
  for (const item of readdirSync(join(checkout, "src"), { withFileTypes: true, recursive: true })) {
    if (!item.isFile() || !item.name.endsWith(".ts")) continue;
    const file = join(item.parentPath, item.name);
    if (statSync(file).mtimeMs > built) throw new ServiceRejection("service-dist-stale", `${file} is newer than ${entry}; run npm run build in ${checkout}`);
  }
  return entry;
}
```

- [ ] **Step 4: Run** the test file → PASS (7). `npm run typecheck > $SCRATCH/t3tc.txt 2>&1; echo rc=$?` → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t3`).** (a) delete the `continue` guard and the capture loop's `isAbsolute` check → relative-variable test red; (b) replace `CAPTURED_ENV` iteration with `Object.keys(input.env)` → one-to-one test red (ORCA_UNRELATED/SHELL/EDITOR appear); (c) delete the `parsePanelArgs` try block → panel-args test red; (d) delete the stale-src loop → stale test red; (e) delete the `.filter(… isDirectory(dir))` → PATH test red; (f) delete the `VERSION_MANAGER` warning → warning test red.

- [ ] **Step 6: Commit** `feat(service): record the panel's args and named environment in service.json`.

---

### Task 4: Pure generators (`service.env`, `run.sh`, plist, unit)

**Files:**
- Create: `src/service/render.ts`
- Test: `tests/service/render.test.ts`

**Interfaces:**
- Consumes: `ServiceConfigV1` (Task 3), `ServicePaths`, `servicePaths` (Task 2), `ServiceRejection`.
- Produces: `shQuote(v)`, `systemdQuote(v)`, `xmlEscape(v)`, `serviceCommand(config): string[]` (`[node, entry, "panel", "run", "--service", ...args]`), `renderServiceEnv(config)`, `renderRunSh(config, paths)`, `renderPlist(paths)`, `renderUnit(config, paths)` — all `string`, all pure.

- [ ] **Step 1: Write the failing test** `tests/service/render.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServiceConfigV1 } from "../../src/service/config.js";
import { servicePaths } from "../../src/service/paths.js";
import { renderPlist, renderRunSh, renderServiceEnv, renderUnit, shQuote, systemdQuote, xmlEscape } from "../../src/service/render.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const paths = servicePaths({
  ORCA_PANEL_DIR: "/home/ann/.orca/panel", ORCA_LAUNCH_AGENTS_DIR: "/home/ann/Library/LaunchAgents",
  ORCA_SYSTEMD_USER_DIR: "/home/ann/.config/systemd/user", ORCA_SERVICE_LABEL: "dev.orca.panel", ORCA_SERVICE_UNIT: "orca-panel",
});
const config: ServiceConfigV1 = {
  schema: "orca-panel-service-v1", node: "/opt/node/bin/node", entry: "/src/orca/dist/cli.js",
  args: ["--by", "ann", "--port", "7777", "--repo", "orca=/src/orca-web"],
  env: { HOME: "/home/ann", NODE_OPTIONS: "", ORCA_AGENTS_TABLE: "/home/ann/.orca/agents.json", ORCA_PANEL_DIR: "/home/ann/.orca/panel", PATH: "/opt/node/bin:/usr/bin:/bin" },
};
const lines = (...l: string[]) => `${l.join("\n")}\n`;
const HEADER = "# Generated by orca panel install. Re-run it instead of editing this file.";

describe("generated files (spec §3, §4)", () => {
  it("service.env: sorted KEY=\"value\" lines, no secrets anywhere else", () => {
    expect(renderServiceEnv(config)).toBe(lines(HEADER, 'HOME="/home/ann"', 'NODE_OPTIONS=""', 'ORCA_AGENTS_TABLE="/home/ann/.orca/agents.json"',
      'ORCA_PANEL_DIR="/home/ann/.orca/panel"', 'PATH="/opt/node/bin:/usr/bin:/bin"'));
  });

  it("run.sh sources service.env and execs node on dist/cli.js panel run --service", () => {
    expect(renderRunSh(config, paths)).toBe(lines("#!/bin/sh", HEADER, "set -a", ". '/home/ann/.orca/panel/service.env'", "set +a",
      "exec '/opt/node/bin/node' '/src/orca/dist/cli.js' 'panel' 'run' '--service' '--by' 'ann' '--port' '7777' '--repo' 'orca=/src/orca-web'"));
  });

  it("plist: the keys of spec §4, running /bin/sh run.sh, with no environment inline", () => {
    const plist = renderPlist(paths);
    expect(plist).toBe(lines(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">', "<dict>",
      "  <key>Label</key>", "  <string>dev.orca.panel</string>",
      "  <key>ProgramArguments</key>", "  <array>", "    <string>/bin/sh</string>", "    <string>/home/ann/.orca/panel/run.sh</string>", "  </array>",
      "  <key>RunAtLoad</key>", "  <true/>",
      "  <key>KeepAlive</key>", "  <dict>", "    <key>SuccessfulExit</key>", "    <false/>", "  </dict>",
      "  <key>ThrottleInterval</key>", "  <integer>10</integer>",
      "  <key>ExitTimeOut</key>", "  <integer>20</integer>",
      "  <key>ProcessType</key>", "  <string>Interactive</string>",
      "  <key>StandardInPath</key>", "  <string>/dev/null</string>",
      "  <key>StandardOutPath</key>", "  <string>/home/ann/.orca/panel/logs/panel.out.log</string>",
      "  <key>StandardErrorPath</key>", "  <string>/home/ann/.orca/panel/logs/panel.err.log</string>",
      "  <key>WorkingDirectory</key>", "  <string>/home/ann/.orca/panel</string>",
      "  <key>SoftResourceLimits</key>", "  <dict>", "    <key>NumberOfFiles</key>", "    <integer>4096</integer>", "  </dict>",
      "</dict>", "</plist>"));
    expect(plist).not.toContain("agents.json");
  });

  it("unit: spec §4 keys, Restart=on-failure (plan D1), absolute EnvironmentFile (plan D5)", () => {
    expect(renderUnit(config, paths)).toBe(lines(HEADER, "[Unit]", "Description=Orca panel", "After=network-online.target", "Wants=network-online.target",
      "StartLimitBurst=10", "StartLimitIntervalSec=300", "",
      "[Service]", "Type=simple",
      'ExecStart="/opt/node/bin/node" "/src/orca/dist/cli.js" "panel" "run" "--service" "--by" "ann" "--port" "7777" "--repo" "orca=/src/orca-web"',
      "EnvironmentFile=/home/ann/.orca/panel/service.env", "WorkingDirectory=/home/ann/.orca/panel",
      "Restart=on-failure", "RestartSec=5", "RestartPreventExitStatus=78", "SuccessExitStatus=0 143", "KillMode=mixed", "TimeoutStopSec=30", "LimitNOFILE=4096", "",
      "[Install]", "WantedBy=default.target"));
  });

  it("escapes per format and refuses line breaks everywhere", () => {
    expect(systemdQuote('50% "a" $HOME \\x')).toBe('"50%% \\"a\\" $$HOME \\\\x"');
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(xmlEscape(`a&<b>"'`)).toBe("a&amp;&lt;b&gt;&quot;&apos;");
    const broken = { ...config, args: ["--by", "a\nb"] };
    for (const render of [() => renderUnit(broken, paths), () => renderRunSh(broken, paths)]) expect(render).toThrow(expect.objectContaining({ code: "service-value-newline" }));
    expect(() => renderPlist(servicePaths({ ORCA_PANEL_DIR: "/t/a\rb" }))).toThrow(expect.objectContaining({ code: "service-value-newline" }));
    for (const bad of ['a"b', "a\\b", "a$b", "a`b", "a\nb"]) {
      expect(() => renderServiceEnv({ ...config, env: { X: bad } })).toThrow(expect.objectContaining({ code: "service-env-value-unsupported" }));
    }
  });

  it("/bin/sh reads service.env and run.sh back exactly (spaces, quotes, % and # survive)", async () => {
    const root = await mkdtemp(join(tmpdir(), "rd-"));
    roots.push(root);
    const p = servicePaths({ ORCA_PANEL_DIR: root });
    const echo = join(root, "echo.mjs");
    await writeFile(echo, "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), x: process.env.X }));\n");
    const c: ServiceConfigV1 = { ...config, node: process.execPath, entry: echo, args: ["--by", "it's me", "--repo", "k=/a b/%c#d"], env: { X: "a b 'c' %d #e" } };
    await writeFile(p.envFile, renderServiceEnv(c));
    await writeFile(p.runScript, renderRunSh(c, p));
    const run = spawnSync("/bin/sh", [p.runScript], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ argv: ["panel", "run", "--service", "--by", "it's me", "--repo", "k=/a b/%c#d"], x: "a b 'c' %d #e" });
  });

  it("the plist is valid for launchd's parser (macOS only; plutil is not launchctl)", async (ctx) => {
    if (process.platform !== "darwin") ctx.skip();
    const root = await mkdtemp(join(tmpdir(), "rp-"));
    roots.push(root);
    await writeFile(join(root, "x.plist"), renderPlist(paths));
    const lint = spawnSync("/usr/bin/plutil", ["-lint", join(root, "x.plist")], { encoding: "utf8" });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/render.test.ts > $SCRATCH/t4.txt 2>&1; echo rc=$? >> $SCRATCH/t4.txt`; read whole. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/service/render.ts`:

```ts
import type { ServiceConfigV1 } from "./config.js";
import type { ServicePaths } from "./paths.js";
import { ServiceRejection } from "./rejection.js";

const HEADER = "# Generated by orca panel install. Re-run it instead of editing this file.";

function noBreaks(what: string, value: string): string {
  if (/[\r\n\0]/.test(value)) throw new ServiceRejection("service-value-newline", `${what} contains a line break or NUL: ${JSON.stringify(value)}`);
  return value;
}

/** A /bin/sh word: single-quoted, ' written as '\''. */
export function shQuote(value: string): string {
  return `'${noBreaks("a run.sh word", value).replaceAll("'", "'\\''")}'`;
}

/** A systemd ExecStart word: double-quoted; \ and " backslashed, % → %%, $ → $$. */
export function systemdQuote(value: string): string {
  const escaped = noBreaks("a unit value", value).replace(/[\\"%$]/g, (c) => (c === "%" ? "%%" : c === "$" ? "$$" : `\\${c}`));
  return `"${escaped}"`;
}
const systemdPlain = (value: string): string => noBreaks("a unit value", value).replaceAll("%", "%%");

const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export function xmlEscape(value: string): string {
  return noBreaks("a plist string", value).replace(/[&<>"']/g, (c) => XML[c]!);
}

export function serviceCommand(config: ServiceConfigV1): string[] {
  return [config.node, config.entry, "panel", "run", "--service", ...config.args];
}

/** Plan D8: one format both /bin/sh and systemd EnvironmentFile= read the same way. */
export function renderServiceEnv(config: ServiceConfigV1): string {
  const out = [HEADER];
  for (const [key, value] of Object.entries(config.env)) {
    if (/["\\$`\r\n\0]/.test(value)) {
      throw new ServiceRejection("service-env-value-unsupported", `${key}: service.env is read by both /bin/sh and systemd, so a value cannot contain " \\ $ \` or a line break`);
    }
    out.push(`${key}="${value}"`);
  }
  return `${out.join("\n")}\n`;
}

export function renderRunSh(config: ServiceConfigV1, paths: ServicePaths): string {
  return `${["#!/bin/sh", HEADER, "set -a", `. ${shQuote(paths.envFile)}`, "set +a", `exec ${serviceCommand(config).map(shQuote).join(" ")}`].join("\n")}\n`;
}

/** Spec §4's keys. Depends on paths only: environment and arguments stay in service.env and run.sh (openclaw's layout). */
export function renderPlist(paths: ServicePaths): string {
  const s = (value: string): string => `<string>${xmlEscape(value)}</string>`;
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">', "<dict>",
    "  <key>Label</key>", `  ${s(paths.label)}`,
    "  <key>ProgramArguments</key>", "  <array>", `    ${s("/bin/sh")}`, `    ${s(paths.runScript)}`, "  </array>",
    "  <key>RunAtLoad</key>", "  <true/>",
    "  <key>KeepAlive</key>", "  <dict>", "    <key>SuccessfulExit</key>", "    <false/>", "  </dict>",
    "  <key>ThrottleInterval</key>", "  <integer>10</integer>",
    "  <key>ExitTimeOut</key>", "  <integer>20</integer>",
    "  <key>ProcessType</key>", `  ${s("Interactive")}`,
    "  <key>StandardInPath</key>", `  ${s("/dev/null")}`,
    "  <key>StandardOutPath</key>", `  ${s(paths.outLog)}`,
    "  <key>StandardErrorPath</key>", `  ${s(paths.errLog)}`,
    "  <key>WorkingDirectory</key>", `  ${s(paths.panelDir)}`,
    "  <key>SoftResourceLimits</key>", "  <dict>", "    <key>NumberOfFiles</key>", "    <integer>4096</integer>", "  </dict>",
    "</dict>", "</plist>",
  ].join("\n")}\n`;
}

/** Spec §4's unit, with plan D1 (Restart=on-failure) and D5 (absolute paths). */
export function renderUnit(config: ServiceConfigV1, paths: ServicePaths): string {
  return `${[
    HEADER, "[Unit]", "Description=Orca panel", "After=network-online.target", "Wants=network-online.target",
    "StartLimitBurst=10", "StartLimitIntervalSec=300", "",
    "[Service]", "Type=simple",
    `ExecStart=${serviceCommand(config).map(systemdQuote).join(" ")}`,
    `EnvironmentFile=${systemdPlain(paths.envFile)}`,
    `WorkingDirectory=${systemdPlain(paths.panelDir)}`,
    "Restart=on-failure", "RestartSec=5", "RestartPreventExitStatus=78", "SuccessExitStatus=0 143",
    "KillMode=mixed", "TimeoutStopSec=30", "LimitNOFILE=4096", "",
    "[Install]", "WantedBy=default.target",
  ].join("\n")}\n`;
}
```

- [ ] **Step 4: Run** the test file → PASS (7, the plutil one runs on macOS). Typecheck → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t4`).** (a) `Restart=on-failure` → `Restart=always` → unit test red; (b) drop `c === "%" ? "%%" :` → escape test red; (c) delete `.replaceAll("'", "'\\''")` → sh round-trip red; (d) delete the `service-env-value-unsupported` throw → escape test red; (e) delete `noBreaks` call in `xmlEscape` → plist newline expectation red; (f) delete the `SoftResourceLimits` lines → plist test red.

- [ ] **Step 6: Commit** `feat(service): generate service.env, run.sh, the plist and the unit`.

---

### Task 5: Files on disk, the tool runner, and the fake tools

**Files:**
- Create: `src/service/files.ts`, `src/service/tools.ts`, `tests/service/fixtures/fakeTools.ts`
- Test: `tests/service/files.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `ensurePrivateDir(dir: string): void` (creates missing levels `0700`, never chmods an existing one), `ensurePrivateFile(path: string): void` (creates empty `0600` if missing), `writePrivateFile(path: string, text: string): void` (temp `0600` + rename), `readTextOrNull(path: string): string | null`, `tailLines(path: string, n: number): string[]`
  - `writeServiceFiles(paths: ServicePaths, config: ServiceConfigV1): void` (renders all three first; writes nothing on a refusal), `readServiceConfig(paths: ServicePaths): ServiceConfigV1` (`service-not-installed` / `service-config-invalid`)
  - `interface ToolResult { code: number; stdout: string; stderr: string }`, `type RunTool = (command: string, args: string[], opts: { env: NodeJS.ProcessEnv; inherit?: boolean }) => ToolResult`, `runTool: RunTool` (127 when the command cannot be spawned)
  - fixture: `fakeTools(root, names?) → { bin, env, codes(tool, sub, list), output(tool, sub, text), calls() }`, `testPaths(root): ServicePaths`, `sampleConfig(paths): ServiceConfigV1`

- [ ] **Step 1: Write the fixture** `tests/service/fixtures/fakeTools.ts` (the tests below and Tasks 6, 7, 10, 11 import it):

```ts
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceConfigV1 } from "../../../src/service/config.js";
import { servicePaths, type ServicePaths } from "../../../src/service/paths.js";

/**
 * A fake launchctl/systemctl/loginctl/journalctl/tail/sudo. Each call appends "<name> <argv>" to argv.log. The
 * subcommand is $1, or $2 after --user. Exit codes come from <name>.<sub>.codes (one per line, consumed in order,
 * default 0); stdout from <name>.<sub>.out. No braces in the script: this is a template literal.
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
  tail -n +2 "$queue" > "$queue.next"
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
    // /usr/bin:/bin stay on PATH for head/tail/mv inside the script and for the real ps; the fakes shadow nothing there.
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
```

- [ ] **Step 2: Write the failing test** `tests/service/files.test.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePrivateDir, ensurePrivateFile, readServiceConfig, tailLines, writePrivateFile, writeServiceFiles } from "../../src/service/files.js";
import { renderRunSh, renderServiceEnv } from "../../src/service/render.js";
import { runTool } from "../../src/service/tools.js";
import { fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "sf-")); roots.push(r); return r; }
const mode = (p: string) => statSync(p).mode & 0o777;

describe("service files on disk (Rule 17 modes)", () => {
  it("creates missing directories 0700 at every level and never changes an existing one", async () => {
    const r = await root();
    mkdirSync(join(r, "keep"), { mode: 0o755 });
    chmodSync(join(r, "keep"), 0o755);
    ensurePrivateDir(join(r, "keep", "a", "b"));
    expect([mode(join(r, "keep")), mode(join(r, "keep", "a")), mode(join(r, "keep", "a", "b"))]).toEqual([0o755, 0o700, 0o700]);
  });

  it("writes files 0600 by replacing them atomically, and creates empty log files 0600 once", async () => {
    const r = await root();
    const file = join(r, "f");
    writePrivateFile(file, "one");
    writePrivateFile(file, "two");
    expect([mode(file), statSync(file).size]).toEqual([0o600, 3]);
    ensurePrivateFile(join(r, "log"));
    writeFileSync(join(r, "log"), "kept");
    ensurePrivateFile(join(r, "log"));
    expect([mode(join(r, "log")), statSync(join(r, "log")).size]).toEqual([0o600, 4]);
  });

  it("writes service.json, service.env and run.sh together, and nothing when one of them is refused", async () => {
    const r = await root();
    const paths = testPaths(r);
    const config = sampleConfig(paths);
    writeServiceFiles(paths, config);
    expect(readServiceConfig(paths)).toEqual(config);
    expect([mode(paths.panelDir), mode(paths.logsDir), mode(paths.configFile), mode(paths.envFile), mode(paths.runScript), mode(paths.outLog), mode(paths.errLog)])
      .toEqual([0o700, 0o700, 0o600, 0o600, 0o600, 0o600, 0o600]);
    const other = testPaths(join(r, "other"));
    expect(() => writeServiceFiles(other, { ...sampleConfig(other), env: { X: "a$b" } })).toThrow(expect.objectContaining({ code: "service-env-value-unsupported" }));
    expect(existsSync(other.panelDir)).toBe(false);
    expect(renderServiceEnv(config)).not.toBe(renderRunSh(config, paths));
  });

  it("names a missing or broken service.json", async () => {
    const paths = testPaths(await root());
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-not-installed" }));
    ensurePrivateDir(paths.panelDir);
    writePrivateFile(paths.configFile, "{\"schema\":\"other\"}");
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-config-invalid" }));
  });

  it("tails the last lines of a log", async () => {
    const file = join(await root(), "log");
    writeFileSync(file, "a\nb\nc\nd\n");
    expect(tailLines(file, 2)).toEqual(["c", "d"]);
    expect(tailLines(join(file, "missing"), 2)).toEqual([]);
  });
});

describe("the tool runner and the fake tools", () => {
  it("logs argv, consumes queued exit codes in order, prints the canned output", async () => {
    const r = await root();
    const fake = await fakeTools(r);
    await fake.codes("launchctl", "bootstrap", [5, 0]);
    await fake.output("launchctl", "managername", "Aqua\n");
    const env = { ...process.env, ...fake.env };
    expect(runTool("launchctl", ["bootstrap", "gui/1", "/x.plist"], { env }).code).toBe(5);
    expect(runTool("launchctl", ["bootstrap", "gui/1", "/x.plist"], { env }).code).toBe(0);
    expect(runTool("launchctl", ["managername"], { env }).stdout).toBe("Aqua\n");
    expect(runTool("systemctl", ["--user", "daemon-reload"], { env }).code).toBe(0);
    expect(await fake.calls()).toEqual(["launchctl bootstrap gui/1 /x.plist", "launchctl bootstrap gui/1 /x.plist", "launchctl managername", "systemctl --user daemon-reload"]);
  });

  it("answers 127 for a command that does not exist", () => {
    expect(runTool("orca-no-such-tool", [], { env: { PATH: "/nonexistent" } }).code).toBe(127);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/service/files.test.ts > $SCRATCH/t5.txt 2>&1; echo rc=$? >> $SCRATCH/t5.txt`; read whole. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement** `src/service/tools.ts`:

```ts
import { spawnSync } from "node:child_process";

export interface ToolResult { code: number; stdout: string; stderr: string }
/** Every external tool goes through this, so a criterion can put fakes first on opts.env.PATH (spawn looks the command up there). */
export type RunTool = (command: string, args: string[], opts: { env: NodeJS.ProcessEnv; inherit?: boolean }) => ToolResult;

export const runTool: RunTool = (command, args, opts) => {
  const result = spawnSync(command, args, { env: opts.env, encoding: "utf8", stdio: opts.inherit === true ? "inherit" : "pipe" });
  if (result.error !== undefined) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
```

`src/service/files.ts`:

```ts
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { SERVICE_CONFIG_SCHEMA, type ServiceConfigV1 } from "./config.js";
import type { ServicePaths } from "./paths.js";
import { ServiceRejection } from "./rejection.js";
import { renderRunSh, renderServiceEnv } from "./render.js";

/** Rule 17: new levels 0700 with an explicit chmod (umask may be anything); an existing directory is not ours to change. */
export function ensurePrivateDir(dir: string): void {
  const first = mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (first === undefined) return;
  for (let path = dir; ; path = dirname(path)) {
    chmodSync(path, 0o700);
    if (path === first) break;
  }
}

export function ensurePrivateFile(path: string): void {
  try { closeSync(openSync(path, "wx", 0o600)); chmodSync(path, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

/** A temp file created 0600 and renamed over the target: a reader sees the old bytes or the new ones. */
export function writePrivateFile(path: string, text: string): void {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function readTextOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function tailLines(path: string, n: number): string[] {
  const text = readTextOrNull(path);
  if (text === null) return [];
  return text.split("\n").filter((line) => line.length > 0).slice(-n);
}

/** Spec §3. Everything is rendered before anything is written, so a refused value leaves no half-installed directory. */
export function writeServiceFiles(paths: ServicePaths, config: ServiceConfigV1): void {
  const json = `${JSON.stringify(config, null, 2)}\n`;
  const env = renderServiceEnv(config);
  const run = renderRunSh(config, paths);
  ensurePrivateDir(paths.panelDir);
  ensurePrivateDir(paths.logsDir);
  writePrivateFile(paths.configFile, json);
  writePrivateFile(paths.envFile, env);
  writePrivateFile(paths.runScript, run);
  ensurePrivateFile(paths.outLog);
  ensurePrivateFile(paths.errLog);
}

const configSchema = z.object({
  schema: z.literal(SERVICE_CONFIG_SCHEMA), node: z.string().min(1), entry: z.string().min(1),
  args: z.array(z.string()), env: z.record(z.string()),
}).strict();

export function readServiceConfig(paths: ServicePaths): ServiceConfigV1 {
  const text = readTextOrNull(paths.configFile);
  if (text === null) throw new ServiceRejection("service-not-installed", `${paths.configFile} does not exist; run orca panel install first`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw new ServiceRejection("service-config-invalid", `${paths.configFile}: ${String(error)}`); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new ServiceRejection("service-config-invalid", `${paths.configFile}: ${result.error.issues.map((i) => i.message).join("; ")}`);
  return result.data;
}
```

- [ ] **Step 5: Run** the test file → PASS (7). Typecheck → 0.

- [ ] **Step 6: Mutations (clone `$SCRATCH/mut-t5`).** (a) delete the `chmodSync(path, 0o700)` loop → directory test red under umask 022? — not necessarily (mode 0o700 with umask 022 stays 0700). Run this one with `umask 077` *and* with `umask 002` in the clone; record which (if either) goes red; if neither, record it as an equivalent mutant on this machine and keep the chmod (Rule 17 says explicit). (b) move `ensurePrivateDir(paths.panelDir)` above the three renders → "writes nothing" red; (c) delete `.strict()` and the `schema` literal → invalid-config test red; (d) delete the `result.error !== undefined` branch in `runTool` → 127 test red.

- [ ] **Step 7: Commit** `feat(service): write service files with explicit modes; run tools through one seam`.

---

### Task 6: The launchd manager (macOS)

**Files:**
- Create: `src/service/manager.ts`, `src/service/launchd.ts`, `src/service/processInfo.ts` (used by `defaultContext`; its own criteria are in Task 8)
- Modify: `tests/service/fixtures/fakeTools.ts` (add `fakeContext`)
- Test: `tests/service/launchd.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces (`manager.ts`):

```ts
export interface ServiceIo { stdout(text: string): void; stderr(text: string): void }
export interface ManagerState { loaded: boolean; state: string; pid: number | null }
export interface ServiceContext {
  paths: ServicePaths; env: NodeJS.ProcessEnv; run: RunTool; uid: number; user: string;
  out(line: string): void; err(line: string): void;
  sleep(ms: number): Promise<void>; now(): number;
  isAlive(pid: number): boolean; startTimeOf(pid: number): string | null;
  bootstrapDeadlineMs: number; exitWaitMs: number; startWaitMs: number;
}
export interface ServiceManager {
  readonly kind: "launchd" | "systemd" | "detached";
  install(ctx: ServiceContext): Promise<number>;   // service.json/env/run.sh already written by the caller
  start(ctx: ServiceContext): Promise<number>;
  stop(ctx: ServiceContext): Promise<number>;
  restart(ctx: ServiceContext): Promise<number>;   // service.env/run.sh already re-rendered by the caller (D20)
  state(ctx: ServiceContext): ManagerState;
  logs(ctx: ServiceContext, opts: { follow: boolean; lines: number }): number;
  uninstall(ctx: ServiceContext): Promise<number>;
}
export async function waitExit(ctx: ServiceContext, pid: number): Promise<boolean>;
export function defaultContext(env: NodeJS.ProcessEnv, paths: ServicePaths, io: ServiceIo): ServiceContext;
```

- `launchd: ServiceManager`, `LAUNCHD_NOT_LOADED = new Set([3, 113, 125])`.
- fixture: `fakeContext(fake, paths, over?) → { ctx, out: string[], err: string[] }` with a virtual clock (`sleep` advances `now`).

- [ ] **Step 1: Add `fakeContext`** to `tests/service/fixtures/fakeTools.ts`:

```ts
import type { ServiceContext } from "../../../src/service/manager.js";
import { runTool } from "../../../src/service/tools.js";

/** A context whose clock only moves when the code sleeps: deadlines are tested without waiting for them. */
export function fakeContext(fake: FakeTools, paths: ServicePaths, over: Partial<ServiceContext> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const ctx: ServiceContext = {
    paths, env: { ...process.env, ...fake.env }, run: runTool, uid: 501, user: "ann",
    out: (line) => out.push(line), err: (line) => err.push(line),
    sleep: async (ms) => { clock += ms; }, now: () => clock,
    isAlive: () => false, startTimeOf: () => null,
    bootstrapDeadlineMs: 2_000, exitWaitMs: 30_000, startWaitMs: 30_000,
    ...over,
  };
  return { ctx, out, err };
}
```

- [ ] **Step 2: Write the failing test** `tests/service/launchd.test.ts`:

```ts
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePrivateDir, writeServiceFiles } from "../../src/service/files.js";
import { launchd } from "../../src/service/launchd.js";
import { renderPlist } from "../../src/service/render.js";
import { fakeContext, fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function setup(aqua = true) {
  const r = await mkdtemp(join(tmpdir(), "sl-"));
  roots.push(r);
  const fake = await fakeTools(r);
  if (aqua) await fake.output("launchctl", "managername", "Aqua\n");
  const paths = testPaths(r);
  return { fake, paths, target: "gui/501/dev.orca.panel.test", plist: paths.plistFile };
}

describe("launchd (spec §4, macOS table)", () => {
  it("install writes the plist 0600, then bootout (ignored), enable, bootstrap — in that order", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootout", [113]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(0);
    expect(readFileSync(s.plist, "utf8")).toBe(renderPlist(s.paths));
    expect(statSync(s.plist).mode & 0o777).toBe(0o600);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl bootout ${s.target}`, `launchctl enable ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
  });

  it("uses user/<uid> when the manager is not Aqua (ssh, no GUI session)", async () => {
    const s = await setup(false);
    await s.fake.output("launchctl", "managername", "Background\n");
    const { ctx } = fakeContext(s.fake, s.paths);
    await launchd.install(ctx);
    expect((await s.fake.calls()).at(-1)).toBe(`launchctl bootstrap user/501 ${s.plist}`);
  });

  it("retries a bootstrap that exits 5 (label still draining) after a bootout, until it succeeds", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [5, 5, 0]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(0);
    expect((await s.fake.calls()).slice(3)).toEqual([
      `launchctl bootstrap gui/501 ${s.plist}`, `launchctl bootout ${s.target}`,
      `launchctl bootstrap gui/501 ${s.plist}`, `launchctl bootout ${s.target}`,
      `launchctl bootstrap gui/501 ${s.plist}`,
    ]);
  });

  it("gives up on exit 5 at the deadline and says so", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [5, 5, 5, 5, 5, 5, 5, 5]);
    const { ctx, err } = fakeContext(s.fake, s.paths, { bootstrapDeadlineMs: 1_000 });
    expect(await launchd.install(ctx)).toBe(1);
    expect(err.join("\n")).toContain("exited 5");
    expect((await s.fake.calls()).filter((c) => c.startsWith("launchctl bootstrap"))).toHaveLength(3);
  });

  it("does not retry another bootstrap failure", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [1]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(1);
    expect((await s.fake.calls()).filter((c) => c.startsWith("launchctl bootstrap"))).toHaveLength(1);
  });

  it("start is kickstart, and only when it is not loaded", async () => {
    const s = await setup();
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart ${s.target}`]);
  });

  it.each([3, 113, 125])("start bootstraps when kickstart exits %i (not loaded)", async (code) => {
    const s = await setup();
    await s.fake.codes("launchctl", "kickstart", [code]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
  });

  it("start does not bootstrap over another kickstart failure", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "kickstart", [1]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.startsWith("launchctl bootstrap"))).toBe(false);
  });

  it("stop is bootout (KeepAlive would revive a merely stopped job); not loaded counts as stopped", async () => {
    const s = await setup();
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.stop(ctx)).toBe(0);
    await s.fake.codes("launchctl", "bootout", [113]);
    expect(await launchd.stop(ctx)).toBe(0);
    expect((await s.fake.calls()).filter((c) => c.includes("bootout"))).toEqual([`launchctl bootout ${s.target}`, `launchctl bootout ${s.target}`]);
  });

  it("restart with an unchanged plist is kickstart -k", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, renderPlist(s.paths));
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.restart(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart -k ${s.target}`]);
  });

  it("restart with a changed plist rewrites it, boots out, waits for the pid, bootstraps (kickstart -k would keep the old plist)", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, "<old/>");
    await s.fake.output("launchctl", "print", `${s.target} = {\n\tstate = running\n\tpid = 4242\n}\n`);
    let polls = 0;
    const { ctx } = fakeContext(s.fake, s.paths, { isAlive: (pid) => pid === 4242 && ++polls < 3 });
    expect(await launchd.restart(ctx)).toBe(0);
    expect(readFileSync(s.plist, "utf8")).toBe(renderPlist(s.paths));
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl print ${s.target}`, `launchctl bootout ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
    expect(polls).toBe(3);
  });

  it("restart does not bootstrap over a pid that never exits", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, "<old/>");
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { ctx, err } = fakeContext(s.fake, s.paths, { isAlive: () => true, exitWaitMs: 1_000 });
    expect(await launchd.restart(ctx)).toBe(1);
    expect(err.join("\n")).toContain("did not exit");
    expect((await s.fake.calls()).some((c) => c.startsWith("launchctl bootstrap"))).toBe(false);
  });

  it("state reads launchctl print; a print failure is not loaded", async () => {
    const s = await setup();
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(launchd.state(ctx)).toEqual({ loaded: true, state: "running", pid: 4242 });
    await s.fake.codes("launchctl", "print", [113]);
    expect(launchd.state(ctx)).toEqual({ loaded: false, state: "not loaded", pid: null });
  });

  it("logs tails both files; uninstall boots out and removes plist and run.sh but keeps service.json and logs", async () => {
    const s = await setup();
    writeServiceFiles(s.paths, sampleConfig(s.paths));
    const { ctx } = fakeContext(s.fake, s.paths);
    await launchd.install(ctx);
    expect(launchd.logs(ctx, { follow: true, lines: 50 })).toBe(0);
    expect(await launchd.uninstall(ctx)).toBe(0);
    expect([existsSync(s.plist), existsSync(s.paths.runScript), existsSync(s.paths.configFile), existsSync(s.paths.errLog)]).toEqual([false, false, true, true]);
    const calls = await s.fake.calls();
    expect(calls).toContain(`tail -n 50 -F ${s.paths.outLog} ${s.paths.errLog}`);
    expect(calls.at(-1)).toBe(`launchctl bootout ${s.target}`);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/service/launchd.test.ts > $SCRATCH/t6.txt 2>&1; echo rc=$? >> $SCRATCH/t6.txt`; read whole. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement** `src/service/manager.ts`:

```ts
import { userInfo } from "node:os";
import type { ServicePaths } from "./paths.js";
import { isProcessAlive, processStartTime } from "./processInfo.js";
import { runTool, type RunTool } from "./tools.js";

// (interfaces exactly as in this task's Interfaces block)

/** Polls until the pid is gone or ctx.exitWaitMs passes (spec §4: ExitTimeOut 20 s + 10 s). */
export async function waitExit(ctx: ServiceContext, pid: number): Promise<boolean> {
  const deadline = ctx.now() + ctx.exitWaitMs;
  while (ctx.isAlive(pid)) {
    if (ctx.now() >= deadline) return false;
    await ctx.sleep(200);
  }
  return true;
}

export function defaultContext(env: NodeJS.ProcessEnv, paths: ServicePaths, io: ServiceIo): ServiceContext {
  return {
    paths, env, run: runTool as RunTool,
    uid: process.getuid?.() ?? 0,
    user: env.USER !== undefined && env.USER.length > 0 ? env.USER : userInfo().username,
    out: (line) => io.stdout(`${line}\n`), err: (line) => io.stderr(`${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => Date.now(),
    isAlive: isProcessAlive, startTimeOf: processStartTime,
    bootstrapDeadlineMs: 30_000, exitWaitMs: 30_000, startWaitMs: 30_000,
  };
}
```

`src/service/processInfo.ts` is created here (Task 8 tests it):

```ts
import { spawnSync } from "node:child_process";

/** Plan D9: the kernel's start time of a pid, or null when there is no such process. */
export function processStartTime(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const text = (result.stdout ?? "").trim();
  return result.status === 0 && text.length > 0 ? text : null;
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
```

`src/service/launchd.ts`:

```ts
import { dirname } from "node:path";
import { rmSync } from "node:fs";
import { ensurePrivateDir, readTextOrNull, writePrivateFile } from "./files.js";
import { waitExit, type ManagerState, type ServiceContext, type ServiceManager } from "./manager.js";
import { renderPlist } from "./render.js";

/** launchctl's "no such service" answers (ESRCH 3, 113, 125): not loaded, as opposed to failed. */
export const LAUNCHD_NOT_LOADED = new Set([3, 113, 125]);

const launchctl = (ctx: ServiceContext, args: string[]) => ctx.run("launchctl", args, { env: ctx.env });
/** Spec §4: gui/<uid> when launchctl managername answers Aqua, else user/<uid>. */
function domain(ctx: ServiceContext): string {
  const answer = launchctl(ctx, ["managername"]);
  return answer.code === 0 && answer.stdout.trim() === "Aqua" ? `gui/${ctx.uid}` : `user/${ctx.uid}`;
}
const target = (ctx: ServiceContext, dom: string): string => `${dom}/${ctx.paths.label}`;
const failed = (ctx: ServiceContext, verb: string, r: { code: number; stderr: string }): number => {
  ctx.err(`orca panel: launchctl ${verb} exited ${r.code}: ${r.stderr.trim()}`);
  return 1;
};

/** Spec §4/§9: exit 5 means the label is still draining; bootout and retry until the deadline. */
async function bootstrap(ctx: ServiceContext, dom: string): Promise<number> {
  const deadline = ctx.now() + ctx.bootstrapDeadlineMs;
  for (;;) {
    const r = launchctl(ctx, ["bootstrap", dom, ctx.paths.plistFile]);
    if (r.code === 0) return 0;
    if (r.code !== 5 || ctx.now() >= deadline) return failed(ctx, "bootstrap", r);
    launchctl(ctx, ["bootout", target(ctx, dom)]);
    await ctx.sleep(500);
  }
}

function printState(ctx: ServiceContext, dom: string): ManagerState {
  const r = launchctl(ctx, ["print", target(ctx, dom)]);
  if (r.code !== 0) return { loaded: false, state: "not loaded", pid: null };
  const pid = /^\s*pid = (\d+)$/m.exec(r.stdout)?.[1];
  return { loaded: true, state: /^\s*state = (.+)$/m.exec(r.stdout)?.[1]?.trim() ?? "unknown", pid: pid === undefined ? null : Number(pid) };
}

export const launchd: ServiceManager = {
  kind: "launchd",
  async install(ctx) {
    ensurePrivateDir(dirname(ctx.paths.plistFile));
    writePrivateFile(ctx.paths.plistFile, renderPlist(ctx.paths));
    const dom = domain(ctx);
    launchctl(ctx, ["bootout", target(ctx, dom)]); // spec §4: errors ignored -- nothing may be loaded yet
    const enabled = launchctl(ctx, ["enable", target(ctx, dom)]);
    if (enabled.code !== 0) return failed(ctx, "enable", enabled);
    return bootstrap(ctx, dom);
  },
  async start(ctx) {
    const dom = domain(ctx);
    const r = launchctl(ctx, ["kickstart", target(ctx, dom)]);
    if (r.code === 0) return 0;
    if (LAUNCHD_NOT_LOADED.has(r.code)) return bootstrap(ctx, dom);
    return failed(ctx, "kickstart", r);
  },
  async stop(ctx) {
    const r = launchctl(ctx, ["bootout", target(ctx, domain(ctx))]);
    if (r.code === 0) return 0;
    if (LAUNCHD_NOT_LOADED.has(r.code)) { ctx.out("orca panel: not loaded; nothing to stop"); return 0; }
    return failed(ctx, "bootout", r);
  },
  async restart(ctx) {
    const dom = domain(ctx);
    const wanted = renderPlist(ctx.paths);
    if (readTextOrNull(ctx.paths.plistFile) === wanted) {
      const r = launchctl(ctx, ["kickstart", "-k", target(ctx, dom)]);
      if (r.code === 0) return 0;
      if (LAUNCHD_NOT_LOADED.has(r.code)) return bootstrap(ctx, dom);
      return failed(ctx, "kickstart -k", r);
    }
    // Spec §4/§9: kickstart -k would keep running the old plist. Rewrite, bootout, wait for the old pid, bootstrap.
    const { pid } = printState(ctx, dom);
    ensurePrivateDir(dirname(ctx.paths.plistFile));
    writePrivateFile(ctx.paths.plistFile, wanted);
    launchctl(ctx, ["bootout", target(ctx, dom)]);
    if (pid !== null && !(await waitExit(ctx, pid))) {
      ctx.err(`orca panel: pid ${pid} did not exit within ${ctx.exitWaitMs} ms after bootout; not bootstrapping over it`);
      return 1;
    }
    return bootstrap(ctx, dom);
  },
  state(ctx) { return printState(ctx, domain(ctx)); },
  logs(ctx, opts) {
    return ctx.run("tail", ["-n", String(opts.lines), ...(opts.follow ? ["-F"] : []), ctx.paths.outLog, ctx.paths.errLog], { env: ctx.env, inherit: true }).code;
  },
  async uninstall(ctx) {
    const r = launchctl(ctx, ["bootout", target(ctx, domain(ctx))]);
    if (r.code !== 0 && !LAUNCHD_NOT_LOADED.has(r.code)) return failed(ctx, "bootout", r);
    rmSync(ctx.paths.plistFile, { force: true });
    rmSync(ctx.paths.runScript, { force: true });
    return 0;
  },
};
```

- [ ] **Step 5: Run** the test file → PASS (16 incl. the 3 `it.each`). Typecheck → 0.

- [ ] **Step 6: Mutations (clone `$SCRATCH/mut-t6`).** (a) `r.code !== 5` → `true` → retry test red; (b) delete the deadline clause `|| ctx.now() >= deadline` → deadline test hangs → vitest timeout red (record as red-by-timeout); (c) delete the `LAUNCHD_NOT_LOADED` branch in `start` → `it.each` red; (d) replace the plist equality with `false` → unchanged-restart red; (e) with `true` → changed-restart red; (f) delete the `waitExit` guard → never-exits red; (g) `=== "Aqua"` → `!== "Background"`… simpler: always `gui/` → user-domain test red; (h) delete `rmSync(ctx.paths.runScript…)` → uninstall test red.

- [ ] **Step 7: Commit** `feat(service): drive the panel's LaunchAgent with launchctl`.

---

### Task 7: The systemd manager (Linux)

**Files:**
- Create: `src/service/systemd.ts`
- Test: `tests/service/systemd.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6 (`ServiceManager`, `ServiceContext`, `fakeContext`).
- Produces: `systemd: ServiceManager`; `systemdEnv(env: NodeJS.ProcessEnv, uid: number, probe: RuntimeProbe): NodeJS.ProcessEnv`; `interface RuntimeProbe { ownerOf(path: string): number | null; exists(path: string): boolean }`; `realRuntimeProbe: RuntimeProbe`.

- [ ] **Step 1: Write the failing test** `tests/service/systemd.test.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeServiceFiles } from "../../src/service/files.js";
import { renderUnit } from "../../src/service/render.js";
import { systemd, systemdEnv } from "../../src/service/systemd.js";
import { fakeContext, fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const uid = process.getuid!();
async function setup(linger = "Linger=yes\n") {
  const r = await mkdtemp(join(tmpdir(), "sd-"));
  roots.push(r);
  const fake = await fakeTools(r);
  await fake.output("loginctl", "show-user", linger);
  const paths = testPaths(r);
  writeServiceFiles(paths, sampleConfig(paths));
  // XDG_RUNTIME_DIR is a directory this test owns, so the preflight keeps it.
  const { ctx, out, err } = fakeContext(fake, paths, { uid, env: { ...process.env, ...fake.env, XDG_RUNTIME_DIR: r } });
  return { fake, paths, ctx, out, err };
}

describe("systemd preflight (spec §4)", () => {
  const probe = (owner: number | null, bus: boolean) => ({ ownerOf: () => owner, exists: () => bus });
  it("sets XDG_RUNTIME_DIR when unset or not ours, and DBUS when the bus exists and it is unset", () => {
    expect(systemdEnv({}, 1000, probe(null, false)).XDG_RUNTIME_DIR).toBe("/run/user/1000");
    expect(systemdEnv({ XDG_RUNTIME_DIR: "/run/user/0" }, 1000, probe(0, false)).XDG_RUNTIME_DIR).toBe("/run/user/1000");
    expect(systemdEnv({ XDG_RUNTIME_DIR: "/r" }, 1000, probe(1000, false)).XDG_RUNTIME_DIR).toBe("/r");
    expect(systemdEnv({}, 1000, probe(null, true)).DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/run/user/1000/bus");
    expect(systemdEnv({ DBUS_SESSION_BUS_ADDRESS: "x" }, 1000, probe(null, true)).DBUS_SESSION_BUS_ADDRESS).toBe("x");
    expect(systemdEnv({}, 1000, probe(null, false)).DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
  });
});

describe("systemd (spec §4, Linux table)", () => {
  it("install writes the unit, checks linger, daemon-reloads, enable --now", async () => {
    const s = await setup();
    expect(await systemd.install(s.ctx)).toBe(0);
    expect(readFileSync(s.paths.unitFile, "utf8")).toBe(renderUnit(sampleConfig(s.paths), s.paths));
    expect(await s.fake.calls()).toEqual(["loginctl show-user ann -p Linger", "systemctl --user daemon-reload", "systemctl --user enable --now orca-panel-test"]);
  });

  it("turns linger on when it is off, and prints the sudo line (never runs sudo) when it cannot", async () => {
    const s = await setup("Linger=no\n");
    await s.fake.codes("loginctl", "enable-linger", [1]);
    expect(await systemd.install(s.ctx)).toBe(0);
    const calls = await s.fake.calls();
    expect(calls.slice(0, 2)).toEqual(["loginctl show-user ann -p Linger", "loginctl enable-linger ann"]);
    expect(calls.some((c) => c.startsWith("sudo"))).toBe(false);
    expect(s.err.join("\n")).toContain("sudo loginctl enable-linger ann");
  });

  it.each(["start", "stop"] as const)("%s is systemctl --user %s <unit>", async (verb) => {
    const s = await setup();
    expect(await systemd[verb](s.ctx)).toBe(0);
    expect((await s.fake.calls()).at(-1)).toBe(`systemctl --user ${verb} orca-panel-test`);
  });

  it("restart daemon-reloads first only when the unit changed", async () => {
    const s = await setup();
    writeFileSync(s.paths.unitFile, renderUnit(sampleConfig(s.paths), s.paths));
    expect(await systemd.restart(s.ctx)).toBe(0);
    expect((await s.fake.calls()).slice(1)).toEqual(["systemctl --user restart orca-panel-test"]);
    writeFileSync(s.paths.unitFile, "[Unit]\n");
    expect(await systemd.restart(s.ctx)).toBe(0);
    expect((await s.fake.calls()).slice(3)).toEqual(["systemctl --user daemon-reload", "systemctl --user restart orca-panel-test"]);
    expect(readFileSync(s.paths.unitFile, "utf8")).toBe(renderUnit(sampleConfig(s.paths), s.paths));
  });

  it("state reads ActiveState/SubState/MainPID/NRestarts; logs is journalctl; uninstall disables, removes, reloads", async () => {
    const s = await setup();
    await s.fake.output("systemctl", "show", "ActiveState=active\nSubState=running\nMainPID=777\nNRestarts=2\n");
    expect(systemd.state(s.ctx)).toEqual({ loaded: true, state: "active/running restarts=2", pid: 777 });
    expect(systemd.logs(s.ctx, { follow: false, lines: 30 })).toBe(0);
    await systemd.install(s.ctx);
    expect(await systemd.uninstall(s.ctx)).toBe(0);
    expect(existsSync(s.paths.unitFile)).toBe(false);
    const calls = await s.fake.calls();
    expect(calls).toContain("systemctl --user show orca-panel-test -p ActiveState,SubState,MainPID,NRestarts");
    expect(calls).toContain("journalctl --user -u orca-panel-test -n 30");
    expect(calls.slice(-2)).toEqual(["systemctl --user disable --now orca-panel-test", "systemctl --user daemon-reload"]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/systemd.test.ts > $SCRATCH/t7.txt 2>&1; echo rc=$? >> $SCRATCH/t7.txt`; read whole. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/service/systemd.ts`:

```ts
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensurePrivateDir, readServiceConfig, readTextOrNull, writePrivateFile } from "./files.js";
import type { ManagerState, ServiceContext, ServiceManager } from "./manager.js";
import { renderUnit } from "./render.js";

export interface RuntimeProbe { ownerOf(path: string): number | null; exists(path: string): boolean }
export const realRuntimeProbe: RuntimeProbe = {
  ownerOf: (path) => { try { return statSync(path).uid; } catch { return null; } },
  exists: existsSync,
};

/** Spec §4 preflight: services and ssh sessions often lack the user manager's runtime dir and bus. */
export function systemdEnv(env: NodeJS.ProcessEnv, uid: number, probe: RuntimeProbe): NodeJS.ProcessEnv {
  const out = { ...env };
  const runtime = env.XDG_RUNTIME_DIR;
  if (runtime === undefined || runtime === "" || probe.ownerOf(runtime) !== uid) out.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  const bus = join(out.XDG_RUNTIME_DIR!, "bus");
  if ((out.DBUS_SESSION_BUS_ADDRESS ?? "") === "" && probe.exists(bus)) out.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  return out;
}

/** Plan D18: before every systemctl --user. Without linger the panel stops at logout. Orca never runs sudo. */
function preflight(ctx: ServiceContext): NodeJS.ProcessEnv {
  const env = systemdEnv(ctx.env, ctx.uid, realRuntimeProbe);
  const linger = ctx.run("loginctl", ["show-user", ctx.user, "-p", "Linger"], { env });
  if (linger.code !== 0 || linger.stdout.trim() !== "Linger=yes") {
    const enabled = ctx.run("loginctl", ["enable-linger", ctx.user], { env });
    if (enabled.code !== 0) ctx.err(`orca panel: linger is off for ${ctx.user}, so the panel stops at logout. Run: sudo loginctl enable-linger ${ctx.user}`);
  }
  return env;
}

function systemctl(ctx: ServiceContext, env: NodeJS.ProcessEnv, args: string[]): number {
  const r = ctx.run("systemctl", ["--user", ...args], { env });
  if (r.code !== 0) ctx.err(`orca panel: systemctl --user ${args.join(" ")} exited ${r.code}: ${r.stderr.trim()}`);
  return r.code === 0 ? 0 : 1;
}

function writeUnit(ctx: ServiceContext): boolean {
  const wanted = renderUnit(readServiceConfig(ctx.paths), ctx.paths);
  if (readTextOrNull(ctx.paths.unitFile) === wanted) return false;
  ensurePrivateDir(dirname(ctx.paths.unitFile));
  writePrivateFile(ctx.paths.unitFile, wanted);
  return true;
}

export const systemd: ServiceManager = {
  kind: "systemd",
  async install(ctx) {
    writeUnit(ctx);
    const env = preflight(ctx);
    if (systemctl(ctx, env, ["daemon-reload"]) !== 0) return 1;
    return systemctl(ctx, env, ["enable", "--now", ctx.paths.unit]);
  },
  async start(ctx) { return systemctl(ctx, preflight(ctx), ["start", ctx.paths.unit]); },
  async stop(ctx) { return systemctl(ctx, preflight(ctx), ["stop", ctx.paths.unit]); },
  async restart(ctx) {
    const changed = writeUnit(ctx);
    const env = preflight(ctx);
    if (changed && systemctl(ctx, env, ["daemon-reload"]) !== 0) return 1;
    return systemctl(ctx, env, ["restart", ctx.paths.unit]);
  },
  state(ctx): ManagerState {
    const r = ctx.run("systemctl", ["--user", "show", ctx.paths.unit, "-p", "ActiveState,SubState,MainPID,NRestarts"], { env: preflight(ctx) });
    if (r.code !== 0) return { loaded: false, state: "not loaded", pid: null };
    const value = (key: string): string => new RegExp(`^${key}=(.*)$`, "m").exec(r.stdout)?.[1]?.trim() ?? "";
    const pid = Number(value("MainPID"));
    return { loaded: true, state: `${value("ActiveState")}/${value("SubState")} restarts=${value("NRestarts")}`, pid: pid > 0 ? pid : null };
  },
  logs(ctx, opts) {
    return ctx.run("journalctl", ["--user", "-u", ctx.paths.unit, "-n", String(opts.lines), ...(opts.follow ? ["-f"] : [])], { env: preflight(ctx), inherit: true }).code;
  },
  async uninstall(ctx) {
    const env = preflight(ctx);
    systemctl(ctx, env, ["disable", "--now", ctx.paths.unit]); // reported, not fatal: an unloaded unit is still removed
    rmSync(ctx.paths.unitFile, { force: true });
    return systemctl(ctx, env, ["daemon-reload"]);
  },
};
```

Note: the `start`/`stop` `it.each` expects the last call; preflight's `loginctl show-user` comes first — consistent.

- [ ] **Step 4: Run** the test file → PASS. Typecheck → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t7`).** (a) delete the `enable-linger` call → linger test red; (b) `changed &&` → `false &&` → restart-changed red; (c) delete `|| probe.ownerOf(runtime) !== uid` → preflight test red; (d) delete the DBUS assignment → preflight test red; (e) delete `rmSync(ctx.paths.unitFile…)` → uninstall red.

- [ ] **Step 6: Commit** `feat(service): drive the panel's systemd user unit`.

---

### Task 8: One panel at a time — lock, `panel.json`, exit 78, log rotation

**Files:**
- Create: `src/service/instance.ts`, `src/service/logRotate.ts`, `src/service/servicePanel.ts`
- Modify: `src/panel/rejection.ts` (`PanelExitCode`, `PANEL_BIND_FAILED`), `src/panel/server.ts` (`PanelMode`, listen/socket failure mapping, `panelReadyLines`, `startPanelFromArgs(args, mode)`), `src/cli.ts` (`runPanel` handles `--service`, uses `panelReadyLines`)
- Test: `tests/service/instance.test.ts`, `tests/service/servicePanel.test.ts`

**Interfaces:**
- Consumes: `processStartTime`, `isProcessAlive` (Task 6), `servicePaths`, `ensurePrivateDir`, `writePrivateFile`, `readTextOrNull` (Tasks 2, 5).
- Produces:
  - `interface LockBody { pid: number; startTime: string }`; `type LockOutcome = { kind: "acquired"; release(): void } | { kind: "held"; holder: LockBody }`; `acquirePanelLock(file: string, self: LockBody, probe: { startTimeOf(pid: number): string | null }): LockOutcome`
  - `interface PanelJsonV1 { pid: number; startTime: string; url: string; socketPath: string | null; version: string }`; `readPanelJson(file): { kind: "missing" } | { kind: "invalid"; reason: string } | { kind: "valid"; body: PanelJsonV1 }`; `writePanelJson(file, body): void`; `removePanelJsonIfOurs(file, pid): void`
  - `LOG_MAX_BYTES = 10 * 1024 * 1024`, `LOG_KEEP = 3`, `rotateLogs(files: string[], opts: { maxBytes: number; keep: number }): void`
  - `runServicePanel(args: string[], env: NodeJS.ProcessEnv, io: ServiceIo): Promise<number>`
  - server: `interface PanelMode { service?: boolean }`; `createPanelServer(opts, env = process.env, mode: PanelMode = {})`; `startPanelFromArgs(args, mode: PanelMode = {})`; `panelReadyLines(started): { stdout: string; stderr: string }`; `PANEL_BIND_FAILED = "panel-bind-failed"`; `PanelExitCode = 1 | 4 | 5 | 78`

- [ ] **Step 1: Write the failing unit test** `tests/service/instance.test.ts`:

```ts
import { readFileSync, statSync, truncateSync, writeFileSync, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquirePanelLock, readPanelJson, removePanelJsonIfOurs, writePanelJson } from "../../src/service/instance.js";
import { rotateLogs } from "../../src/service/logRotate.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "si-")); roots.push(r); return r; }
const self = { pid: 1111, startTime: "Mon Oct  5 10:00:00 2026" };

describe("the single-instance lock (spec §5)", () => {
  it("is created 0600 with the holder's pid and start time, and released only by its holder", async () => {
    const file = join(await root(), "panel.lock");
    const outcome = acquirePanelLock(file, self, { startTimeOf: () => null });
    expect(outcome.kind).toBe("acquired");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(self);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileSync(file, JSON.stringify({ pid: 2222, startTime: "x" }));
    if (outcome.kind === "acquired") outcome.release();
    expect(existsSync(file)).toBe(true);
  });

  it("a live holder (same start time) keeps it", async () => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, JSON.stringify(self));
    expect(acquirePanelLock(file, { pid: 3333, startTime: "y" }, { startTimeOf: (pid) => (pid === 1111 ? self.startTime : null) })).toEqual({ kind: "held", holder: self });
  });

  it.each([
    ["a dead pid", () => null],
    ["a reused pid (start time differs)", () => "Tue Oct  6 09:00:00 2026"],
  ])("is taken over from %s", async (_name, startTimeOf) => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, JSON.stringify(self));
    const mine = { pid: 4444, startTime: "z" };
    expect(acquirePanelLock(file, mine, { startTimeOf }).kind).toBe("acquired");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(mine);
  });

  it("is taken over from a body no panel wrote", async () => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, "not json");
    expect(acquirePanelLock(file, self, { startTimeOf: () => "anything" }).kind).toBe("acquired");
  });
});

describe("panel.json (spec §5)", () => {
  it("round-trips, is 0600, and is removed only by the pid it names", async () => {
    const file = join(await root(), "panel.json");
    const body = { pid: 1111, startTime: "s", url: "http://127.0.0.1:7777", socketPath: "/s/control.sock", version: "0.1.0" };
    expect(readPanelJson(file)).toEqual({ kind: "missing" });
    writePanelJson(file, body);
    expect(readPanelJson(file)).toEqual({ kind: "valid", body });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    removePanelJsonIfOurs(file, 2222);
    expect(existsSync(file)).toBe(true);
    removePanelJsonIfOurs(file, 1111);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "{");
    expect(readPanelJson(file).kind).toBe("invalid");
  });
});

describe("log rotation (spec §6, plan D11)", () => {
  it("copy-truncates a log over the limit and keeps three", async () => {
    const r = await root();
    const log = join(r, "panel.err.log");
    for (const [suffix, text] of [["", "now".repeat(10)], [".1", "one"], [".2", "two"], [".3", "three"]] as const) writeFileSync(`${log}${suffix}`, text);
    rotateLogs([log, join(r, "absent.log")], { maxBytes: 20, keep: 3 });
    expect([readFileSync(log, "utf8"), readFileSync(`${log}.1`, "utf8"), readFileSync(`${log}.2`, "utf8"), readFileSync(`${log}.3`, "utf8")]).toEqual(["", "now".repeat(10), "one", "two"]);
    expect(existsSync(`${log}.4`)).toBe(false);
    expect(statSync(`${log}.1`).mode & 0o777).toBe(0o600);
  });

  it("leaves a log under the limit alone", async () => {
    const log = join(await root(), "panel.out.log");
    writeFileSync(log, "small");
    rotateLogs([log], { maxBytes: 20, keep: 3 });
    expect([readFileSync(log, "utf8"), existsSync(`${log}.1`)]).toEqual(["small", false]);
    truncateSync(log, 0);
  });
});

describe("process identity (plan D9)", () => {
  it("reads this process's start time and none for a dead pid", () => {
    expect(processStartTime(process.pid)).toMatch(/\d{4}$/);
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(processStartTime(2 ** 22 - 3)).toBe(null);
  });
});
```

(If pid `2**22-3` happens to be alive on the host, pick a pid with `isProcessAlive(pid) === false` first; record it.)

- [ ] **Step 2: Write the failing process test** `tests/service/servicePanel.test.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { readPanelJson } from "../../src/service/instance.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";

const roots: string[] = [];
const children: Array<ReturnType<typeof spawn>> = [];
afterEach(async () => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function workspace() {
  const r = await mkdtemp(join(tmpdir(), "sp-"));
  roots.push(r);
  for (const d of ["repo", "dist", "p", "c", "k"]) await mkdir(join(r, d));
  writeFileSync(join(r, "dist", "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  return { r, panelDir: join(r, "p"), controlDir: join(r, "c"), lock: join(r, "p", "panel.lock"), json: join(r, "p", "panel.json") };
}

function servicePanel(w: Awaited<ReturnType<typeof workspace>>, extra: string[] = [], service = true) {
  const args = ["src/cli.ts", "panel", "run", ...(service ? ["--service"] : []), "--by", "t", "--repo", `p=${join(w.r, "repo")}`, "--dist", join(w.r, "dist"), ...extra];
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), args, {
    cwd: process.cwd(),
    env: { ...process.env, ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ORCA_PANEL_DIR: w.panelDir, ORCA_CONTROL_DIR: w.controlDir, ORCA_CORRECTIONS_DIR: join(w.r, "k") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "", stderr = "";
  child.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
  child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const ready = () => new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => { if (stdout.includes("orca-panel ready url=")) { clearInterval(timer); resolve(); } }, 50);
    setTimeout(() => { clearInterval(timer); reject(new Error(`no ready line in 30s; stderr: ${stderr}`)); }, 30_000);
    void exited.then((code) => { clearInterval(timer); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
  });
  return { child, exited, ready, out: () => stdout, err: () => stderr };
}

describe("orca panel run --service (spec §5)", () => {
  it("takes the lock, writes panel.json naming its socket, and removes both on SIGTERM", async () => {
    const w = await workspace();
    const p = servicePanel(w, ["--port", "0"]);
    await p.ready();
    const json = readPanelJson(w.json);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    expect(JSON.parse(readFileSync(w.lock, "utf8"))).toEqual({ pid: json.body.pid, startTime: json.body.startTime });
    expect(json.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // Short temp names on purpose: in service mode a socket path over sun_path's 104 bytes is exit 78 (plan D13).
    expect(json.body.socketPath).toBe(join(w.controlDir, controlRepoKey("p"), "control.sock"));
    // Accounts plan dependency: the initial-password line names a file, never the password. Vacuous until that plan
    // lands (no such file); whichever plan lands second makes this unconditional and sees it red (mutation M-acc).
    const initial = join(w.controlDir, "initial-password");
    if (existsSync(initial)) expect(p.out() + p.err()).not.toContain(readFileSync(initial, "utf8").trim());
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
    expect([existsSync(w.json), existsSync(w.lock)]).toEqual([false, false]);
  }, 60_000);

  it("exits 78 when the port is held by another program, leaving no lock and no panel.json", async () => {
    const w = await workspace();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    try {
      const p = servicePanel(w, ["--port", String((blocker.address() as AddressInfo).port)]);
      expect(await p.exited).toBe(78);
      expect(p.err()).toContain("panel-bind-failed");
      expect([existsSync(w.json), existsSync(w.lock)]).toEqual([false, false]);
    } finally { blocker.close(); }
  }, 60_000);

  it("exits 0 without binding when a live panel holds the lock", async () => {
    const w = await workspace();
    writeFileSync(w.lock, JSON.stringify({ pid: process.pid, startTime: processStartTime(process.pid) }));
    const p = servicePanel(w, ["--port", "0"]);
    expect(await p.exited).toBe(0);
    expect(p.err()).toContain(`pid ${process.pid}`);
    expect([p.out().includes("orca-panel ready"), existsSync(w.json)]).toEqual([false, false]);
  }, 60_000);

  it("takes over a lock whose pid was reused (start time differs)", async () => {
    const w = await workspace();
    writeFileSync(w.lock, JSON.stringify({ pid: process.pid, startTime: "Thu Jan  1 00:00:00 1970" }));
    const p = servicePanel(w, ["--port", "0"]);
    await p.ready();
    const json = readPanelJson(w.json);
    expect(json.kind === "valid" && json.body.pid !== process.pid && isProcessAlive(json.body.pid)).toBe(true);
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
  }, 60_000);

  it("plan D2: plain orca panel run takes no lock and writes no panel.json", async () => {
    const w = await workspace();
    const p = servicePanel(w, ["--port", "0"], false);
    await p.ready();
    expect([existsSync(w.lock), existsSync(w.json)]).toEqual([false, false]);
    p.child.kill("SIGTERM");
    expect(await p.exited).toBe(0);
  }, 60_000);
});
```

- [ ] **Step 3: Run** `npx vitest run tests/service/instance.test.ts tests/service/servicePanel.test.ts > $SCRATCH/t8.txt 2>&1; echo rc=$? >> $SCRATCH/t8.txt`; read whole. Expected: FAIL (modules not found; the D2 test may already pass — note it, it guards the future).

- [ ] **Step 4: Implement `src/service/instance.ts`:**

```ts
import { randomBytes } from "node:crypto";
import { linkSync, unlinkSync, writeFileSync } from "node:fs";
import { readTextOrNull, writePrivateFile } from "./files.js";
import { ServiceRejection } from "./rejection.js";

export interface LockBody { pid: number; startTime: string }
export type LockOutcome = { kind: "acquired"; release(): void } | { kind: "held"; holder: LockBody };

function parseLock(text: string): LockBody | null {
  try {
    const value = JSON.parse(text) as Partial<LockBody>;
    return Number.isInteger(value.pid) && typeof value.startTime === "string" ? { pid: value.pid!, startTime: value.startTime } : null;
  } catch { return null; }
}
const unlinkQuiet = (file: string): void => { try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };

/**
 * Spec §5 and plan D10. link() from a complete temp file is the O_EXCL create: no reader sees a half-written lock.
 * A holder is live only if its pid still has the start time it recorded; anything else is stale and is removed --
 * but only if its bytes are still the ones judged, so a lock a racing panel just took is not removed in its place.
 */
export function acquirePanelLock(file: string, self: LockBody, probe: { startTimeOf(pid: number): string | null }): LockOutcome {
  const body = JSON.stringify(self);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const temp = `${file}.${self.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
    try {
      linkSync(temp, file);
      return { kind: "acquired", release: () => { if (readTextOrNull(file) === body) unlinkQuiet(file); } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally { unlinkQuiet(temp); }
    const seen = readTextOrNull(file);
    if (seen === null) continue;
    const holder = parseLock(seen);
    if (holder !== null && probe.startTimeOf(holder.pid) === holder.startTime) return { kind: "held", holder };
    if (readTextOrNull(file) === seen) unlinkQuiet(file);
  }
  throw new ServiceRejection("panel-lock-contended", `${file} changed hands three times while this panel tried to take it`);
}

export interface PanelJsonV1 { pid: number; startTime: string; url: string; socketPath: string | null; version: string }

export function readPanelJson(file: string): { kind: "missing" } | { kind: "invalid"; reason: string } | { kind: "valid"; body: PanelJsonV1 } {
  const text = readTextOrNull(file);
  if (text === null) return { kind: "missing" };
  try {
    const v = JSON.parse(text) as Partial<PanelJsonV1>;
    if (Number.isInteger(v.pid) && typeof v.startTime === "string" && typeof v.url === "string" && (v.socketPath === null || typeof v.socketPath === "string") && typeof v.version === "string") {
      return { kind: "valid", body: { pid: v.pid!, startTime: v.startTime, url: v.url, socketPath: v.socketPath, version: v.version } };
    }
    return { kind: "invalid", reason: "missing or mistyped fields" };
  } catch (error) { return { kind: "invalid", reason: String(error) }; }
}

export function writePanelJson(file: string, body: PanelJsonV1): void { writePrivateFile(file, `${JSON.stringify(body)}\n`); }

export function removePanelJsonIfOurs(file: string, pid: number): void {
  const read = readPanelJson(file);
  if (read.kind === "valid" && read.body.pid === pid) unlinkQuiet(file);
}
```

`src/service/logRotate.ts`:

```ts
import { chmodSync, copyFileSync, renameSync, rmSync, statSync, truncateSync } from "node:fs";

export const LOG_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_KEEP = 3;

/** Spec §6, plan D11: copy-truncate, because launchd holds descriptors it opened before the panel ran. */
export function rotateLogs(files: string[], opts: { maxBytes: number; keep: number }): void {
  for (const file of files) {
    let size: number;
    try { size = statSync(file).size; } catch { continue; }
    if (size <= opts.maxBytes) continue;
    rmSync(`${file}.${opts.keep}`, { force: true });
    for (let n = opts.keep - 1; n >= 1; n -= 1) {
      try { renameSync(`${file}.${n}`, `${file}.${n + 1}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    copyFileSync(file, `${file}.1`);
    chmodSync(`${file}.1`, 0o600);
    truncateSync(file, 0);
  }
}
```

- [ ] **Step 5: Panel changes.** `src/panel/rejection.ts`: `export type PanelExitCode = 1 | 4 | 5 | 78;` and

```ts
/** Panel service spec §5: in service mode a port or socket bind failure exits 78, which systemd does not restart. */
export const PANEL_BIND_FAILED = "panel-bind-failed";
```

`src/panel/server.ts`:
1. Add `export interface PanelMode { /** `orca panel run --service` (panel service spec §5, plan D2). */ service?: boolean }`, change the signature to `createPanelServer(opts: PanelOptions, env: NodeJS.ProcessEnv = process.env, mode: PanelMode = {})`, import `PANEL_BIND_FAILED`.
2. In the `listen` arm of `runControlPanelStartup`, replace `server.once("error", reject);` with:

```ts
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (mode.service !== true) { reject(error); return; }
        control?.close();
        reject(new PanelRejection(PANEL_BIND_FAILED, `${opts.bind}:${opts.port}: ${error.code ?? ""} ${error.message}`, 78));
      });
```

3. In the socket bind block, replace `if ("code" in bound) process.stderr.write(...)` with:

```ts
    if ("code" in bound) {
      // Plan D13: a service with no socket would answer `status` as not running forever; exit 78 instead.
      if (mode.service === true) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        control.close();
        throw new PanelRejection(PANEL_BIND_FAILED, `control socket: ${bound.code}: ${bound.detail}`, 78);
      }
      process.stderr.write(`orca-panel: control socket unavailable: ${bound.code}: ${bound.detail}\n`);
    }
```

4. Add after `StartedPanel`:

```ts
/** The panel's announcement, shared by the foreground panel and the service panel: one machine line on stdout. */
export function panelReadyLines(started: StartedPanel): { stdout: string; stderr: string } {
  return {
    stdout: `orca-panel ready url=${started.url} token=${started.token}\n`,
    stderr: `orca-panel: open ${started.url} in a browser (the page already carries the token)\n` +
      (started.socketPath !== null ? `orca-panel: control socket ${started.socketPath}\n` : ""),
  };
}
```

5. `export async function startPanelFromArgs(args: string[], mode: PanelMode = {}): Promise<StartedPanel>` and pass `mode` as the third argument to `createPanelServer`.

`src/cli.ts` `runPanel`: at the top of the function body add

```ts
  // Panel service spec §5 / plan D2: only the managed form takes the lock and writes panel.json.
  if (args.includes("--service")) {
    const { runServicePanel } = await import("./service/servicePanel.js");
    return runServicePanel(args.filter((arg) => arg !== "--service"), process.env, { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) });
  }
```

and replace the three `process.stdout.write`/`process.stderr.write` announcement lines with `const lines = panelReadyLines(started); process.stdout.write(lines.stdout); process.stderr.write(lines.stderr);` (import `panelReadyLines` from the same dynamic import of `./panel/server.js`). The bytes are identical (verify:panel parses them).

`src/service/servicePanel.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PanelRejection } from "../panel/rejection.js";
import { ensurePrivateDir } from "./files.js";
import { acquirePanelLock, removePanelJsonIfOurs, writePanelJson } from "./instance.js";
import { LOG_KEEP, LOG_MAX_BYTES, rotateLogs } from "./logRotate.js";
import type { ServiceIo } from "./manager.js";
import { servicePaths } from "./paths.js";
import { processStartTime } from "./processInfo.js";
import { ServiceRejection } from "./rejection.js";

const orcaVersion = (): string =>
  (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")) as { version: string }).version;

/** Spec §5/§6: what the service manager runs. Lock → panel → panel.json → (closed) → remove panel.json → release. */
export async function runServicePanel(args: string[], env: NodeJS.ProcessEnv, io: ServiceIo): Promise<number> {
  try {
    const paths = servicePaths(env);
    ensurePrivateDir(paths.panelDir);
    rotateLogs([paths.outLog, paths.errLog], { maxBytes: LOG_MAX_BYTES, keep: LOG_KEEP });
    const startTime = processStartTime(process.pid);
    if (startTime === null) { io.stderr("orca-panel: cannot read this process's start time (ps -o lstart=); not taking the lock\n"); return 1; }
    const self = { pid: process.pid, startTime };
    const lock = acquirePanelLock(paths.lockFile, self, { startTimeOf: processStartTime });
    if (lock.kind === "held") {
      // Spec §5: exit 0 parks the job under launchd (SuccessfulExit:false) and is success under systemd (D1).
      io.stderr(`orca-panel: another panel (pid ${lock.holder.pid}) holds ${paths.lockFile}; this one exits\n`);
      return 0;
    }
    try {
      const { panelReadyLines, startPanelFromArgs } = await import("../panel/server.js");
      const started = await startPanelFromArgs(args, { service: true });
      writePanelJson(paths.panelJson, { ...self, url: started.url, socketPath: started.socketPath, version: orcaVersion() });
      const lines = panelReadyLines(started);
      io.stdout(lines.stdout);
      io.stderr(lines.stderr);
      await started.closed;
      removePanelJsonIfOurs(paths.panelJson, process.pid);
      return 0;
    } finally { lock.release(); }
  } catch (error) {
    if (error instanceof PanelRejection || error instanceof ServiceRejection) {
      io.stderr(`rejected: ${error.code}: ${error.message}\n`);
      return error instanceof PanelRejection ? error.exitCode : 1;
    }
    throw error;
  }
}
```

- [ ] **Step 6: Run** both test files → PASS. Then the regressions that touch the changed seams, each into its own file: `npx vitest run tests/panel/controlShutdown.test.ts tests/panel/endToEnd.test.ts tests/entry > $SCRATCH/t8r.txt 2>&1; echo rc=$?` → 0; `npm run typecheck` → 0.

- [ ] **Step 7: Mutations (clone `$SCRATCH/mut-t8`).** (a) delete `return { kind: "held", holder };` → live-holder unit test and live-lock process test red; (b) replace `probe.startTimeOf(holder.pid) === holder.startTime` with `probe.startTimeOf(holder.pid) !== null` → reused-pid tests red; (c) restore `server.once("error", reject)` → port-held test red (exit 3 ≠ 78); (d) delete `lock.release()` → port-held test red (lock left); (e) delete `removePanelJsonIfOurs(…)` in `runServicePanel` → SIGTERM test red; (f) delete the `size <= opts.maxBytes` guard → "under the limit" red; (g) delete the `--service` branch in `runPanel` → first process test red; (h) delete `if (readTextOrNull(file) === body)` in release → release test red. M-acc is recorded as pending (see Step 2 comment).

- [ ] **Step 8: Commit** `feat(service): one service panel at a time; exit 78 on a bind failure; rotate its logs`.

---

### Task 9: Identify, status, and discovery through `panel.json`

**Files:**
- Create: `src/service/identify.ts`, `src/service/status.ts`
- Modify: `src/entry/discovery.ts`, `tests/entry/discovery.test.ts` (explicit `ORCA_PANEL_DIR` in every env object it builds)
- Test: `tests/service/identify.test.ts`

**Interfaces:**
- Consumes: `readPanelJson`, `PanelJsonV1` (Task 8); `requestOverSocket` (`src/entry/socketClient.ts`); `EntryRejection`; `ManagerState` (Task 6); `panelDir` (Task 2).
- Produces:
  - `type Identity = { answering: true; panel: PanelJsonV1 } | { answering: false; panel: PanelJsonV1 | null; reason: string }`; `identifyPanel(panelJsonFile: string): Promise<Identity>`
  - `statusLines(kind: string, state: ManagerState, identity: Identity, errTail: string[], errLog: string): { lines: string[]; code: 0 | 1 }`
  - discovery: `panel.json`'s live socket is the first source after `--control-state-dir`; a `panel.json` that does not parse → `EntryRejection("control-panel-json-invalid", …)`.

- [ ] **Step 1: Write the failing test** `tests/service/identify.test.ts`:

```ts
import { createServer as createHttp, type Server } from "node:http";
import { createServer as createNet, type AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSocketPath } from "../../src/entry/discovery.js";
import { identifyPanel } from "../../src/service/identify.js";
import { writePanelJson } from "../../src/service/instance.js";
import { statusLines } from "../../src/service/status.js";

const roots: string[] = [];
const servers: Array<{ close(cb: () => void): void }> = [];
afterEach(async () => {
  while (servers.length) await new Promise<void>((done) => servers.pop()!.close(() => done()));
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
async function root() { const r = await mkdtemp(join(tmpdir(), "id-")); roots.push(r); return r; }
const answering = (status: number) => (req: { url?: string }, res: { writeHead(s: number, h: object): void; end(b: string): void }) => {
  res.writeHead(req.url === "/api/control/summary" || req.url === "/" ? status : 404, { "content-type": "application/json" });
  res.end("{}");
};
async function socketPanel(dir: string, status = 200): Promise<string> {
  const path = join(dir, "control.sock");
  const server: Server = createHttp(answering(status));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  servers.push(server);
  return path;
}
const body = (socketPath: string | null, url = "http://127.0.0.1:1") => ({ pid: 1, startTime: "s", url, socketPath, version: "0.1.0" });

describe("identify (spec §5: liveness is a request, never the pid alone)", () => {
  it("answers when the socket panel.json names serves the summary", async () => {
    const r = await root();
    writePanelJson(join(r, "panel.json"), body(await socketPanel(r)));
    expect((await identifyPanel(join(r, "panel.json"))).answering).toBe(true);
  });

  it("does not answer for a dead socket, a missing file or a broken file", async () => {
    const r = await root();
    writePanelJson(join(r, "panel.json"), body(join(r, "gone.sock")));
    expect(await identifyPanel(join(r, "panel.json"))).toMatchObject({ answering: false });
    expect(await identifyPanel(join(r, "none.json"))).toMatchObject({ answering: false, panel: null, reason: expect.stringContaining("no panel.json") });
    await writeFile(join(r, "bad.json"), "{");
    expect(await identifyPanel(join(r, "bad.json"))).toMatchObject({ answering: false, reason: expect.stringContaining("invalid") });
  });

  it("plan D12: with no socket, GET / on the panel's url", async () => {
    const r = await root();
    const server = createHttp(answering(200));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    writePanelJson(join(r, "panel.json"), body(null, `http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    expect((await identifyPanel(join(r, "panel.json"))).answering).toBe(true);
  });
});

describe("status (spec §4, §8)", () => {
  it("a manager that says running while the socket is dead is reported as not answering, with the log's last lines", () => {
    const s = statusLines("launchd", { loaded: true, state: "running", pid: 42 }, { answering: false, panel: null, reason: "panel-not-running" }, ["rejected: panel-bind-failed: 127.0.0.1:7777: EADDRINUSE"], "/l/panel.err.log");
    expect(s.code).toBe(1);
    expect(s.lines).toEqual([
      "manager: launchd running pid=42",
      "panel: not answering: panel-not-running",
      "last lines of /l/panel.err.log:",
      "  rejected: panel-bind-failed: 127.0.0.1:7777: EADDRINUSE",
    ]);
  });

  it("answers 0 only when the panel answered, and notes a pid the manager does not know", () => {
    const panel = body("/s/control.sock", "http://127.0.0.1:7777");
    const s = statusLines("systemd", { loaded: true, state: "active/running restarts=0", pid: 9 }, { answering: true, panel }, [], "/l");
    expect(s.code).toBe(0);
    expect(s.lines).toEqual([
      "manager: systemd active/running restarts=0 pid=9",
      "panel: answering at http://127.0.0.1:7777 (socket /s/control.sock, pid 1, version 0.1.0)",
      "note: the manager's pid 9 is not panel.json's pid 1",
    ]);
  });
});

describe("discovery reads panel.json first after the flag (spec §5)", () => {
  async function listenSocket(dir: string) {
    await mkdir(dir, { recursive: true });
    const server = createNet();
    await new Promise<void>((resolve) => server.listen(join(dir, "control.sock"), resolve));
    servers.push(server);
    return join(dir, "control.sock");
  }

  it("prefers a live panel.json socket over the projects file, and the flag over both", async () => {
    const r = await root();
    const live = await listenSocket(join(r, "svc"));
    await mkdir(join(r, "p"));
    writePanelJson(join(r, "p", "panel.json"), body(live));
    const projects = join(r, "projects.json");
    await writeFile(projects, JSON.stringify({ version: 1, controlStateDir: join(r, "fromfile"), projects: [] }));
    const env = { ORCA_PANEL_DIR: join(r, "p"), ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ env })).toBe(live);
    expect(discoverSocketPath({ stateDirFlag: join(r, "flag"), env })).toBe(join(r, "flag", "control.sock"));
  });

  it("falls through when panel.json names no socket or a path that is not one; refuses a broken panel.json", async () => {
    const r = await root();
    await mkdir(join(r, "p"));
    const env = { ORCA_PANEL_DIR: join(r, "p"), ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") };
    writePanelJson(join(r, "p", "panel.json"), body(null));
    expect(discoverSocketPath({ env })).toBe(join(r, "ctl", "panel", "control.sock"));
    writePanelJson(join(r, "p", "panel.json"), body(join(r, "not-a-socket")));
    expect(discoverSocketPath({ env })).toBe(join(r, "ctl", "panel", "control.sock"));
    await writeFile(join(r, "p", "panel.json"), "{");
    expect(() => discoverSocketPath({ env })).toThrow(expect.objectContaining({ code: "control-panel-json-invalid" }));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/service/identify.test.ts > $SCRATCH/t9.txt 2>&1; echo rc=$? >> $SCRATCH/t9.txt`; read whole. Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `src/service/identify.ts`:

```ts
import { requestOverSocket } from "../entry/socketClient.js";
import { EntryRejection } from "../entry/envelope.js";
import { readPanelJson, type PanelJsonV1 } from "./instance.js";

export type Identity = { answering: true; panel: PanelJsonV1 } | { answering: false; panel: PanelJsonV1 | null; reason: string };

/** Spec §5 / plan D12: a real request to the panel panel.json names -- over its socket, else GET / on its url. */
export async function identifyPanel(panelJsonFile: string): Promise<Identity> {
  const read = readPanelJson(panelJsonFile);
  if (read.kind === "missing") return { answering: false, panel: null, reason: `no panel.json at ${panelJsonFile}` };
  if (read.kind === "invalid") return { answering: false, panel: null, reason: `panel.json invalid: ${read.reason}` };
  const panel = read.body;
  try {
    if (panel.socketPath !== null) {
      const answer = await requestOverSocket({ socketPath: panel.socketPath, method: "GET", path: "summary", client: "cli:orca-service-status", timeoutMs: 5_000 });
      return answer.status === 200 ? { answering: true, panel } : { answering: false, panel, reason: `summary answered ${answer.status}` };
    }
    const response = await fetch(`${panel.url}/`, { signal: AbortSignal.timeout(5_000) });
    return response.status === 200 ? { answering: true, panel } : { answering: false, panel, reason: `GET / answered ${response.status}` };
  } catch (error) {
    return { answering: false, panel, reason: error instanceof EntryRejection ? `${error.code}: ${error.message}` : String(error) };
  }
}
```

(Read `src/entry/envelope.ts` for `EntryRejection`'s field names; it exposes `code`.)

`src/service/status.ts`:

```ts
import type { Identity } from "./identify.js";
import type { ManagerState } from "./manager.js";

/** Spec §4: the manager's view and a real request, never the manager's exit code alone. Exit 0 only when answered. */
export function statusLines(kind: string, state: ManagerState, identity: Identity, errTail: string[], errLog: string): { lines: string[]; code: 0 | 1 } {
  const lines = [`manager: ${kind} ${state.loaded ? state.state : "not loaded"} pid=${state.pid ?? "-"}`];
  if (identity.answering) {
    const p = identity.panel;
    lines.push(`panel: answering at ${p.url} (socket ${p.socketPath ?? "none"}, pid ${p.pid}, version ${p.version})`);
    if (state.pid !== null && state.pid !== p.pid) lines.push(`note: the manager's pid ${state.pid} is not panel.json's pid ${p.pid}`);
    return { lines, code: 0 };
  }
  lines.push(`panel: not answering: ${identity.reason}`);
  if (errTail.length > 0) lines.push(`last lines of ${errLog}:`, ...errTail.map((line) => `  ${line}`));
  return { lines, code: 1 };
}
```

`src/entry/discovery.ts`: import `panelDir` from `../service/paths.js` and `readPanelJson` from `../service/instance.js`; after the `stateDirFlag` block insert:

```ts
  // Panel service spec §5: the service panel says where its socket is. A panel.json that does not parse is refused by
  // name (like a broken projects file); one that names no socket, or a path that is no longer a socket, falls through.
  const serviceJson = join(panelDir(input.env), "panel.json");
  const service = readPanelJson(serviceJson);
  if (service.kind === "invalid") throw new EntryRejection("control-panel-json-invalid", `${serviceJson}: ${service.reason}`);
  if (service.kind === "valid" && service.body.socketPath !== null && isSocket(service.body.socketPath)) return service.body.socketPath;
```

Update the doc comment's order sentence and the `orca control` USAGE line in `src/cli.ts` (`found from --control-state-dir, the service's panel.json, the projects file's controlStateDir, …`).

`tests/entry/discovery.test.ts`: every `env` object a test passes to `discoverSocketPath` gets `ORCA_PANEL_DIR: join(r, "no-panel")` (and the HOME-stubbed line too). Then grep `tests/` for other callers that pass an explicit env object to `discoverSocketPath`, `runControlCommand` or `runMcpServe` and do the same. Ruling to record: tightening, intent unchanged — without it the criteria would read the person's real `~/.orca/panel/panel.json` once the service is installed (Rule 17).

- [ ] **Step 4: Run** the new file and `npx vitest run tests/entry > $SCRATCH/t9e.txt 2>&1; echo rc=$?` → both PASS. Typecheck → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t9`).** (a) in `statusLines` return `code: state.loaded ? 0 : 1` without consulting identity → running-but-dead red; (b) delete the `panel.json` block in discovery → discovery-first red; (c) treat `invalid` as missing in discovery → refusal red; (d) delete the TCP fallback (`socketPath === null` → not answering) → D12 red; (e) delete the `errTail` lines → status test red; (f) revert the `ORCA_PANEL_DIR` additions in `tests/entry/discovery.test.ts` and write a `panel.json` pointing at a live socket into the setup's relocated `ORCA_PANEL_DIR` → the existing order test goes red, which is what would happen against a real home (record as the justification for the ruling).

- [ ] **Step 6: Commit** `feat(service): status asks the panel itself; agents find the service panel via panel.json`.

---

### Task 10: The detached fallback

**Files:**
- Create: `src/service/detached.ts`, `tests/service/fixtures/fakePanel.mjs`
- Test: `tests/service/detached.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6 (`ServiceManager`, `waitExit`, `fakeContext`), 8 (`readPanelJson`), 9 (`identifyPanel`).
- Produces: `detached: ServiceManager`; `DETACHED_NOTICE = "orca panel: no service manager: started as a detached process, which neither restarts on crash nor survives a reboot"`.

- [ ] **Step 1: Write the fixture** `tests/service/fixtures/fakePanel.mjs` — stands in for `dist/cli.js` so the criterion tests process handling, not the panel:

```js
// A stand-in for `node dist/cli.js panel run --service`: serves the summary on a socket and writes panel.json.
import { spawnSync } from "node:child_process";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.env.ORCA_PANEL_DIR;
const socketPath = join(dir, "s.sock");
const startTime = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).stdout.trim();
const server = createServer((req, res) => {
  res.writeHead(req.url === "/api/control/summary" ? 200 : 404, { "content-type": "application/json" });
  res.end("{}");
});
server.listen(socketPath, () => {
  writeFileSync(join(dir, "panel.json.tmp"), JSON.stringify({ pid: process.pid, startTime, url: "http://127.0.0.1:1", socketPath, version: "fake" }), { mode: 0o600 });
  renameSync(join(dir, "panel.json.tmp"), join(dir, "panel.json"));
  process.stderr.write("fake-panel ready\n");
});
process.on("SIGTERM", () => server.close(() => { try { unlinkSync(join(dir, "panel.json")); } catch {} process.exit(0); }));
```

- [ ] **Step 2: Write the failing test** `tests/service/detached.test.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detached } from "../../src/service/detached.js";
import { writeServiceFiles } from "../../src/service/files.js";
import { identifyPanel } from "../../src/service/identify.js";
import { readPanelJson } from "../../src/service/instance.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";
import { servicePaths } from "../../src/service/paths.js";
import { fakeContext, fakeTools } from "./fixtures/fakeTools.js";

const roots: string[] = [];
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function installed() {
  const r = await mkdtemp(join(tmpdir(), "dt-"));
  roots.push(r);
  const paths = servicePaths({ ORCA_PANEL_DIR: join(r, "p") });
  writeServiceFiles(paths, {
    schema: "orca-panel-service-v1", node: process.execPath, entry: join(process.cwd(), "tests", "service", "fixtures", "fakePanel.mjs"),
    args: [], env: { HOME: r, NODE_OPTIONS: "", ORCA_PANEL_DIR: paths.panelDir, PATH: "/usr/bin:/bin" },
  });
  return { r, paths };
}
const cli = (args: string[], env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; out: string; err: string; pid: number }>((resolve) => {
  // Its own process group, which the test kills afterwards like a closing terminal would.
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, detached: true });
  let out = "", err = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr.on("data", (c: Buffer) => (err += c.toString()));
  child.on("close", (code) => resolve({ code, out, err, pid: child.pid! }));
});

describe("detached fallback (spec §2, §8)", () => {
  it("start survives its parent and its parent's process group; stop verifies the start time before SIGTERM", async () => {
    const { paths } = await installed();
    const env = { ORCA_PANEL_DIR: paths.panelDir, ORCA_SERVICE_MANAGER: "detached" };
    const started = await cli(["panel", "start", "--detach"], env);
    expect(started.code, started.err).toBe(0);
    expect(started.out + started.err).toContain("neither restarts on crash nor survives a reboot");
    try { process.kill(-started.pid, "SIGTERM"); } catch { /* the group may already be empty */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const json = readPanelJson(paths.panelJson);
    expect(json.kind).toBe("valid");
    if (json.kind !== "valid") return;
    pids.push(json.body.pid);
    expect((await identifyPanel(paths.panelJson)).answering).toBe(true);

    const real = readFileSync(paths.panelJson, "utf8");
    writeFileSync(paths.panelJson, JSON.stringify({ ...json.body, startTime: "Thu Jan  1 00:00:00 1970" }));
    const refused = await cli(["panel", "stop"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("not the panel");
    expect(isProcessAlive(json.body.pid)).toBe(true);

    writeFileSync(paths.panelJson, real);
    const stopped = await cli(["panel", "stop"], env);
    expect(stopped.code, stopped.err).toBe(0);
    expect(isProcessAlive(json.body.pid)).toBe(false);
    expect(existsSync(paths.panelJson)).toBe(false);
  }, 90_000);

  it("start is a no-op when the panel already answers; state reads panel.json", async () => {
    const { r, paths } = await installed();
    const { ctx } = fakeContext(await fakeTools(r), paths, { startTimeOf: processStartTime, isAlive: isProcessAlive, sleep: (ms) => new Promise((x) => setTimeout(x, ms)), now: Date.now });
    expect(await detached.start(ctx)).toBe(0);
    const json = readPanelJson(paths.panelJson);
    if (json.kind === "valid") pids.push(json.body.pid);
    expect(await detached.start(ctx)).toBe(0);
    expect(detached.state(ctx)).toMatchObject({ loaded: true, state: "running" });
    expect(await detached.stop(ctx)).toBe(0);
    expect(detached.state(ctx)).toEqual({ loaded: false, state: "not running", pid: null });
  }, 60_000);
});
```

- [ ] **Step 3: Run** `npx vitest run tests/service/detached.test.ts > $SCRATCH/t10.txt 2>&1; echo rc=$? >> $SCRATCH/t10.txt`; read whole. Expected: FAIL (module not found; the CLI test fails until Task 11 wires `panel start` — that is expected here; it turns green at the end of Task 11, record it).

- [ ] **Step 4: Implement** `src/service/detached.ts`:

```ts
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { ensurePrivateDir, ensurePrivateFile } from "./files.js";
import { identifyPanel } from "./identify.js";
import { readPanelJson } from "./instance.js";
import { waitExit, type ManagerState, type ServiceContext, type ServiceManager } from "./manager.js";

export const DETACHED_NOTICE = "orca panel: no service manager: started as a detached process, which neither restarts on crash nor survives a reboot";

/** The pid panel.json names, only if it still has the start time panel.json recorded (spec §8). */
function ownPanel(ctx: ServiceContext): { pid: number; startTime: string; now: string | null } | null {
  const read = readPanelJson(ctx.paths.panelJson);
  if (read.kind !== "valid") return null;
  return { pid: read.body.pid, startTime: read.body.startTime, now: ctx.startTimeOf(read.body.pid) };
}

export const detached: ServiceManager = {
  kind: "detached",
  async install(ctx) { ctx.out("orca panel: installed without a service manager; start it with orca panel start --detach"); return 0; },
  async start(ctx) {
    const current = await identifyPanel(ctx.paths.panelJson);
    if (current.answering) { ctx.out(`orca panel: already answering at ${current.panel.url}`); return 0; }
    if (!existsSync(ctx.paths.runScript)) { ctx.err("orca panel: not installed (no run.sh); run orca panel install first"); return 1; }
    ensurePrivateDir(ctx.paths.logsDir);
    ensurePrivateFile(ctx.paths.outLog);
    ensurePrivateFile(ctx.paths.errLog);
    const outFd = openSync(ctx.paths.outLog, "a");
    const errFd = openSync(ctx.paths.errLog, "a");
    let pid: number | undefined;
    try {
      // Spec §2: its own session (detached), output to the log files, nothing tying it to this process.
      const child = spawn("/bin/sh", [ctx.paths.runScript], { cwd: ctx.paths.panelDir, detached: true, stdio: ["ignore", outFd, errFd], env: { HOME: ctx.env.HOME ?? "", PATH: "/usr/bin:/bin" } });
      pid = child.pid;
      child.unref();
    } finally { closeSync(outFd); closeSync(errFd); }
    ctx.out(DETACHED_NOTICE);
    const deadline = ctx.now() + ctx.startWaitMs;
    for (;;) {
      const id = await identifyPanel(ctx.paths.panelJson);
      if (id.answering && id.panel.pid === pid) { ctx.out(`orca panel: answering at ${id.panel.url} (pid ${pid})`); return 0; }
      if (pid === undefined || !ctx.isAlive(pid)) { ctx.err(`orca panel: the panel exited during start; see ${ctx.paths.errLog}`); return 1; }
      if (ctx.now() >= deadline) { ctx.err(`orca panel: no answer within ${ctx.startWaitMs} ms; see ${ctx.paths.errLog}`); return 1; }
      await ctx.sleep(200);
    }
  },
  async stop(ctx) {
    const own = ownPanel(ctx);
    if (own === null || own.now === null) { ctx.out("orca panel: not running; nothing to stop"); return 0; }
    if (own.now !== own.startTime) {
      ctx.err(`orca panel: pid ${own.pid} started at ${own.now}, not at ${own.startTime}: it is not the panel panel.json names, so it is not signalled`);
      return 1;
    }
    process.kill(own.pid, "SIGTERM");
    if (!(await waitExit(ctx, own.pid))) { ctx.err(`orca panel: pid ${own.pid} did not exit within ${ctx.exitWaitMs} ms`); return 1; }
    return 0;
  },
  async restart(ctx) {
    const stopped = await detached.stop(ctx);
    return stopped !== 0 ? stopped : detached.start(ctx);
  },
  state(ctx): ManagerState {
    const own = ownPanel(ctx);
    return own !== null && own.now === own.startTime ? { loaded: true, state: "running", pid: own.pid } : { loaded: false, state: "not running", pid: null };
  },
  logs(ctx, opts) {
    return ctx.run("tail", ["-n", String(opts.lines), ...(opts.follow ? ["-F"] : []), ctx.paths.outLog, ctx.paths.errLog], { env: ctx.env, inherit: true }).code;
  },
  async uninstall(ctx) {
    const stopped = await detached.stop(ctx);
    if (stopped !== 0) return stopped;
    rmSync(ctx.paths.runScript, { force: true });
    return 0;
  },
};
```

- [ ] **Step 5: Run** the second test (`-t "no-op"`) → PASS now; the first passes after Task 11 (re-run it there).

- [ ] **Step 6: Mutations (clone `$SCRATCH/mut-t10`, after Task 11 lands so the CLI test runs).** (a) delete the `own.now !== own.startTime` guard → mismatch test red (process killed); (b) `detached: true` → `detached: false` → group-kill test red; (c) delete `child.unref()` → the `panel start` child never exits → vitest timeout red; (d) delete the `id.panel.pid === pid` clause → record whether anything goes red (a previous panel's json could satisfy it; if green, record as equivalent on this fixture).

- [ ] **Step 7: Commit** `feat(service): a detached fallback that says it neither restarts nor survives a reboot`.

---

### Task 11: `orca panel <subcommand>` — wiring, dry run, USAGE, skill

**Files:**
- Create: `src/service/command.ts`
- Modify: `src/cli.ts` (dispatch, USAGE), `skills/orca-control/SKILL.md`, `tests/panel/usage.test.ts`
- Test: `tests/service/command.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `SERVICE_SUBCOMMANDS = ["install", "uninstall", "start", "stop", "restart", "status", "logs"] as const`; `selectManager(input: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; detach: boolean; run: RunTool; uid: number }): { manager: ServiceManager; auto: boolean }` (throws `ServiceRejection`); `runServiceCommand(sub: string, args: string[], env: NodeJS.ProcessEnv, io: ServiceIo): Promise<number>`.

- [ ] **Step 1: Write the failing test** `tests/service/command.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { selectManager } from "../../src/service/command.js";
import { servicePaths } from "../../src/service/paths.js";
import { runTool } from "../../src/service/tools.js";
import { captureStreams } from "../scheduler/sandbox.js";
import { fakeTools } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function setup() {
  const r = await mkdtemp(join(tmpdir(), "cm-"));
  roots.push(r);
  const checkout = join(r, "orca");
  await mkdir(join(checkout, "src"), { recursive: true });
  await mkdir(join(checkout, "dist"));
  await writeFile(join(checkout, "src", "a.ts"), "\n");
  await utimes(join(checkout, "src", "a.ts"), new Date("2026-01-01"), new Date("2026-01-01"));
  await writeFile(join(checkout, "dist", "cli.js"), "\n");
  const fake = await fakeTools(r);
  await fake.output("launchctl", "managername", "Aqua\n");
  const env = {
    ...fake.env, ORCA_SERVICE_MANAGER: "launchd", ORCA_SERVICE_CHECKOUT: checkout,
    ORCA_PANEL_DIR: join(r, "p"), ORCA_LAUNCH_AGENTS_DIR: join(r, "la"), ORCA_SYSTEMD_USER_DIR: join(r, "su"),
    ORCA_SERVICE_LABEL: "dev.orca.panel.cmd", ORCA_CCMEM_BIN: "/usr/local/bin/ccmem", ORCA_UNRELATED: "x",
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return { r, fake, paths: servicePaths(env) };
}
const install = ["panel", "install", "--by", "ann", "--port", "7777", "--repo", "orca=/src/orca-web"];

describe("orca panel <subcommand> (spec §4)", () => {
  it("install --dry-run prints every file it would write and runs nothing (plan D17)", async () => {
    const s = await setup();
    const { result, stdout } = await captureStreams(() => main([...install.slice(0, 2), "--dry-run", ...install.slice(2)]));
    expect(result).toBe(0);
    for (const path of [s.paths.configFile, s.paths.envFile, s.paths.runScript, s.paths.plistFile]) expect(stdout).toContain(`--- ${path}`);
    expect(stdout).toContain("<key>Label</key>");
    expect(stdout).toContain('ORCA_CCMEM_BIN="/usr/local/bin/ccmem"');
    expect(stdout).not.toContain("ORCA_UNRELATED");
    expect([existsSync(s.paths.panelDir), await s.fake.calls()]).toEqual([false, []]);
  });

  it("install writes the files 0600 and loads the LaunchAgent", async () => {
    const s = await setup();
    const { result } = await captureStreams(() => main(install));
    expect(result).toBe(0);
    expect((JSON.parse(readFileSync(s.paths.configFile, "utf8")) as { args: string[] }).args).toEqual(install.slice(2));
    expect([statSync(s.paths.panelDir).mode & 0o777, statSync(s.paths.configFile).mode & 0o777]).toEqual([0o700, 0o600]);
    expect(await s.fake.calls()).toEqual(["launchctl managername", "launchctl bootout gui/" + process.getuid!() + "/dev.orca.panel.cmd",
      "launchctl enable gui/" + process.getuid!() + "/dev.orca.panel.cmd", `launchctl bootstrap gui/${process.getuid!()} ${s.paths.plistFile}`]);
  });

  it("status reports a running job whose panel does not answer as not answering, exit 1", async () => {
    const s = await setup();
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { result, stdout } = await captureStreams(() => main(["panel", "status"]));
    expect(result).toBe(1);
    expect(stdout).toContain("manager: launchd running pid=4242");
    expect(stdout).toContain("panel: not answering");
  });

  it("refuses bad arguments and an unknown manager by name", async () => {
    await setup();
    expect((await captureStreams(() => main(["panel", "logs", "-n", "x"]))).stderr).toContain("service-argument-invalid");
    expect((await captureStreams(() => main(["panel", "stop", "--now"]))).stderr).toContain("service-argument-invalid");
    vi.stubEnv("ORCA_SERVICE_MANAGER", "upstart");
    expect((await captureStreams(() => main(["panel", "status"]))).stderr).toContain("service-manager-invalid");
  });

  it("panel run is the foreground panel, and the old form is its alias", async () => {
    for (const argv of [["panel", "run", "--port", "0"], ["panel", "--port", "0"]]) {
      const { result, stderr } = await captureStreams(() => main(argv));
      expect([result, stderr.includes("no-viewer-identity")]).toEqual([1, true]);
    }
  });
});

describe("manager selection (spec §2, plan D14)", () => {
  it("launchd on macOS, systemd when the user manager answers, detached otherwise; --detach forces detached", async () => {
    const r = await mkdtemp(join(tmpdir(), "ms-"));
    roots.push(r);
    const fake = await fakeTools(r);
    const env = { ...process.env, ...fake.env, ORCA_SERVICE_MANAGER: "" };
    const pick = (platform: NodeJS.Platform, detach = false) => selectManager({ env, platform, detach, run: runTool, uid: process.getuid!() }).manager.kind;
    expect(pick("darwin")).toBe("launchd");
    expect(pick("darwin", true)).toBe("detached");
    expect(pick("linux")).toBe("systemd");
    await fake.codes("systemctl", "show-environment", [1]);
    expect(pick("linux")).toBe("detached");
    expect(() => pick("win32")).toThrow(expect.objectContaining({ code: "service-platform-unsupported" }));
  });
});
```

Add to `tests/panel/usage.test.ts`:

```ts
  it("documents the panel service commands (panel service spec §2, §4)", async () => {
    const { stderr } = await captureStreams(() => main([]));
    for (const text of ["orca panel run --by <who>", "orca panel install", "orca panel status", "orca panel logs [-f] [-n <lines>]",
      "orca panel start [--detach]", "neither restarts on crash nor survives a reboot", "ask the person"]) expect(stderr).toContain(text);
  });
```

- [ ] **Step 2: Run** `npx vitest run tests/service/command.test.ts tests/panel/usage.test.ts > $SCRATCH/t11.txt 2>&1; echo rc=$? >> $SCRATCH/t11.txt`; read whole. Expected: FAIL.

- [ ] **Step 3: Implement** `src/service/command.ts`:

```ts
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServiceConfig } from "./config.js";
import { detached } from "./detached.js";
import { readServiceConfig, tailLines, writeServiceFiles } from "./files.js";
import { identifyPanel } from "./identify.js";
import { launchd } from "./launchd.js";
import { defaultContext, type ServiceIo, type ServiceManager } from "./manager.js";
import { servicePaths } from "./paths.js";
import { ServiceRejection } from "./rejection.js";
import { renderPlist, renderRunSh, renderServiceEnv, renderUnit } from "./render.js";
import { statusLines } from "./status.js";
import { realRuntimeProbe, systemd, systemdEnv } from "./systemd.js";
import { runTool, type RunTool } from "./tools.js";

export const SERVICE_SUBCOMMANDS = ["install", "uninstall", "start", "stop", "restart", "status", "logs"] as const;
const MANAGERS: Record<string, ServiceManager> = { launchd, systemd, detached };

export function selectManager(input: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; detach: boolean; run: RunTool; uid: number }): { manager: ServiceManager; auto: boolean } {
  const forced = input.env.ORCA_SERVICE_MANAGER;
  if (forced !== undefined && forced !== "") {
    const manager = MANAGERS[forced];
    if (manager === undefined) throw new ServiceRejection("service-manager-invalid", `ORCA_SERVICE_MANAGER=${forced}: want launchd, systemd or detached`);
    return { manager, auto: false };
  }
  if (input.detach) return { manager: detached, auto: false };
  if (input.platform === "darwin") return { manager: launchd, auto: true };
  if (input.platform === "linux") {
    const answer = input.run("systemctl", ["--user", "show-environment"], { env: systemdEnv(input.env, input.uid, realRuntimeProbe) });
    return { manager: answer.code === 0 ? systemd : detached, auto: true };
  }
  throw new ServiceRejection("service-platform-unsupported", `orca panel services run on macOS and Linux, not ${input.platform}`);
}

const defaultCheckout = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseLogs(args: string[]): { follow: boolean; lines: number } {
  let follow = false, lines = 200;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-f") { follow = true; continue; }
    if (args[i] === "-n" && /^[1-9]\d{0,5}$/.test(args[i + 1] ?? "")) { lines = Number(args[i + 1]); i += 1; continue; }
    throw new ServiceRejection("service-argument-invalid", `orca panel logs takes -f and -n <lines>, not ${JSON.stringify(args[i])}`);
  }
  return { follow, lines };
}

export async function runServiceCommand(sub: string, args: string[], env: NodeJS.ProcessEnv, io: ServiceIo): Promise<number> {
  try {
    const paths = servicePaths(env);
    const ctx = defaultContext(env, paths, io);
    const detach = sub === "start" && args.includes("--detach");
    const rest = sub === "install" ? args.filter((a) => a !== "--dry-run") : args.filter((a) => !(sub === "start" && a === "--detach"));
    if (sub !== "install" && sub !== "logs" && rest.length > 0) throw new ServiceRejection("service-argument-invalid", `orca panel ${sub} takes no ${JSON.stringify(rest[0])}`);
    const { manager, auto } = selectManager({ env, platform: process.platform, detach, run: runTool, uid: ctx.uid });
    switch (sub) {
      case "install": {
        const { config, warnings } = buildServiceConfig({
          args: rest, env, execPath: process.execPath, checkout: env.ORCA_SERVICE_CHECKOUT || defaultCheckout(), home: homedir(), panelDir: paths.panelDir,
        });
        for (const warning of warnings) ctx.err(`orca panel: warning: ${warning}`);
        if (args.includes("--dry-run")) {
          const files: Array<[string, string]> = [[paths.configFile, `${JSON.stringify(config, null, 2)}\n`], [paths.envFile, renderServiceEnv(config)], [paths.runScript, renderRunSh(config, paths)]];
          if (manager.kind === "launchd") files.push([paths.plistFile, renderPlist(paths)]);
          if (manager.kind === "systemd") files.push([paths.unitFile, renderUnit(config, paths)]);
          for (const [path, text] of files) io.stdout(`--- ${path}\n${text}`);
          return 0;
        }
        writeServiceFiles(paths, config);
        return manager.install(ctx);
      }
      case "start":
        // Plan D14: with no manager the person types --detach, accepting no restart and no reboot survival.
        if (manager.kind === "detached" && auto && !detach) throw new ServiceRejection("service-detach-required", "no service manager here; orca panel start --detach starts a process that neither restarts on crash nor survives a reboot");
        return manager.start(ctx);
      case "stop": return manager.stop(ctx);
      case "restart": writeServiceFiles(paths, readServiceConfig(paths)); return manager.restart(ctx); // plan D20
      case "status": {
        const s = statusLines(manager.kind, manager.state(ctx), await identifyPanel(paths.panelJson), manager.kind === "systemd" ? [] : tailLines(paths.errLog, 5), paths.errLog);
        for (const line of s.lines) ctx.out(line);
        return s.code;
      }
      case "logs": return manager.logs(ctx, parseLogs(rest));
      case "uninstall": return manager.uninstall(ctx);
      default: throw new ServiceRejection("service-argument-invalid", `unknown orca panel subcommand ${sub}`);
    }
  } catch (error) {
    if (error instanceof ServiceRejection) { io.stderr(`rejected: ${error.code}: ${error.message}\n`); return 1; }
    throw error;
  }
}
```

Note `selectManager`'s auto case: `"detached"` is reachable as `auto` only on Linux without a user manager. `ORCA_SERVICE_MANAGER=detached` is `auto: false`, so the Task 10 CLI criterion passes `--detach` anyway.

`src/cli.ts` `main`: replace the `panel` branch with

```ts
  if (command === "panel") {
    const sub = rest[0];
    if (sub === "run") return runPanel(rest.slice(1));
    const { SERVICE_SUBCOMMANDS, runServiceCommand } = await import("./service/command.js");
    if (sub !== undefined && (SERVICE_SUBCOMMANDS as readonly string[]).includes(sub)) {
      return runServiceCommand(sub, rest.slice(1), process.env, { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) });
    }
    return runPanel(rest); // spec §2: the old form is kept as an alias of `orca panel run`
  }
```

USAGE: change the panel entry's first line to `orca panel run --by <who> [--port <n>] …` and add after its description (keep every existing sentence — `usage.test.ts` pins several):

```
                                 \`orca panel <args>\` is the same command (kept as an alias).
  orca panel install [--dry-run] <orca panel run args>
                                 record the args and the named ORCA_* variables in ~/.orca/panel/service.json
                                 and install a per-user service: a launchd LaunchAgent on macOS, a systemd user
                                 unit on Linux. Runs node dist/cli.js (npm run build first). --dry-run prints the
                                 files and runs nothing
  orca panel start [--detach] | stop | restart | uninstall
                                 drive that service. Without a service manager, start --detach starts a process
                                 that neither restarts on crash nor survives a reboot. These touch the person's
                                 running system: an agent does not run them, it should ask the person
  orca panel status              the manager's view and a real request to the panel; exit 0 only if it answered
  orca panel logs [-f] [-n <lines>]
                                 the panel's log files (macOS, detached) or its journal (Linux)
```

`skills/orca-control/SKILL.md` §1, after "You must never start a panel" bullet, add:

```
- `orca panel install|uninstall|start|stop|restart` change the human's running service. Never run them; ask the human. `orca panel status` is read-only and safe to run.
```

Then re-run `tests/entry/skill.test.ts` (it counts routes; this line names none). Before changing the USAGE panel line, `grep -rn "orca panel --by" tests scripts` and keep every pinned substring (or update the pin in the same commit and record why).

- [ ] **Step 4: Run** `tests/service/command.test.ts`, `tests/panel/usage.test.ts`, `tests/entry/skill.test.ts`, and now `tests/service/detached.test.ts` (both tests) → PASS. Typecheck → 0.

- [ ] **Step 5: Mutations (clone `$SCRATCH/mut-t11`).** (a) delete the `--dry-run` early return → dry-run test red (tools called, dir created); (b) delete the `sub === "run"` branch → alias test still green? (falls through to `runPanel(rest)` with `run` as an arg — `--by` still missing → same refusal) — record as equivalent and instead mutate (b') `runPanel(rest)` → `return 1` for the alias → alias test red; (c) delete the `forced` validation → manager-invalid red; (d) delete the `show-environment` check (always systemd) → selection red; (e) delete `parseLogs`'s throw → logs refusal red; (f) delete the `service-detach-required` throw → add-on: covered by selection only — record; (g) Task 10 mutations (a)–(d) now.

- [ ] **Step 6: Commit** `feat(cli): orca panel install/start/stop/restart/status/logs/uninstall`.

---

### Task 12: Opt-in real smoke (macOS, relocated label)

**Files:**
- Create: `tests/service/realSmoke.test.ts`

**Interfaces:**
- Consumes: the built `dist/cli.js` (Task 1), the whole CLI.

- [ ] **Step 1: Write the smoke.** Gated at run time (`beforeEach((ctx) => { if (!real) ctx.skip(); })`, not `describe.skipIf` — see `tests/setup/scopeTmpdir.ts` ERRATUM):

```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { checkDist } from "../../src/service/config.js";
import { DEFAULT_SERVICE_LABEL } from "../../src/service/paths.js";

/**
 * Spec §8: one real smoke, opt-in (ORCA_SERVICE_REAL=1), macOS only, under a relocated label and state dir.
 * Never the human's service: the label is dev.orca.panel.smoke-<random>, every path is under a temp root.
 * Not run by the gate. Run it only when the human authorizes it: `npm run build && ORCA_SERVICE_REAL=1 npx vitest run tests/service/realSmoke.test.ts`.
 */
const real = process.env.ORCA_SERVICE_REAL === "1" && process.platform === "darwin";
beforeEach((ctx) => { if (!real) ctx.skip(); });

let root = "";
let env: NodeJS.ProcessEnv = {};
const label = `dev.orca.panel.smoke-${randomBytes(4).toString("hex")}`;
const orca = (...args: string[]) => spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "panel", ...args], { encoding: "utf8", env });
async function untilStatus(code: number, ms = 30_000): Promise<string> {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = orca("status");
    if (s.status === code) return s.stdout;
    if (Date.now() > deadline) throw new Error(`status never exited ${code}: ${s.stdout}${s.stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
afterAll(async () => {
  if (!real || root === "") return;
  spawnSync("launchctl", ["bootout", `gui/${process.getuid!()}/${label}`]);
  await rm(root, { recursive: true, force: true });
});

describe("real launchd smoke (opt-in)", () => {
  it("install → answering → restart → stop → start → uninstall, under a relocated label", async () => {
    expect(label).not.toBe(DEFAULT_SERVICE_LABEL);
    checkDist(process.cwd());
    root = await mkdtemp(join(tmpdir(), "rs-"));
    for (const d of ["repo", "web", "la", "c", "k"]) await mkdir(join(root, d));
    await writeFile(join(root, "web", "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
    env = {
      ...process.env, ORCA_SERVICE_LABEL: label, ORCA_PANEL_DIR: join(root, "p"), ORCA_LAUNCH_AGENTS_DIR: join(root, "la"),
      ORCA_CONTROL_DIR: join(root, "c"), ORCA_CORRECTIONS_DIR: join(root, "k"), ORCA_PROJECTS_FILE: join(root, "projects.json"),
      ORCA_SERVICE_MANAGER: "launchd", ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "",
    };
    const installed = orca("install", "--by", "smoke", "--repo", `s=${join(root, "repo")}`, "--port", "0", "--dist", join(root, "web"));
    expect(installed.status, installed.stderr).toBe(0);
    const first = await untilStatus(0);
    expect(orca("restart").status).toBe(0);
    const second = await untilStatus(0);
    expect(second).not.toBe(first); // a new pid
    expect(orca("stop").status).toBe(0);
    await untilStatus(1);
    expect(orca("start").status).toBe(0);
    await untilStatus(0);
    expect(orca("uninstall").status).toBe(0);
    expect(spawnSync("launchctl", ["print", `gui/${process.getuid!()}/${label}`]).status).not.toBe(0);
    expect(existsSync(join(root, "la", `${label}.plist`))).toBe(false);
  }, 180_000);
});
```

(`ORCA_AGENTS_TABLE: ""` and `ORCA_CCLOOP_BIN: ""` are empty, so `buildServiceConfig` captures neither — the smoke service has no execution port.)

- [ ] **Step 2: Run without the flag** `npx vitest run tests/service/realSmoke.test.ts > $SCRATCH/t12.txt 2>&1; echo rc=$?` → rc 0, 1 skipped. The real run is listed under awaitingHuman; the executing agent runs it only if the human authorizes it in that session, and records the result with the commit.

- [ ] **Step 3: Commit** `test(service): an opt-in real launchd smoke under a relocated label`.

---

### Task 13: Gates, mutation evidence and ledger

**Files:** Modify: `.superpowers/sdd/2026-10-07-panel-service/progress.md` (append only)

- [ ] **Step 1: Isolated clone gate.** In `$SCRATCH/orca-svc-gate` (`git clone --local` at the final commit), with HOME, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` relocated into the scratchpad and a short real `TMPDIR` (e.g. `/private/tmp/claude-501/<short>/t`), `ORCA_CCLOOP_BIN` = a build of the pinned ccloop commit (`package.json`'s `ccloop` SHA) from a `git clone --local` of ccloop, `ORCA_AGENTS_TABLE` = the fake-codex `integration` table the N2 gate used: `npm ci`, then each into its own file with `echo rc=$?` appended: `npm run build`, `npm run typecheck`, `npm run build --workspace web`, `npm run --ws check`, `npm run verify:panel`, `npm run verify:control`, `npm test`, `node scripts/check-tmp-leak.mjs`. Read every file whole (Rule 14).
- [ ] **Step 2: Built-dist smoke (D4 layout).** In the clone, with the relocated HOME: `node dist/cli.js panel run --service --by gate --repo g=$SCRATCH/gate-repo --port 0` with stdout/stderr to files; wait for the ready line (poll the file ≤ 30 s), check `$HOME/.orca/panel/panel.json` exists (relocated HOME) and `node dist/cli.js panel status` with `ORCA_SERVICE_MANAGER=detached` answers rc 0; then SIGTERM → rc 0 and `panel.json` gone. Record the commands, rcs and files.
- [ ] **Step 3: Known flakes.** A failure in gateCheck K13, driverRequirementSplit, driverRecovery, controlShutdown 143, agentSelectionE2E C3, driverLanding, driverProgress R2, executionDriverE2E, ccloopPort, web controlCommandRecovery or web agentPreviewRefresh is re-run alone three times and recorded with load averages (`uptime`); any other failure is a real failure and gets fixed. The opt-in smoke is reported as skipped by name.
- [ ] **Step 4: Mutation table.** Collect every mutation from Tasks 1–11 into one table: mutation, criterion, observed red (test name + assertion), restore proof (`git diff | wc -c` and `git diff --cached | wc -c` = 0 in the clone). Equivalent mutants listed as such. M-acc listed as pending on the accounts plan.
- [ ] **Step 5: Append to the ledger** the gate table (command, rc, counts, load, commit subject), the mutation table, decisions D1–D20 and every execution-time ruling. Commit `docs(sdd): close the panel service round in its ledger` with `git add -f .superpowers/sdd/2026-10-07-panel-service/progress.md`.

---

### Task 14: Hand the install to the human

**Files:** Modify: `.superpowers/sdd/2026-10-07-panel-service/progress.md` (append only)

- [ ] **Step 1: Read `~/.orca/panel.sh` again** (read only; never modify it) and confirm its flags/env still match Task 3's `PANEL_SH_ARGS`/`PANEL_SH_ENV`. If it changed, update the command below to match and record the difference.
- [ ] **Step 2: Dry run (read-only, no tool runs).** In the main worktree after the branch is merged by the human — or in the worktree if not yet merged — `npm run build`, then run the exact command from Step 3 with `install --dry-run` in place of `install`, output to a file; read it whole and check: `service.env` holds exactly `HOME`, `NODE_OPTIONS`, `ORCA_AGENTS_TABLE`, `ORCA_CCMEM_BIN`, `ORCA_PANEL_DIR`, `ORCA_SYNCSKILL_BIN`, `PATH`; `run.sh`'s exec line carries exactly the panel.sh flags after `panel run --service`; the plist label is `dev.orca.panel`. The nvm warning is expected.
- [ ] **Step 3: Print for the human** (do not run it):

```sh
# 1. Stop the panel that ~/.orca/panel.sh started (Ctrl-C in its terminal): it holds port 7777 and the control store,
#    and the service would otherwise exit 78 (port in use).
cd /Users/biran/code/skills/loop/Orca
npm run build && npm run build --workspace web
env -u ORCA_CONTROL_DIR -u ORCA_CCLOOP_BIN -u SYNCSKILL_DIR -u CCMEM_DATA_ROOT -u ORCA_CORRECTIONS_DIR -u ORCA_PROJECTS_FILE -u ORCA_PANEL_DIR \
  ORCA_AGENTS_TABLE="$HOME/.orca/agents.json" \
  ORCA_CCMEM_BIN=/usr/local/bin/ccmem \
  ORCA_SYNCSKILL_BIN=/Users/biran/.nvm/versions/node/v22.13.1/bin/syncskill \
  node dist/cli.js panel install --by biran --port 7777 \
    --repo orca=/Users/biran/code/orca/orca-web \
    --profile "$HOME/.orca/profile.json" --estimator-profile all --estimate-mode soft
node dist/cli.js panel status
```

(`env -u …` makes the service carry exactly what panel.sh sets, even if the human's shell exports other Orca variables.)
- [ ] **Step 4: awaitingHuman** (ledger + final report): (1) merge `panel-service` into `main` (`--ff-only`); (2) stop the panel.sh panel and run Step 3; (3) optionally authorize the real smoke (`npm run build && ORCA_SERVICE_REAL=1 npx vitest run tests/service/realSmoke.test.ts`); (4) retire `~/.orca/panel.sh` (the human's file); (5) a Linux host for a real systemd smoke (D16). Commit `docs(sdd): hand the panel service install to the human` (`git add -f`).

---

## Dependency on the accounts plan

`docs/superpowers/plans/2026-10-07-accounts-and-spend-caps.md` (written concurrently) makes the panel print `orca-panel: initial password for <name> written to <path>` at first start. Under the service that line lands in `~/.orca/panel/logs/panel.err.log` (macOS/detached: `0600` file in a `0700` directory, Task 5) or the user journal (Linux). This plan's contract: the service layer adds no copy of the panel's output anywhere else; `panelReadyLines`/the ready line are unchanged. Task 8's first process criterion asserts that nothing the service panel prints contains the initial password; it is vacuous until the accounts plan lands.

**Either plan can land first.** They share only textual edits in `src/cli.ts` (USAGE, dispatch) and possibly `src/panel/server.ts` (`createPanelServer`'s signature): the second to land rebases over the first. Whichever lands second (a) removes the `if (existsSync(initial))` guard in `tests/service/servicePanel.test.ts` so the assertion is unconditional, and (b) runs mutation M-acc (make the accounts line print the password itself) in a clone and sees that criterion red.

---

## Self-review

- **Spec coverage:** §1 S1 (Tasks 6, 7, 10: never attached to the starting shell), S2 (launchd + systemd + detached), S3 (§9 lessons: bootout to stop — T6; refresh before restart — T6/D20; bounded bootstrap retry — T6; never trust launchctl's code — T9; absolute node + curated PATH — T3; linger — T7; fd limit — T4). §2 shape (T6, T7, T10, T11 `run` alias). §3 config (T3; D3), `dist` refusal (T3, T1), PATH/HOME/NODE_OPTIONS (T3), generators + run.sh + EnvironmentFile (T4, T5). §4 macOS table (T6), plist keys (T4), Linux table + unit + escaping + preflight (T4, T7; D1, D5, D18). §5 lock, exit 0 / exit 78, panel.json, discovery, signals (T8, T9; D2, D9, D10, D13; SIGTERM/SIGINT unchanged, no SIGUSR1 added). §6 logs + rotation + journal + initial-password (T8, T6/T7 `logs`; dependency section). §7 panel.sh migration (T3 one-to-one test, T14), "ask the human" (T11 skill + USAGE). §8 criteria: snapshots/escaping/env (T3, T4), dist refusal (T3), sequences + exit-5 + 3/113/125 + changed/unchanged (T6), status combines (T9), second instance 78/0/stale (T8), detached survival + start-time (T10), real smoke (T12, macOS only — D16 gap recorded), deletion mutations (every task, T13).
- **Placeholder scan:** none left. Two hedges are deliberate and name their fallback: Task 5 mutation (a) may be an equivalent mutant under the host's umask, and Task 10 mutation (d) may be equivalent on the fixture — each says what to record if so.
- **Type consistency:** `ServicePaths`, `ServiceConfigV1`, `ServiceContext`, `ServiceManager`, `ManagerState`, `Identity`, `PanelJsonV1`, `LockBody`, `RunTool` are defined once (Tasks 2, 3, 6, 9, 8, 8, 5) and used with the same names and fields everywhere; `startPanelFromArgs(args, mode)` / `createPanelServer(opts, env, mode)` / `panelReadyLines(started)` match between Task 8's server edit and `servicePanel.ts`.
- **Review Focus:** the five items each have a pinning test (Task 8 port-held/stale, Task 9 status, Task 10 stop-mismatch, Task 6 changed plist, Task 3 relative path/nvm, Task 8 D2).
