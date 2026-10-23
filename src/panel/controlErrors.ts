import type { Response } from "express";
import { ccloopFailedMessage, peerFailure } from "../control/ccloopPort.js";
import { ControlError, durableCommandErrorStatus, durableCommandErrorStatuses, nonDurableControlErrorClassifications } from "../control/errors.js";
import { commandErrorBodySchema, compareText, type CommandErrorV1 } from "../control/webProtocol.js";
import { PANEL_HOST_NOT_ALLOWED } from "./bindGuard.js";
import { CSRF_REQUIRED, LOGIN_REQUIRED, PASSWORD_CHANGE_REQUIRED } from "./rejection.js";

type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 424 | 429 | 500 | 503;
type ExistingControlCode = keyof typeof durableCommandErrorStatuses | keyof typeof nonDurableControlErrorClassifications;

const panelOnlyErrorStatuses = {
  [LOGIN_REQUIRED]: 401,
  [PASSWORD_CHANGE_REQUIRED]: 403,
  [CSRF_REQUIRED]: 403,
  [PANEL_HOST_NOT_ALLOWED]: 403,
  // Accounts spec §3.5: the human-only refusals now reach the Web UI too (a member), so they are catalogued.
  "control-verb-human-only": 403,
  "control-field-human-only": 403,
  // CLI v2 spec §15.4: a socket request carrying x-orca-dispatched-run, for a §15.1 verb or field.
  "control-dispatched-run-refused": 403,
  // CLI v2 spec §15.1, §15.5: a token-tier entry from the socket without a person token.
  "control-person-token-required": 403,
  // CLI v2 spec §15.3, §15.5: an x-orca-person-token that is not a live person token (bad, expired, revoked).
  "control-person-token-invalid": 401,
  // CLI v2 spec §15.3: `orca login` over the socket answers the Web login's refusals by the same codes.
  "login-failed": 401,
  "login-throttled": 429,
  "owner-required": 403,
  // Accounts spec §6.3.2: an agent's import-plan or requirement-draft-accept whose limit exceeds the caps' headroom.
  "control-limit-over-cap-headroom": 403,
  // Spec 2026-10-15 ccloop error codes §4.2: ccloop exited non-zero; the message names its code (or `unknown`) and detail.
  "ccloop-failed": 424,
  "control-internal-error": 500,
} as const satisfies Record<string, ControlHttpStatus> & Partial<Record<ExistingControlCode, never>>;

const readErrorStatuses = {
  "query-invalid": 400,
  "usage-query-invalid": 400,
  // Gaps plan Task 10-B fix I1: a folder whose image listing passed its entry or time cap (src/flow/startForm.ts).
  "flow-folder-too-large": 400,
  // Web recoverable control spec §6: same command id, different canonical raw request (commandLedger.ts) -- a named
  // refusal, not control-internal-error; nothing is booked under the id by the second request.
  "command-id-conflict": 409,
  "control-operation-in-progress": 503,
  "control-owner-changed": 503,
  "control-recovery-busy": 503,
  "control-writer-active": 503,
  "panel-draining": 503,
} as const satisfies Partial<Record<ExistingControlCode, ControlHttpStatus>>;

export const controlHttpErrorStatuses: Readonly<Record<string, ControlHttpStatus>> = Object.freeze({
  // D9 settlement refusals use the authority catalog so HTTP, lookup and locale coverage agree.
  ...durableCommandErrorStatuses,
  ...readErrorStatuses,
  ...panelOnlyErrorStatuses,
});

export function controlErrorCatalog(): Array<{ code: string; status: number }> {
  return Object.entries(controlHttpErrorStatuses)
    .map(([code, status]) => ({ code, status }))
    .sort((left, right) => compareText(left.code, right.code));
}

export function controlErrorBody(
  code: string,
  message: string,
  options: { commandRevision?: number | null; evidenceIds?: readonly string[]; retryable?: boolean } = {},
): { error: CommandErrorV1 } {
  return commandErrorBodySchema.parse({
    error: {
      code,
      message,
      commandRevision: options.commandRevision ?? null,
      evidenceIds: [...new Set(options.evidenceIds ?? [])].sort(),
      retryable: options.retryable ?? false,
    },
  });
}

export function sendControlError(
  res: Response,
  status: ControlHttpStatus,
  code: string,
  message: string,
  options: { commandRevision?: number | null; evidenceIds?: readonly string[]; retryable?: boolean } = {},
): void {
  res.status(status).json(controlErrorBody(code, message, options));
}

export function sendMappedControlError(
  res: Response,
  error: unknown,
  context: { commandRevision?: number | null; evidenceIds?: readonly string[] } = {},
): void {
  if (error instanceof ControlError) {
    const durableStatus = durableCommandErrorStatus(error.code);
    const directStatus = readErrorStatuses[error.code as keyof typeof readErrorStatuses];
    if (durableStatus !== null || directStatus !== undefined) {
      const status = (durableStatus ?? directStatus) as ControlHttpStatus;
      sendControlError(res, status, error.code, error.message, { ...context, retryable: status === 503 });
      return;
    }
  }
  // Spec 2026-10-15 ccloop error codes §4.2: a peer exit is a definite, named failure. A command's ccloop calls run before
  // its transaction or inside a savepoint that is rolled back, and the code stays transient, so nothing was booked
  // (apply-agent-update, which reserves first, rethrows an unknown outcome as a plain error: webService.ts).
  const failure = peerFailure(error);
  if (failure !== null) {
    sendControlError(res, 424, "ccloop-failed", ccloopFailedMessage(failure), { ...context, retryable: true });
    return;
  }
  sendControlError(
    res,
    500,
    "control-internal-error",
    "The control read could not be completed.",
    { ...context, retryable: true },
  );
}
