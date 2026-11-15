/**
 * Tester #285: `used` contains booked work events, while a Codex response can also supply a provisional observation
 * before the phase ends. These notes distinguish the two figures in Live and the runs table and show the usage by kind
 * after the run ends. Times are the reader's local clock.
 */
import i18n, { currentLanguage } from "./i18n.js";
import type { RunViewV1 } from "./controlTypes.js";
import { runUnderWay, usesPhaseEndUsage } from "./runFacts.js";
import { shortTokens } from "./TokenInput.js";

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const SECONDS: Intl.DateTimeFormatOptions = { ...CLOCK, second: "2-digit" };
export const clockText = (ms: number, seconds = false): string => new Date(ms).toLocaleTimeString(currentLanguage(), seconds ? SECONDS : CLOCK);

/** The footing of booked `used` while a run is under way; Codex response observations remain provisional. */
export function phaseEndNote(run: RunViewV1): string | null {
  if (runUnderWay(run) && run.usageObservation === "realtime" && run.liveUsage !== undefined)
    return run.usageAt === undefined ? i18n.t("control.group.usageBookedNone") : i18n.t("control.group.usageBookedAt", { time: clockText(run.usageAt) });
  if (!usesPhaseEndUsage(run)) return null;
  return run.usageAt === undefined ? i18n.t("control.group.usagePhaseEndNone") : i18n.t("control.group.usagePhaseEnd", { time: clockText(run.usageAt) });
}

/** The latest completed response of a run under way; provisional and separate from booked `used`. */
export function liveUsageNote(run: RunViewV1): string | null {
  if (!runUnderWay(run) || run.liveUsage === undefined) return null;
  return i18n.t("control.group.usageLive", { tokens: run.liveUsage.tokens.toLocaleString(currentLanguage()),
    phase: i18n.t(`control.group.usagePhase.${run.liveUsage.phase}`),
    attempt: run.liveUsage.attempt, time: clockText(Date.parse(run.liveUsage.observedAt), true) });
}

/** An ended run's usage by kind; null under way or without a breakdown. Cache write only when there is some. */
export function usageByKind(run: RunViewV1): string | null {
  const split = run.usageBreakdown;
  if (split === undefined || runUnderWay(run)) return null;
  const values = { input: shortTokens(split.input), output: shortTokens(split.output), cacheRead: shortTokens(split.cacheRead), cacheWrite: shortTokens(split.cacheWrite) };
  return i18n.t(split.cacheWrite > 0 ? "control.group.usageByKindWrite" : "control.group.usageByKind", values);
}
