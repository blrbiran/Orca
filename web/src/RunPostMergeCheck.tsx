import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { PostMergeCheckV1 } from "./controlTypes.js";

/**
 * Tester follow-up E §4 (#245): what the landing's post-merge check did, in one line -- passed (how many commands, how
 * long), not needed (why), or failed (the command and its exit) with its output tail below. Nothing without a record.
 */
export function RunPostMergeCheck({ check }: { check: PostMergeCheckV1 | undefined }): ReactElement | null {
  const { t } = useTranslation();
  if (check === undefined) return null;
  if (check.result === "not-needed") return <p>{t("control.group.postMergeNotNeeded", { why: t(`control.group.postMergeWhy.${check.why ?? "fast-forward"}`) })}</p>;
  // #245: the driver stopped while the check ran; the run did not land and the next driver checks again.
  if (check.result === "skipped") return <p>{t("control.group.postMergeSkipped")}</p>;
  const seconds = Math.round(check.commands.reduce((sum, command) => sum + command.ms, 0) / 1000);
  if (check.result === "passed") return <p>{t("control.group.postMergePassed", { count: check.commands.length, seconds })}</p>;
  const last = check.commands.at(-1);
  return (
    <div>
      <p data-tone="danger">{t("control.group.postMergeFailed", { command: last?.command ?? "?", exit: last?.exit ?? "?" })}</p>
      {check.tail !== undefined && <pre className="whitespace-pre-wrap">{check.tail}</pre>}
    </div>
  );
}
