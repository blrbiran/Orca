/**
 * Checks spec 2026-10-22 §6.5, §7: one model review's detail, as GET /api/control/checks/reviews/:reviewGroupId serves
 * it -- the range and groups it read, the valid findings with their evidence, the findings code dropped and why, the
 * people's dismissals with their notes, and the debug groups it opened. Linked from Project settings (a check's last
 * review), from a finding's line in an involved group's decisions, and shown on the review group's own view.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { controlGet, reviewRecordPath } from "./controlApi.js";
import type { ReviewRecordV1 } from "./controlTypes.js";

const short = (sha: string): string => sha.slice(0, 7);

export function ReviewDetail(props: { reviewGroupId: string }): JSX.Element {
  const { t } = useTranslation();
  const [record, setRecord] = useState<ReviewRecordV1 | null>(null);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let live = true;
    controlGet<ReviewRecordV1>(reviewRecordPath(props.reviewGroupId))
      .then((body) => { if (live) { setRecord(body); setUnread(false); } })
      .catch(() => { if (live) setUnread(true); });
    return () => { live = false; };
  }, [props.reviewGroupId]);
  const title = t("settings.checks.review.title", { groupId: props.reviewGroupId });
  const opened = record === null ? [] : record.routed.flatMap((entry) => (entry.debugGroupId === null ? [] : [entry.debugGroupId]));
  return (
    <section aria-label={title} className="review-detail">
      <h4>{title}</h4>
      {unread && <p data-testid="review-unread">{t("settings.checks.review.unread")}</p>}
      {record !== null && (
        <>
          <p data-testid="review-range">{t("settings.checks.review.range", { from: short(record.range.from), to: short(record.range.to), target: record.range.target })}</p>
          <p data-testid="review-groups">{t("settings.checks.review.groups", { groups: record.groups.join(", ") })}</p>
          <h5>{t("settings.checks.review.valid")}</h5>
          {record.valid.length === 0 ? <p>{t("settings.checks.review.none")}</p> : (
            <ul>
              {record.valid.map((finding) => {
                const routed = record.routed.find((entry) => entry.findingId === finding.id);
                return (
                  <li key={finding.id} data-testid={`review-finding-${finding.id}`}>
                    <span className="badge" {...(finding.severity === "major" ? { "data-tone": "danger" } : {})}>{t(`settings.checks.review.severity.${finding.severity}` as const)}</span>{" "}
                    <strong>{t(`settings.checks.review.category.${finding.category}` as const)}: {finding.title}</strong>
                    <p>{finding.explanation}</p>
                    <ul>
                      {finding.evidence.map((evidence, i) => (
                        <li key={i}>{t("settings.checks.review.evidence", { groupId: evidence.groupId, path: evidence.path, line: evidence.line })}{evidence.note === "" ? "" : ` -- ${evidence.note}`}</li>
                      ))}
                    </ul>
                    {finding.suggestedFix !== "" && <p>{t("settings.checks.review.fix", { fix: finding.suggestedFix })}</p>}
                    {routed?.detail != null && <p>{routed.detail}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <h5>{t("settings.checks.review.dropped")}</h5>
          <ul data-testid="review-dropped">
            {record.dropped.length === 0 ? <li>{t("settings.checks.review.none")}</li>
              : record.dropped.map((entry) => <li key={entry.findingId}>{t("settings.checks.review.droppedEntry", { findingId: entry.findingId, reason: entry.reason })}</li>)}
          </ul>
          <h5>{t("settings.checks.review.dismissals")}</h5>
          <ul data-testid="review-dismissals">
            {record.dismissals.length === 0 ? <li>{t("settings.checks.review.none")}</li>
              : record.dismissals.map((entry) => (
                <li key={entry.decisionId}>{t("settings.checks.review.dismissal", { decisionId: entry.decisionId, by: entry.by ?? "", at: entry.at ?? "", note: entry.note ?? t("settings.checks.review.noNote") })}</li>
              ))}
          </ul>
          <p data-testid="review-debug">{opened.length === 0 ? t("settings.checks.review.noDebug") : t("settings.checks.review.debug", { groups: opened.join(", ") })}</p>
        </>
      )}
    </section>
  );
}
