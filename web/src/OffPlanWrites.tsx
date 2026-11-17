import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";

/** Off-plan writes spec W3 (#346): what a landed run changed outside its task's targetPaths; information, not a problem. */
export function OffPlanWrites({ run }: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  const record = run.offPlanWrites;
  if (record === undefined) return null;
  const more = record.count - record.paths.length;
  return <p>{t("control.task.offPlanWrites", { paths: record.paths.join(t("loopPlan.summary.pathSeparator")) })
    + (more > 0 ? t("control.task.offPlanWritesMore", { n: more }) : "")}</p>;
}
