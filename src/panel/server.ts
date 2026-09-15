import { createServer } from "node:http";
import type { Server } from "node:http";
import express from "express";
import { correctionsDir } from "../corrections/paths.js";
import { buildApi } from "./api.js";
import { assertBindAllowed } from "./bindGuard.js";
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
}

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
  };
}

export async function createPanelServer(opts: PanelOptions): Promise<StartedPanel> {
  // Before listen(), never after -- see bindGuard.ts.
  assertBindAllowed(opts.bind, opts.confirmedExternal);

  const token = mintToken();
  const reviews = new ReviewsWriter(opts.correctionsDir);
  await reviews.load();
  const statics = await loadStaticFiles(opts.distDir, token);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  buildApi(app, { opts, token, reviews, statics });

  const server: Server = createServer(app);
  const listening = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.bind, () => resolve());
  });
  await listening;

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new PanelRejection("panel-no-address", "the panel started but has no numeric address");
  }
  const closed = new Promise<void>((resolve) => server.once("close", () => resolve()));

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
  return createPanelServer(parsePanelArgs(args, process.env));
}
