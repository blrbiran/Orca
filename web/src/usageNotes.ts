/**
 * Tester #285: a codex run reports usage only when a phase ends, so its `used` stays at the last phase end's figure during
 * a long execute. These say what the figure is (runs table, Live region, group budget) and, once the run has ended, its
 * usage by kind (run detail). Times are the reader's local clock.
 */
import i18n, { currentLanguage } from "./i18n.js";
import type { RunViewV1 } from "./controlTypes.js";
import { runUnderWay, usesPhaseEndUsage } from "./runFacts.js";
import { shortTokens } from "./TokenInput.js";

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const SECONDS: Intl.DateTimeFormatOptions = { ...CLOCK, second: "2-digit" };
export const clockText = (ms: number, seconds = false): string => new Date(ms).toLocaleTimeString(currentLanguage(), seconds ? SECONDS : CLOCK);

/** The footing of a run's `used` while it is under way and its agent reports at phase end; null otherwise. */
export function phaseEndNote(run: RunViewV1): string | null {
  if (!usesPhaseEndUsage(run)) return null;
  return run.usageAt === undefined ? i18n.t("control.group.usagePhaseEndNone") : i18n.t("control.group.usagePhaseEnd", { time: clockText(run.usageAt) });
}

/** An ended run's usage by kind; null under way or without a breakdown. Cache write only when there is some. */
export function usageByKind(run: RunViewV1): string | null {
  const split = run.usageBreakdown;
  if (split === undefined || runUnderWay(run)) return null;
  const values = { input: shortTokens(split.input), output: shortTokens(split.output), cacheRead: shortTokens(split.cacheRead), cacheWrite: shortTokens(split.cacheWrite) };
  return i18n.t(split.cacheWrite > 0 ? "control.group.usageByKindWrite" : "control.group.usageByKind", values);
}
