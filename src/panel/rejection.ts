/**
 * The panel's named refusals. Same shape as CorrectRejection and
 * MetricsRejection: a `code` the criteria can assert on by name, and an exit
 * code the CLI answers with, so a mistyped flag never falls through to cli.ts's
 * exit 3 arm and prints a stack trace at someone.
 */
export type PanelExitCode = 1 | 4 | 5;

export class PanelRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: PanelExitCode = 1,
  ) {
    super(message);
    this.name = "PanelRejection";
  }
}

/**
 * spec §3.1: `--by` is required on the loopback interface too. A default like
 * "panel" would be a sentence permanently written into an append-only ledger
 * that nobody ever said -- and `by` reaches BOTH derived ids (§1.3), so it is
 * not a cosmetic field.
 */
export const NO_VIEWER_IDENTITY = "no-viewer-identity";

/**
 * spec §3.3: the one-time token is the whole of authorisation. Defined here,
 * beside NO_VIEWER_IDENTITY, so there is exactly one definition — its consumer
 * is Task 5's `src/panel/api.ts`, which checks it on every request and has no
 * reason to redeclare it.
 */
export const TOKEN_REQUIRED = "token-required";

/**
 * Final review I-2 / ruling R65: a request whose body the panel cannot read as
 * a JSON object -- no JSON content-type, malformed JSON, or JSON that is not an
 * object. A client mistake, so 400 by this name, never `panel-internal-error`.
 */
export const PANEL_BAD_REQUEST = "panel-bad-request";
