/**
 * Working-tree delivery spec 2026-11-19 §4.2 item 1 (#365): the first-use question, on a done group's Results, for a group
 * kept on its branch in a project nobody chose a delivery for (the view's `projectDeliveryChosen === false`). Never a gate:
 * the group is done either way, and nothing waits on the answer.
 *
 * "Put them in my working tree" is two commands: set-integration-scheme for the project, then set-group-integration for
 * this group. A no-op-command answer to the first (another tab chose the same already) counts as success and the second is
 * still sent. A failing second leaves the project chosen and this group keep: one per-group button and the error words
 * stay until it succeeds. The commands are an owner's (human-only); a member reads the question and who answers it.
 */
import { useContext, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1, IntegrationSchemeV1, RepositoryIntegrationV1 } from "./controlTypes.js";

/** Answers null when the project's scheme was set, else the refusal's code ("uncertain" when the outcome is unknown). */
export type ProjectDeliverySender = (repoId: string, scheme: IntegrationSchemeV1, expectedRevision: number) => Promise<string | null>;

const WORKING_TREE: IntegrationSchemeV1 = { delivery: "working-tree" };

export function DeliveryChoice(props: {
  view: GroupViewV1; integration: RepositoryIntegrationV1 | null; archived: boolean;
  onCommand: (action: ControlAction) => void | Promise<number | null>; onProjectDelivery?: ProjectDeliverySender;
}): JSX.Element | null {
  const { t } = useTranslation();
  const mayChange = mayHumanOnly(useContext(AccountContext));
  const { view, integration } = props;
  const { summary } = view;
  const [busy, setBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  // Set once the project's scheme is stored and this group's change failed; it outlives the question (the project is chosen).
  const [groupFailed, setGroupFailed] = useState(false);
  // Answered here: the group's view keeps `projectDeliveryChosen` until it is read again, so the question goes now.
  const [answered, setAnswered] = useState(false);
  const asked = view.projectDeliveryChosen === false && summary.state === "done" && (view.integration?.scheme.delivery ?? "keep") === "keep"
    && summary.placement === undefined && summary.multiDir === undefined;
  if (props.archived || (!groupFailed && (!asked || answered))) return null;

  const sendGroup = async (): Promise<boolean> => {
    const answer = await props.onCommand({ verb: "set-group-integration", groupId: summary.groupId, expectedRevision: summary.commandRevision, payload: { integration: WORKING_TREE } });
    return typeof answer === "number";
  };
  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };
  const choose = (scheme: IntegrationSchemeV1): void => {
    if (integration === null || props.onProjectDelivery === undefined) return;
    void run(async () => {
      setProjectError(null);
      const refused = await props.onProjectDelivery!(view.plan.repoId, scheme, integration.revision);
      if (refused !== null && refused !== "no-op-command") { setProjectError(refused); return; }
      if (scheme.delivery !== "working-tree") { setAnswered(true); return; }
      const sent = await sendGroup();
      setGroupFailed(!sent);
      setAnswered(sent);
    });
  };
  const retryGroup = (): void => { void run(async () => { const sent = await sendGroup(); setGroupFailed(!sent); setAnswered(sent); }); };

  const ready = mayChange && !busy && integration !== null && props.onProjectDelivery !== undefined;
  const title = t("control.deliveryChoice.question");
  return (
    <section aria-label={title} data-testid="delivery-choice" className="detail-block min-w-0 wrap-anywhere">
      <h3>{title}</h3>
      {groupFailed ? (
        <>
          <p role="alert">{t("control.deliveryChoice.groupFailed")}</p>
          {mayChange && <button type="button" disabled={busy} onClick={retryGroup}>{t("control.deliveryChoice.groupOnly")}</button>}
        </>
      ) : (
        <>
          <p>{t("control.deliveryChoice.why")}</p>
          {mayChange ? (
            <p className="flex flex-wrap gap-2">
              <button type="button" disabled={!ready} onClick={() => choose(WORKING_TREE)}>{view.checkoutPath === undefined ? t("control.deliveryChoice.workingTree") : t("control.deliveryChoice.workingTreeAt", { path: view.checkoutPath })}</button>
              <button type="button" className="btn-quiet" disabled={!ready} onClick={() => choose({ delivery: "keep" })}>{t("control.deliveryChoice.keep")}</button>
            </p>
          ) : <p role="note">{t("control.deliveryChoice.ownerOnly")}</p>}
          {projectError !== null && <p role="alert">{t("control.deliveryChoice.projectFailed", { code: projectError })}</p>}
          <p className="text-muted">{t("control.deliveryChoice.others")}</p>
        </>
      )}
    </section>
  );
}
