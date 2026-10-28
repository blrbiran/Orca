/**
 * ccloop error codes spec (2026-10-15) §4.6: ccloop's own code and detail, explained in the reader's language wherever the
 * panel shows one. ccloop's table first, then the Orca error table (a named refusal both share keeps its Orca text), else
 * the generic sentence, which still names the code and the detail.
 */
import i18n, { currentLanguage, errorEntry, fillEntry } from "./i18n.js";
import { enCcloopErrors } from "./locales/en.js";
import { zhCcloopErrors } from "./locales/zh.js";

/** A code as the server writes one before `: <detail>` (src/control/ccloopPort.ts PEER_CODE). */
const CODE_THEN_DETAIL = /^([a-z][a-z0-9-]{0,63})(?:$|: ([\s\S]*)$)/;

function ccloopEntry(code: string): string | undefined {
  const table = currentLanguage() === "zh" ? zhCcloopErrors : enCcloopErrors;
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

export function explainCcloopCode(code: string, detail: string): string {
  const entry = ccloopEntry(code) ?? errorEntry(code);
  if (entry !== undefined) return fillEntry(entry, { message: detail, status: "", detail }); // zh Orca entries name the detail {{message}}
  return detail === "" ? i18n.t("ccloop.genericNoDetail", { code }) : i18n.t("ccloop.generic", { code, detail });
}

/**
 * A code's words for a surface that already shows the code: null when they would only repeat it (plan R3 made the
 * generic text for an unknown code the bare code), so no surface reads `X · X`.
 */
export function explainBesideCode(code: string): string | null {
  const words = explainCcloopCode(code, "");
  return words === code ? null : words;
}

/** `<code>[: <detail>]`, as the server writes it after `ccloop-failed:` and after a peer exit's `<exit>:`; `unknown` when no code leads. */
export function codeAndDetail(text: string): { code: string; detail: string } {
  const match = CODE_THEN_DETAIL.exec(text);
  return match ? { code: match[1]!, detail: match[2] ?? "" } : { code: "unknown", detail: text };
}

/** A stored peer-exit reason after its prefix: `<exit>[:<code>][: <detail>]` (the server's peerExitText). */
export function peerExitReason(rest: string): { code: string; detail: string } {
  const cut = rest.indexOf(":");
  return codeAndDetail(cut === -1 ? "" : rest.slice(cut + 1));
}

const ESTIMATOR_REJECTED = "agent-selection-rejected:estimator:";
const CALL_FAILED = "estimate-call-failed:";
/** An estimate's reason that carries a ccloop code (§4.3 estimator slot, §4.5 failed call); null for any other, and null when the words would only repeat the code shown beside them. */
export function explainEstimateReason(reasonCode: string): string | null {
  if (reasonCode.startsWith(ESTIMATOR_REJECTED)) {
    // Issue #73: requirement open writes a failed probe's ccloop stderr after the code (`<code>: <detail>`).
    const { code, detail } = codeAndDetail(reasonCode.slice(ESTIMATOR_REJECTED.length));
    return explainBesideCode(code) === null ? null : explainCcloopCode(code, detail);
  }
  if (reasonCode.startsWith(CALL_FAILED)) return explainBesideCode(reasonCode.slice(CALL_FAILED.length));
  return null;
}

/** src/control/estimatorCompatibility.ts EstimatorCompatibilityReason: the codes Orca's own estimator check refuses with. */
const ESTIMATOR_CHECK_REASONS = new Set(["selection-unavailable", "single-call-unavailable", "preflight-unavailable", "instruction-unknown",
  "context-unavailable", "context-unreported", "usage-unavailable", "budget-unavailable", "handoff-unavailable", "request-bound-unavailable"]);
/**
 * Issues #70, #73, #58: requirement open's `agent-selection-rejected:estimator:<a>,<b>` names Orca's estimator compatibility
 * check, not ccloop. Its refusal in words, each reason code explained; null when any code is not one of that check's.
 */
export function explainEstimatorCheck(message: string): string | null {
  if (!message.startsWith(ESTIMATOR_REJECTED)) return null;
  const codes = message.slice(ESTIMATOR_REJECTED.length).split(",");
  if (!codes.every((code) => ESTIMATOR_CHECK_REASONS.has(code))) return null;
  const t = i18n.t as (key: string, options?: object) => unknown;
  const reasons = codes.map((code) => String(t(`estimatorCheck.reason.${code}`))).join(currentLanguage() === "zh" ? "" : " ");
  return String(t("estimatorCheck.refused", { reasons }));
}

/**
 * Issue #60: ccloop codes whose own words are the next step when a run's failure cause is `unknown` (or ccloop stated
 * none) -- ccloop's cause parser does not classify them. Found as a whole code in the stop reason or failure code.
 */
const NEXT_STEP_CODES = ["omp-phase-tool-forbidden"] as const;
export function codedNextStep(...texts: ReadonlyArray<string | null | undefined>): string | null {
  for (const code of NEXT_STEP_CODES) {
    const whole = new RegExp(`(?:^|[^a-z0-9-])${code}(?:$|[^a-z0-9-])`);
    if (texts.some((text) => typeof text === "string" && whole.test(text))) return explainCcloopCode(code, "");
  }
  return null;
}
