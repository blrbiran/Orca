/**
 * Issue fixes spec §4.2(5), §2.2(a): a run's reason, explained in the reader's language, with the raw reason beside it
 * (monospace) -- ccloop's own for a failed run, else the driver's blocked reason. Nothing for a run with neither.
 */
import type { JSX } from "react";
import type { RunViewV1 } from "./controlTypes.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode, runReasonText } from "./runFacts.js";

export function RunReason(props: { run: RunViewV1 }): JSX.Element | null {
  const raw = runReasonText(props.run);
  if (raw === null) return null;
  const text = explainRunReason(reasonCode(raw));
  return <> — {text ?? raw}{text !== null && <> <code>{raw}</code></>}</>;
}
