import { createServer } from "node:http";
import type { Server } from "node:http";
import express from "express";
import { correctionsDir } from "../corrections/paths.js";
import { buildApi } from "./api.js";
import { PANEL_HOST_NOT_ALLOWED, assertBindAllowed, isHostAllowed } from "./bindGuard.js";
import { controlErrorBody } from "./controlErrors.js";
import { verifyControlJsonBody } from "./controlApi.js";
import { randomUUID } from "node:crypto";
import { assembleControlRuntime, type ControlRuntime } from "./controlAssembly.js";
import { runControlPanelStartup } from "./controlLifecycle.js";
import { resolveControlOptions, type ControlOptionsResolution } from "./controlOptions.js";
import { NO_VIEWER_IDENTITY, PanelRejection } from "./rejection.js";
import { ReviewsWriter } from "./reviewsStore.js";
import { loadStaticFiles } from "./staticFiles.js";
import { mintToken } from "./token.js";

export interface PanelOptions {
  by: string;
  bind: string;
  port: number;
  confirmedExternal: boolean;
  correctionsDir: string;
  root?: string;
  repos: Array<{ projectKey: string; path: string }>;
  /** Absolute path to web/dist. Injected so a criterion can point at a fixture. */
  distDir?: string;
  /**
   * spec §4.3 / task 5 ruling G3: the ONE clock this subsystem injects.
   * `parsePanelArgs` never sets it -- `undefined` means the real wall clock,
   * applied where it is read (`src/panel/api.ts`'s `currentMetrics`). A
   * criterion sets this directly on the parsed options so it can fix `as_of`
   * and deep-equal a whole report against one it computed itself.
   */
  now?: () => Date;
  /** D-launch: the environment `orca chain start` is spawned with. Criteria put a fake claude first on its PATH. */
  chainEnv?: NodeJS.ProcessEnv;
  /** D-launch spec §2: how long POST /api/chains waits for the `started` line (default 10 s). Criteria shorten it. */
  chainStartWaitMs?: number;
  /**
   * D-launch, review fix round 1: the executable `orca chain start` is spawned through (default:
   * `node_modules/.bin/tsx` under the Orca checkout). `parsePanelArgs` never sets it -- a criterion points this at
   * a path that does not exist to make the spawn itself fail (ENOENT), without relying on the real filesystem
   * being in a particular broken state.
   */
  chainTsxBin?: string;
  /**
   * Assembly plan Task 1. Decided at parse time for the same reason `correctionsDir` is: the
   * answer depends on the environment, and a criterion must be able to relocate it. `enabled:
   * false` means `createPanelServer` passes no `control` dep, which is byte-for-byte the behaviour
   * that shipped before this existed.
   */
  control: ControlOptions;
}

/** What survives parsing: a rejection never reaches here, it is thrown. */
export type ControlOptions = Omit<ControlOptionsResolution, "rejection">;

export interface StartedPanel {
  url: string;
  token: string;
  port: number;
  /** Resolves when the server has closed. */
  closed: Promise<void>;
  close(): Promise<void>;
}

export function parsePanelArgs(args: string[], env: NodeJS.ProcessEnv): PanelOptions {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  const by = flag("--by");
  if (by === undefined || by.length === 0) {
    throw new PanelRejection(
      NO_VIEWER_IDENTITY,
      "orca panel needs --by <who>. Every review and every correction it records is stamped with " +
        "it, and `by` reaches both derived ids, so a default would be a sentence nobody said " +
        "written permanently into an append-only ledger.",
    );
  }

  const repos: Array<{ projectKey: string; path: string }> = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--repo") continue;
    const pair = args[i + 1] ?? "";
    const split = pair.indexOf("=");
    if (split <= 0) {
      throw new PanelRejection(
        "malformed-repo-argument",
        `--repo wants <projectKey>=<path>, got ${JSON.stringify(pair)}`,
      );
    }
    repos.push({ projectKey: pair.slice(0, split), path: pair.slice(split + 1) });
  }

  const portText = flag("--port") ?? "0";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new PanelRejection("malformed-port", `--port wants an integer 0-65535, got ${JSON.stringify(portText)}`);
  }

  // Resolved after --repo and before the return, because it is a function of the repo list.
  // A rejection is raised here rather than carried, so no caller can hold a half-resolved plane.
  const { rejection, ...control } = resolveControlOptions(args, env, repos);
  if (rejection !== null) throw new PanelRejection(rejection, controlRejectionMessage(rejection));

  return {
    by,
    bind: flag("--bind") ?? "127.0.0.1",
    port,
    confirmedExternal: args.includes("--i-know-this-is-exposed"),
    // Read at parse time, so ORCA_CORRECTIONS_DIR is honoured (Rule 17). A
    // module-level constant would have frozen the real ~/.orca in at import.
    correctionsDir: correctionsDir(env),
    root: flag("--root"),
    repos,
    distDir: flag("--dist"),
    control,
  };
}

/**
 * One sentence per refusal, saying what the operator must decide. These are not defaults waiting to
 * be filled in: spec §6 makes the estimator an operator choice precisely because guessing the
 * estimate mode is how a soft adapter comes to be treated as a strict one.
 */
function controlRejectionMessage(code: string): string {
  switch (code) {
    case "control-state-dir-required":
      return "more than one --repo leaves no project key to name the control state directory after; " +
        "pass --control-state-dir <path>, or --no-control if this panel is not running work.";
    case "control-wake-ms-invalid":
      return "--control-wake-ms wants a positive integer number of milliseconds.";
    case "control-estimator-profile-required":
      return "--estimator-profile <id> is required while the control plane is mounted; there is no " +
        "default estimator, because an estimate charged to the wrong profile is not a rounding error.";
    case "control-estimate-mode-required":
      return "--estimate-mode strict|soft is required while the control plane is mounted; guessing it " +
        "is how a soft adapter comes to be presented as a strict one.";
    case "control-estimate-mode-invalid":
      return "--estimate-mode wants exactly strict or soft.";
    default:
      return code;
  }
}

export async function createPanelServer(opts: PanelOptions, env: NodeJS.ProcessEnv = process.env): Promise<StartedPanel> {
  // Before listen(), never after -- see bindGuard.ts.
  assertBindAllowed(opts.bind, opts.confirmedExternal);

  const token = mintToken();
  const reviews = new ReviewsWriter(opts.correctionsDir);
  await reviews.load();
  const statics = await loadStaticFiles(opts.distDir, token);

  const app = express();
  // Final review I-4 / ruling R67: FIRST, before the body parser, the static
  // route that serves the token, and the /api token check -- a request naming
  // a foreign Host gets nothing from this process, not even a parse error.
  // See bindGuard.ts's isHostAllowed for why.
  app.use((req, res, next) => {
    if (isHostAllowed(opts.bind, req.headers.host)) {
      next();
      return;
    }
    const message = "this panel answers only to 127.0.0.1, localhost, ::1 or the address it was bound to";
    res.status(403).json(req.path === "/api/control" || req.path.startsWith("/api/control/")
      ? controlErrorBody(PANEL_HOST_NOT_ALLOWED, message)
      : { code: PANEL_HOST_NOT_ALLOWED, message });
  });
  app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));

  // Assembly plan Task 5. Built before listen so that a process which cannot build its control
  // plane never accepts a connection that would then meet a half-built one. The epoch is its own
  // per-process value and not the token: it is served in every view, and the token is a credential.
  const epoch = randomUUID();
  let control: ControlRuntime | null = null;
  if (opts.control.enabled) control = await assembleControlRuntime({ control: opts.control, repos: opts.repos, epoch, env });
  buildApi(app, {
    opts, token, reviews, statics,
    // Disabled means no `control` key at all -- byte-for-byte the shape that shipped before this
    // existed, so `controlApi.ts` registers nothing and every /api/control path is a 404.
    ...(control === null ? {} : { control: { store: control.store, epoch, config: control.config, service: control.service } }),
  });
  if (control === null && opts.control.enabled) {
    process.stderr.write("orca-panel: another process holds this repository's control store; this panel serves reviews and decisions only\n");
  } else if (control !== null && opts.control.executionPort === "unconfigured") {
    process.stderr.write("orca-panel: control plane mounted with no execution port; it will serve reads and refuse to start work\n");
  }

  const server: Server = createServer(app);
  // spec §6, ruling R4: recovery runs to completion before the socket is opened. Not "recovery is
  // started first" -- a connection accepted while reconciliation is still in flight can dispatch
  // against run state this process has not yet reconciled, which is the crash it exists to prevent.
  // With no control plane both arms are the no-op they were before this existed.
  await runControlPanelStartup({
    recover: async () => { await control?.recover(); },
    listen: () => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(opts.port, opts.bind, () => resolve());
    }),
  });
  // Armed only after recovery and after listen, and fired once immediately: a wake that was armed
  // before the crash is delivered without waiting a whole interval for it.
  if (control !== null) { control.startPump(opts.control.wakeIntervalMs); void control.pump(); }

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new PanelRejection("panel-no-address", "the panel started but has no numeric address");
  }
  const closed = new Promise<void>((resolve) => server.once("close", () => { control?.close(); resolve(); }));

  // spec §6, and the convention src/chain/run.ts:106-107 already uses. On a signal: the control
  // plane closes its gate and writes its one shutdown identity, then the server stops accepting.
  // A second signal does not wait -- it exits -- and says that the next start may be recovery
  // blocked, which is exactly what spec §6.4 requires a shutdown to leave behind when it is cut short.
  let signalled = false;
  const onSignal = (): void => {
    if (signalled) {
      process.stderr.write("orca-panel: second signal; exiting without draining. The next start may be recovery blocked.\n");
      process.exit(1);
    }
    signalled = true;
    void (async () => {
      try { await control?.shutdown(); }
      finally { server.close(); }
    })();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  void closed.then(() => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  });

  return {
    url: `http://${opts.bind}:${address.port}`,
    token,
    port: address.port,
    closed,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

export async function startPanelFromArgs(args: string[]): Promise<StartedPanel> {
  return createPanelServer(parsePanelArgs(args, process.env), process.env);
}
