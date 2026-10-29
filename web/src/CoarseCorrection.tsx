/**
 * Flow engine spec §13.2–§13.3 (W-COR): a correction that names only a repository ("Correct…" on the corrections page)
 * or only a finished run ("Correct" beside it). The person writes one sentence; `kind` is pre-set `wrong` and
 * changeable, and `not_my_taste` still asks what should have been chosen instead (the corrections schema's rule).
 * Nothing else: the debug agent locates it (§13.2). Sent as `correction-record` on the `@corrections` scope.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { commandEnvelope, controlCommandPath, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { ControlAction } from "./controlApi.js";
import type { CommandSuccessV1 } from "./controlTypes.js";
import type { ControlRefusal } from "./controlState.js";
import { enumText } from "./i18n.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { actionsBox } from "./ui/classes.js";
import { Select } from "./ui/Select.js";

type Kind = "wrong" | "not_my_taste" | "stale";
type Outcome = { kind: "idle" } | { kind: "pending" } | { kind: "done"; correctionId: string } | { kind: "refused"; refusal: ControlRefusal };

/** The `correction-record` a coarse correction sends; an empty alternative is left out, never sent as "". */
export function coarseRecordAction(input: { repoId: string; runId?: string; because: string; kind: Kind; choseInstead: string }): Extract<ControlAction, { verb: "correction-record" }> {
  const choseInstead = input.choseInstead.trim();
  return {
    verb: "correction-record", groupId: "@corrections", expectedRevision: 0,
    payload: {
      repoId: input.repoId, ...(input.runId === undefined ? {} : { runId: input.runId }), kind: input.kind, because: input.because.trim(),
      ...(choseInstead === "" ? {} : { chose_instead: choseInstead }),
    },
  };
}

export function CoarseCorrectionForm(props: {
  /** The repositories the person may pick (corrections page); a run's correction passes exactly its own. */
  repositories: Array<{ repoId: string; name: string }>;
  runId?: string;
  onRecorded?: (correctionId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [repoId, setRepoId] = useState(props.repositories[0]?.repoId ?? "");
  const [because, setBecause] = useState("");
  const [kind, setKind] = useState<Kind>("wrong");
  const [choseInstead, setChoseInstead] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const ready = repoId !== "" && because.trim() !== "" && (kind !== "not_my_taste" || choseInstead.trim() !== "") && outcome.kind !== "pending";
  const submit = async (): Promise<void> => {
    const action = coarseRecordAction({ repoId, ...(props.runId === undefined ? {} : { runId: props.runId }), because, kind, choseInstead });
    setOutcome({ kind: "pending" });
    const answer = await sendControlCommand(controlCommandPath(action), commandEnvelope(nextCommandId(), action));
    if (answer.kind === "uncertain") { setOutcome({ kind: "refused", refusal: answer.refusal }); return; }
    if (answer.status >= 400) { setOutcome({ kind: "refused", refusal: refusalFromAnswer(answer) }); return; }
    const result = (answer.body as CommandSuccessV1).result as { kind: string; correctionId?: string };
    const correctionId = result.kind === "correction-recorded" && typeof result.correctionId === "string" ? result.correctionId : "";
    setOutcome({ kind: "done", correctionId });
    props.onRecorded?.(correctionId);
  };
  return (
    <form className="coarse-correction" data-testid="coarse-correction" onSubmit={(event) => { event.preventDefault(); if (ready) void submit(); }}>
      {props.runId === undefined ? (
        <label>{t("corrections.coarse.project")}
          <Select value={repoId} onValueChange={setRepoId} placeholder={t("settings.projectPick.choose")}
            options={props.repositories.map((repository) => ({ value: repository.repoId, label: repository.name }))} />
        </label>
      ) : <p>{t("corrections.coarse.ofRun", { runId: props.runId })}</p>}
      <label>{t("corrections.coarse.because")}
        <input value={because} onChange={(event) => setBecause(event.target.value)} />
      </label>
      <label>{t("corrections.coarse.kind")}
        <Select value={kind} onValueChange={setKind}
          options={(["wrong", "not_my_taste", "stale"] as const).map((value) => ({ value, label: enumText("correctionKind", value) }))} />
      </label>
      {kind === "not_my_taste" && (
        <label>{t("corrections.coarse.choseInstead")}
          <input value={choseInstead} onChange={(event) => setChoseInstead(event.target.value)} />
        </label>
      )}
      <div className={`actions ${actionsBox}`}>
        <button type="submit" disabled={!ready}>{t("corrections.coarse.submit")}</button>
        <button type="button" onClick={props.onCancel}>{t("corrections.cancel")}</button>
      </div>
      {outcome.kind === "pending" && <p role="status">{t("corrections.sending")}</p>}
      {outcome.kind === "done" && <p data-tone="ok" role="status">{t("corrections.coarse.recorded", { id: outcome.correctionId })}</p>}
      {outcome.kind === "refused" && <RefusalNotice refusal={outcome.refusal} testId="coarse-correction-refusal" />}
    </form>
  );
}

/** "Correct" beside a finished run (§13.3): opens the one-sentence form for that run of the group's repository. */
export function CorrectRunButton(props: { repoId: string; runId: string }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return open
    ? <CoarseCorrectionForm repositories={[{ repoId: props.repoId, name: props.repoId }]} runId={props.runId} onCancel={() => setOpen(false)} />
    : <button type="button" onClick={() => setOpen(true)}>{t("corrections.coarse.correctRun")}</button>;
}
