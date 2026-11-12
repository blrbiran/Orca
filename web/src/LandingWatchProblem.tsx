import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { LandingWatchV1 } from "./controlTypes.js";

/**
 * Tester follow-up G §6.2 (#269): the Problems rows of a group whose checks turned red on its branch after a landing -- one
 * per regression: its code, which landing, how it exited, the output tail. Nothing to press: the watch runs again on the
 * next landing, and a task that fixes it is added the usual way.
 */
export function LandingWatchProblem(props: { groupId: string; landingWatch: LandingWatchV1 | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  const regressions = props.landingWatch?.regressions ?? [];
  if (regressions.length === 0) return null;
  return (
    <div data-problem-landing-watch={props.groupId}>
      <h3>{t("control.landingWatch.title")}</h3>
      {regressions.map((regression) => (
        <div key={regression.command} data-landing-regression={regression.command}>
          <p data-tone="danger"><code>{regression.problem}</code></p>
          <p>{t("control.landingWatch.turnedRed", { tasks: regression.landedTaskIds.join(", "), command: regression.command })}</p>
          <p>{t("control.landingWatch.exited", { exit: regression.exit, tip: regression.tip.slice(0, 12) })}</p>
          {regression.tail !== undefined && <pre className="whitespace-pre-wrap">{regression.tail}</pre>}
        </div>
      ))}
    </div>
  );
}
