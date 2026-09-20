import type { Response } from "express";
import { ControlError, durableCommandErrorStatus, durableCommandErrorStatuses, nonDurableControlErrorClassifications } from "../control/errors.js";
import { commandErrorBodySchema, type CommandErrorV1 } from "../control/webProtocol.js";
import { PANEL_HOST_NOT_ALLOWED } from "./bindGuard.js";
import { TOKEN_REQUIRED } from "./rejection.js";

type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 500 | 503;
type ExistingControlCode = keyof typeof durableCommandErrorStatuses | keyof typeof nonDurableControlErrorClassifications;

const panelOnlyErrorStatuses = {
  [TOKEN_REQUIRED]: 401,
  [PANEL_HOST_NOT_ALLOWED]: 403,
  "control-internal-error": 500,
} as const satisfies Record<string, ControlHttpStatus> & Partial<Record<ExistingControlCode, never>>;

const readErrorStatuses = {
  "query-invalid": 400,
  "control-operation-in-progress": 503,
  "control-owner-changed": 503,
  "control-recovery-busy": 503,
  "control-writer-active": 503,
  "panel-draining": 503,
} as const satisfies Partial<Record<ExistingControlCode, ControlHttpStatus>>;

export const controlHttpErrorStatuses: Readonly<Record<string, ControlHttpStatus>> = Object.freeze({
  ...durableCommandErrorStatuses,
  ...readErrorStatuses,
  ...panelOnlyErrorStatuses,
});

export function controlErrorCatalog(): Array<{ code: string; status: number }> {
  return Object.entries(controlHttpErrorStatuses)
    .map(([code, status]) => ({ code, status }))
    .sort((left, right) => left.code.localeCompare(right.code));
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
  sendControlError(
    res,
    500,
    "control-internal-error",
    "The control read could not be completed.",
    { ...context, retryable: true },
  );
}
