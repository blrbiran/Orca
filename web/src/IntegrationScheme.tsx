/**
 * Integration spec §3, §3.1, §6.5, §9.1: how a group's finished work reaches its target, in words and as a form.
 *
 * The server holds the scheme, its hash and the integration's state; this module only names them and the intent an
 * owner forms. The form sends exactly the fields its delivery has (no server defaults): `local` has no remote, and only
 * `local` and `push-target` have a method. A repository with no scheme yet starts from remote `origin` and the
 * repository's suggested target (the server's read of origin's HEAD branch, else the current branch).
 */
import { useContext, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1, IntegrationSchemeV1, RepositoryIntegrationV1 } from "./controlTypes.js";
import i18n from "./i18n.js";

type Delivery = IntegrationSchemeV1["delivery"];
type Trigger = "task" | "group";
type Method = "merge" | "squash";
const DELIVERIES: readonly Delivery[] = ["keep", "local", "push-target", "push-branch", "github-pr"];
const TRIGGERS: readonly Trigger[] = ["task", "group"];
const METHODS: readonly Method[] = ["merge", "squash"];

const tx = (key: string, values?: Record<string, string | number>): string => String(i18n.t(key as never, values as never));

/** Spec §9.1: the scheme in plain words, e.g. "After each task: push orca/g to origin and keep one draft GitHub PR ...". */
export function integrationSentence(scheme: IntegrationSchemeV1, groupId: string): string {
  if (scheme.delivery === "keep") return tx("control.integration.says.keep");
  const key = scheme.delivery === "github-pr" ? `github-pr-${scheme.trigger}` : scheme.delivery;
  return tx(`control.integration.says.${key}`, {
    when: tx(`control.integration.when.${scheme.trigger}`),
    method: "method" in scheme ? tx(`control.integration.verb.${scheme.method}`) : "",
    groupId,
    target: scheme.target,
    remote: "remote" in scheme ? scheme.remote : "",
  });
}

/**
 * Spec §6.5: a block or conflict code in words. A code may carry git's (or gh's) own words after its first colon
 * (`integration-push-refused:<stderr>`); they are shown as sent. A code this panel has no words for is shown as sent.
 */
export function integrationReasonText(reason: string): string {
  const colon = reason.indexOf(":");
  const code = colon < 0 ? reason : reason.slice(0, colon);
  const key = `control.integration.reason.${code}`;
  return i18n.exists(key) ? tx(key, { detail: colon < 0 ? "" : reason.slice(colon + 1) }) : reason;
}

interface Fields { delivery: Delivery; trigger: Trigger; method: Method; target: string; remote: string }

function fieldsOf(scheme: IntegrationSchemeV1, suggestedTarget: string | null): Fields {
  if (scheme.delivery === "keep") return { delivery: "keep", trigger: "task", method: "merge", target: suggestedTarget ?? "", remote: "origin" };
  return {
    delivery: scheme.delivery, trigger: scheme.trigger, method: "method" in scheme ? scheme.method : "merge", target: scheme.target,
    remote: "remote" in scheme ? scheme.remote : "origin",
  };
}

/** Exactly the fields the delivery has. */
function schemeOf(fields: Fields): IntegrationSchemeV1 {
  const { delivery, trigger, method, target, remote } = fields;
  switch (delivery) {
    case "keep": return { delivery };
    case "local": return { delivery, trigger, method, target };
    case "push-target": return { delivery, trigger, method, target, remote };
    case "push-branch":
    case "github-pr": return { delivery, trigger, target, remote };
  }
}

/** The owner's form: delivery, trigger, method (local / push-target), target, remote (not local), Save. */
function SchemeForm(props: { scheme: IntegrationSchemeV1; suggestedTarget: string | null; onSave: (scheme: IntegrationSchemeV1) => void }): JSX.Element {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Fields>(() => fieldsOf(props.scheme, props.suggestedTarget));
  const set = (change: Partial<Fields>): void => setFields((current) => ({ ...current, ...change }));
  const { delivery } = fields;
  const missingTarget = delivery !== "keep" && fields.target.trim() === "";
  return (
    <div>
      <label>
        {t("control.integration.delivery")}
        <select value={delivery} onChange={(event) => set({ delivery: event.currentTarget.value as Delivery })}>
          {DELIVERIES.map((value) => <option key={value} value={value}>{tx(`control.integration.deliveries.${value}`)}</option>)}
        </select>
      </label>
      {delivery !== "keep" && (
        <>
          <label>
            {t("control.integration.trigger")}
            <select value={fields.trigger} onChange={(event) => set({ trigger: event.currentTarget.value as Trigger })}>
              {TRIGGERS.map((value) => <option key={value} value={value}>{tx(`control.integration.triggers.${value}`)}</option>)}
            </select>
          </label>
          {(delivery === "local" || delivery === "push-target") && (
            <label>
              {t("control.integration.method")}
              <select value={fields.method} onChange={(event) => set({ method: event.currentTarget.value as Method })}>
                {METHODS.map((value) => <option key={value} value={value}>{tx(`control.integration.methods.${value}`)}</option>)}
              </select>
            </label>
          )}
          <label>
            {t("control.integration.target")}
            <input value={fields.target} onChange={(event) => set({ target: event.currentTarget.value })} />
          </label>
          {delivery !== "local" && (
            <label>
              {t("control.integration.remote")}
              <input value={fields.remote} onChange={(event) => set({ remote: event.currentTarget.value })} />
            </label>
          )}
        </>
      )}
      <button type="button" disabled={missingTarget} onClick={() => props.onSave(schemeOf(fields))}>{t("control.integration.save")}</button>
    </div>
  );
}

/** Spec §9.1, Task control: the repository's default. Editable by owners, read-only for members. */
export function RepositoryIntegration(props: { integration: RepositoryIntegrationV1; onSave: (scheme: IntegrationSchemeV1, expectedRevision: number) => void }): JSX.Element {
  const { t } = useTranslation();
  const mayChange = mayHumanOnly(useContext(AccountContext));
  const { integration } = props;
  return (
    <section aria-label={t("control.integration.region")}>
      <h3>{t("control.integration.region")}</h3>
      <p>{t("control.integration.repoLine", { repoId: integration.repoId, revision: integration.revision })} {integrationSentence(integration.integration, t("control.integration.anyGroup"))}</p>
      {mayChange
        ? (
          // Keyed by the revision, so the form starts again from what the server holds after every change.
          <SchemeForm key={`${integration.repoId}:${integration.revision}`} scheme={integration.integration} suggestedTarget={integration.suggestedTarget}
            onSave={(scheme) => props.onSave(scheme, integration.revision)} />
        )
        : <p role="note">{t("control.integration.ownerOnly")}</p>}
    </section>
  );
}

/**
 * Spec §3.2, §9.1, the confirm step: the group's scheme in words, changeable by an owner until the proposal is confirmed
 * (set-group-integration under the group's revision). A member is told why a non-keep group is not theirs to confirm.
 */
export function GroupIntegrationConfirm(props: { view: GroupViewV1; suggestedTarget: string | null; onCommand: (action: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const mayChange = mayHumanOnly(useContext(AccountContext));
  const { view } = props;
  const groupId = view.summary.groupId;
  const scheme: IntegrationSchemeV1 = view.integration?.scheme ?? { delivery: "keep" };
  return (
    <section aria-label={t("control.integration.groupRegion")}>
      <h4>{t("control.integration.groupRegion")}</h4>
      <p>{integrationSentence(scheme, groupId)}</p>
      {mayChange
        ? (
          <SchemeForm key={`${groupId}:${view.integration?.schemeHash ?? "keep"}`} scheme={scheme} suggestedTarget={props.suggestedTarget}
            onSave={(integration) => props.onCommand({ verb: "set-group-integration", groupId, expectedRevision: view.summary.commandRevision, payload: { integration } })} />
        )
        : view.integration !== undefined && <p role="note">{t("control.integration.ownerConfirms")}</p>}
    </section>
  );
}
