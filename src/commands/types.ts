/**
 * CLI v2 spec §11: one registry defines each command once. These are its types; nothing here loads a handler.
 * Type-only imports keep this module free of the control plane (plan Review Focus 1).
 */
import type { CommandVerbV1 } from "../control/webProtocol.js";
import type { CliResponseV1 } from "../entry/envelope.js";

export type FlagType = "string" | "integer" | "boolean";

export interface FlagDef {
  /** Without the leading `--`. */
  name: string;
  type: FlagType;
  summary: string;
  required?: boolean;
  /** May be given more than once; the value is then a list. */
  repeatable?: boolean;
  /** Accounts spec §3.5 / CLI v2 §15: the panel refuses it without a person token; help and references say so. */
  humanOnly?: boolean;
}

export interface PositionalDef {
  name: string;
  summary: string;
  required: boolean;
  /** Takes every remaining positional. */
  variadic?: boolean;
}

/** Spec §6.1: which counter `expectedRevision` is checked against. `corrections` is always 0. */
export type RevisionScope = "group" | "repository" | "operator" | "spend" | "orchestration" | "corrections";

export interface GlobalFlags {
  json: boolean;
  project?: string;
  controlStateDir?: string;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  commandId?: string;
  ifRevision?: number;
  asPerson: boolean;
}

export interface ParsedArgs {
  positionals: Record<string, string | string[]>;
  flags: Record<string, string | number | boolean | string[]>;
  global: GlobalFlags;
  /** Set for a `raw` command: the argv after its path, unparsed. */
  raw?: string[];
}

export interface CommandIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Given by a caller that already holds stdin (tests, the hook entry); else read from process.stdin on demand. */
  stdinText?: string;
  stdinIsTTY: boolean;
  /** The x-orca-client this invocation sends (agent entry spec §6); `cli` when unset. `orca mcp serve` sets mcp:<name>. */
  client?: string;
  /** A secret typed at the terminal with echo off (`orca login`); a seam for the criteria. Default: ttySecret.ts. */
  readSecret?(prompt: string): Promise<string>;
}

export type LocalHandler = (args: ParsedArgs, io: CommandIo) => Promise<number>;

/** What a write's builders see: the parsed arguments and a read that is fresh for this invocation (spec §4). */
export interface WriteContext {
  args: ParsedArgs;
  /** Ids already resolved against the panel (group, task, run, repo, …). */
  ids: Record<string, string>;
  /** GET over the socket, memoised for this invocation only; a non-2xx answer throws a PanelAnswer. */
  read(path: string): Promise<unknown>;
  /** Spec §4 "Project": --project, else the registered repository holding cwd, else the only one. */
  project(): Promise<{ repoId: string; projectKey: string; path: string }>;
  io: CommandIo;
}

export interface VerbMapping {
  kind: "verb";
  verb: CommandVerbV1;
  /** The control route without `/api/control/`. */
  route(context: WriteContext): string | Promise<string>;
  /** A function when one row writes either of two scopes (checks spec 2026-10-22 §4.1: `orca check set --global`). */
  scope: RevisionScope | ((context: WriteContext) => RevisionScope);
  /** The group (scope "group") or repository (scope "repository") the revision is read from; default ids.group / ids.repo. */
  scopeId?(context: WriteContext): string | Promise<string>;
  payload(context: WriteContext): unknown | Promise<unknown>;
  /** Spec §6.3: the only command the CLI refuses without --if-revision. */
  requiresIfRevision?: boolean;
  /** Spec §6.3: on revision-conflict the answer also carries the current document, read fresh. */
  conflictDocument?(context: WriteContext): Promise<unknown>;
}

export interface ReadMapping {
  kind: "read";
  /** One path: the body is that GET's body verbatim. Several: `compose` builds the body (spec §14 R6). */
  paths(context: WriteContext): string[] | Promise<string[]>;
  compose?(bodies: unknown[], context: WriteContext): unknown | Promise<unknown>;
}

export interface LocalMapping {
  kind: "local";
  load(): Promise<LocalHandler>;
}

export interface CommandDef {
  domain: string;
  /** null: the domain is the command (`orca status`). Several words for a nested action (`chain start`). */
  action: string | null;
  summary: string;
  /** Left out of the top-level help; `orca help <domain>` lists it. */
  hidden?: boolean;
  positionals: PositionalDef[];
  flags: FlagDef[];
  /** CLI v2 §15.1: who may run it over the socket. `panel-local` = runs here, needs no panel. */
  access: "open" | "token" | "panel-local";
  mapsTo: VerbMapping | ReadMapping | LocalMapping;
  /** The handler parses its own argv (`orca control`, which keeps its own grammar). */
  raw?: boolean;
  /** Per-command exit codes beyond 0 ok / 1 refused here / 2 panel error / 3 crash (spec §7, §14 R8). */
  exitCodes?: Record<number, string>;
  examples: string[];
  /** Human text for a 2xx body. */
  format(body: unknown): string;
}

export type FindResult = { def: CommandDef; rest: string[] } | { suggestion: string | null };

export type { CliResponseV1 };
