/**
 * Tester issue #274: when ccloop's strict execute shape refuses an agent's answer, ccloop (from 1c54033) puts the refused
 * field in the run's failure-cause detail -- `execution-format-invalid: commandOutputs: expected array, received string`
 * (ccloop executionFormatFieldDetail, after the normalization reason). This is the field part, or null for any other detail.
 * Read by runDiagnosis.ts (`formatField`), so the CLI's run show and run results and the Web's run reason name it. Shared
 * by the CLI and the Web, so it imports nothing.
 */
const FORMAT_REFUSAL = /^execution-format-(?:invalid|ambiguous-or-hidden): (.+)$/s;

export function refusedFormatField(detail: string | null | undefined): string | null {
  if (typeof detail !== "string") return null;
  return FORMAT_REFUSAL.exec(detail)?.[1] ?? null;
}
