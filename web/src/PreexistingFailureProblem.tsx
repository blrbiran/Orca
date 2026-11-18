import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { PreexistingFailureAnswerV1, PreexistingFailureV1 } from "./controlTypes.js";

const ANSWERS: readonly PreexistingFailureAnswerV1[] = ["allow-fix", "relative", "edit-requirement"];

/**
 * Pre-existing failures spec L2 (#341): one Problems row per check that was already red before a task changed anything --
 * who reported it and what each chose, or that Orca found it red at the group's base -- with the person's three answers
 * (an owner's act, as a waiver). "Edit the requirement" is recorded like the others and then opens the group's
 * requirement, where it is changed (no editor of its own). The group keeps running whatever the answer.
 */
export function PreexistingFailureProblem(props: {
  groupId: string; rows: readonly PreexistingFailureV1[] | undefined; roles?: readonly Role[]; archived: boolean; revision: number;
  onCommand: (action: ControlAction) => void; onEditRequirement?: (groupId: string) => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (props.rows === undefined || props.rows.length === 0) return null;
  const owner = props.roles?.includes("owner") === true;
  const answer = (command: string, chosen: PreexistingFailureAnswerV1): void => {
    props.onCommand({ verb: "answer-preexisting-failure", groupId: props.groupId, expectedRevision: props.revision, payload: { command, answer: chosen } });
    if (chosen === "edit-requirement") props.onEditRequirement?.(props.groupId);
  };
  return (
    <>
      {props.rows.map((row) => (
        <div key={row.command} data-problem-preexisting-failure={row.command}>
          <p data-tone="warn">{t("control.preexistingFailure.title", { command: row.command })}</p>
          <ul>
            {row.reportedBy.map((by) => (
              <li key={by.runId}>{t("control.preexistingFailure.reported", { task: by.taskId, command: row.command, chose: by.chose === "" ? t("control.preexistingFailure.choseNothing") : by.chose })}</li>
            ))}
            {row.baseCheck !== undefined && <li>{t("control.preexistingFailure.baseCheck", { command: row.command, task: row.baseCheck.taskId })}</li>}
          </ul>
          <p>{t("control.preexistingFailure.keepsRunning")}</p>
          {row.answer !== null && <p>{t("control.preexistingFailure.answered", { answer: t(`control.preexistingFailure.answer.${row.answer}`), by: row.answered?.by ?? "" })}</p>}
          {!props.archived && owner && (
            <div role="group" aria-label={t("control.preexistingFailure.title", { command: row.command })}>
              {ANSWERS.map((chosen) => (
                <button key={chosen} type="button" aria-pressed={row.answer === chosen} title={t(`control.preexistingFailure.answerExplain.${chosen}`)}
                  onClick={() => answer(row.command, chosen)}>
                  {t(`control.preexistingFailure.answer.${chosen}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
