/**
 * Integration spec §3, §3.1, §6.5, §9.1: how a group's finished work reaches its target, in words and as a form.
 *
 * The server holds the scheme, its hash and the integration's state; this module only names them and the intent an
 * owner forms. The form sends exactly the fields its delivery has (no server defaults): `local` has no remote, and only
 * `local` and `push-target` have a method. A repository with no scheme yet starts from remote `origin` and the
 * repository's suggested target (the server's read of origin's HEAD branch, else the current branch).
 */
import { useContext, useEffect, useRef } from "react";
import { useRegionDraft } from "./regionDraft.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1, IntegrationSchemeV1, RepositoryIntegrationV1 } from "./controlTypes.js";
import i18n from "./i18n.js";
import { Select } from "./ui/Select.js";

type Delivery = IntegrationSchemeV1["delivery"];
type Trigger = "task" | "group";
type Method = "merge" | "squash";
const DELIVERIES: readonly Delivery[] = ["keep", "local", "push-target", "push-branch", "github-pr", "working-tree"];
const TRIGGERS: readonly Trigger[] = ["task", "group"];
const METHODS: readonly Method[] = ["merge", "squash"];

const tx = (key: string, values?: Record<string, string | number>): string => String(i18n.t(key as never, values as never));

/** Spec §9.1: the scheme in plain words, e.g. "After each task: push orca/g to origin and keep one draft GitHub PR ...". */
export function integrationSentence(scheme: IntegrationSchemeV1, groupId: string): string {
  if (scheme.delivery === "keep") return tx("control.integration.says.keep");
  // Working-tree delivery spec §4.1: no trigger, method, target or remote.
  if (scheme.delivery === "working-tree") return tx("control.integration.says.working-tree", { groupId });
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

/** Tester #339: the named-source history delivery (#328), as text -- one `<taskId>=refs/heads/<branch>` per line, in order. */
interface Fields { delivery: Delivery; trigger: Trigger; method: Method; target: string; remote: string; history: string; artifacts: string }

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
/** The history sources typed, or the first line that is not `<taskId>=refs/heads/<branch>`. */
function historySources(text: string): { sources: Array<{ taskId: string; ref: string }> } | { bad: string } {
  const sources: Array<{ taskId: string; ref: string }> = [];
  for (const line of lines(text)) {
    const at = line.indexOf("=");
    if (at <= 0 || !line.slice(at + 1).startsWith("refs/heads/")) return { bad: line };
    sources.push({ taskId: line.slice(0, at), ref: line.slice(at + 1) });
  }
  return { sources };
}

function fieldsOf(scheme: IntegrationSchemeV1, suggestedTarget: string | null): Fields {
  if (scheme.delivery === "keep" || scheme.delivery === "working-tree") return { delivery: scheme.delivery, trigger: "task", method: "merge", target: suggestedTarget ?? "", remote: "origin", history: "", artifacts: "" };
  const history = scheme.delivery === "local" ? scheme.historyExpectation : undefined;
  return {
    delivery: scheme.delivery, trigger: scheme.trigger, method: "method" in scheme ? scheme.method : "merge", target: scheme.target,
    remote: "remote" in scheme ? scheme.remote : "origin",
    history: history?.sourceRefs.map((s) => `${s.taskId}=${s.ref}`).join("\n") ?? "", artifacts: history?.artifactPaths?.join("\n") ?? "",
  };
}

/** Exactly the fields the delivery has. */
function schemeOf(fields: Fields): IntegrationSchemeV1 {
  const { delivery, trigger, method, target, remote } = fields;
  switch (delivery) {
    case "keep":
    case "working-tree": return { delivery };
    case "local": {
      const parsed = historySources(fields.history);
      if (!("sources" in parsed) || parsed.sources.length === 0) return { delivery, trigger, method, target };
      const artifactPaths = lines(fields.artifacts);
      return { delivery, trigger, method, target, historyExpectation: { version: 1, targetRef: `refs/heads/${target}`, directSecondParent: true,
        sourceRefs: parsed.sources, ...(artifactPaths.length === 0 ? {} : { artifactPaths }) } };
    }
    case "push-target": return { delivery, trigger, method, target, remote };
    case "push-branch":
    case "github-pr": return { delivery, trigger, target, remote };
  }
}

/** The owner's form: delivery, trigger, method (local / push-target), target, remote (not local), Save. */
function SchemeForm(props: { scheme: IntegrationSchemeV1; suggestedTarget: string | null; onSave: (scheme: IntegrationSchemeV1) => void; draftKey?: string }): JSX.Element {
  const { t } = useTranslation();
  // Ruling R1 (#219): inside a group the form's unsent fields outlive a region switch (regionDraft.ts).
  const draftKey = props.draftKey ?? "scheme-form";
  const [fields, setFields] = useRegionDraft<Fields>(draftKey, () => fieldsOf(props.scheme, props.suggestedTarget));
  const [touched, setTouched] = useRegionDraft(`${draftKey}:touched`, () => false);
  const set = (change: Partial<Fields>): void => setFields((current) => ({ ...current, ...change }));
  // Fix round 1 F2: a suggestion read after the form opened fills the target only while it is empty and the person has
  // not typed in it; what they typed (even an emptied field) is theirs.
  const targetTouched = useRef(touched);
  useEffect(() => {
    if (props.suggestedTarget === null || targetTouched.current) return;
    setFields((current) => (current.target === "" ? { ...current, target: props.suggestedTarget! } : current));
  }, [props.suggestedTarget]);
  const { delivery } = fields;
  const missingTarget = delivery !== "keep" && delivery !== "working-tree" && fields.target.trim() === "";
  // Tester #339: a history source needs "when the group completes" and "merge commit" (the server checks it too).
  const parsedHistory = delivery === "local" ? historySources(fields.history) : { sources: [] };
  const historyProblem = "bad" in parsedHistory ? t("control.integration.historyForm.bad", { line: parsedHistory.bad })
    : parsedHistory.sources.length > 0 && (fields.trigger !== "group" || fields.method !== "merge") ? t("control.integration.historyForm.needs")
    : parsedHistory.sources.length === 0 && lines(fields.artifacts).length > 0 ? t("control.integration.historyForm.artifactsAlone") : null;
  return (
    <div>
      <label>
        {t("control.integration.delivery")}
        <Select value={delivery} onValueChange={(value) => set({ delivery: value })}
          options={DELIVERIES.map((value) => ({ value, label: tx(`control.integration.deliveries.${value}`) }))} />
      </label>
      {delivery !== "keep" && delivery !== "working-tree" && (
        <>
          <label>
            {t("control.integration.trigger")}
            <Select value={fields.trigger} onValueChange={(value) => set({ trigger: value })}
              options={TRIGGERS.map((value) => ({ value, label: tx(`control.integration.triggers.${value}`) }))} />
          </label>
          {(delivery === "local" || delivery === "push-target") && (
            <label>
              {t("control.integration.method")}
              <Select value={fields.method} onValueChange={(value) => set({ method: value })}
                options={METHODS.map((value) => ({ value, label: tx(`control.integration.methods.${value}`) }))} />
            </label>
          )}
          <label>
            {t("control.integration.target")}
            <input value={fields.target} onChange={(event) => { targetTouched.current = true; setTouched(true); set({ target: event.currentTarget.value }); }} />
          </label>
          {delivery !== "local" && (
            <label>
              {t("control.integration.remote")}
              <input value={fields.remote} onChange={(event) => set({ remote: event.currentTarget.value })} />
            </label>
          )}
          {delivery === "local" && (
            <>
              <label>
                {t("control.integration.historyForm.sources")}
                <textarea rows={3} value={fields.history} placeholder={t("control.integration.historyForm.placeholder")} onChange={(event) => set({ history: event.currentTarget.value })} />
              </label>
              <label>
                {t("control.integration.historyForm.artifacts")}
                <textarea rows={2} value={fields.artifacts} onChange={(event) => set({ artifacts: event.currentTarget.value })} />
              </label>
              {historyProblem !== null && <p data-tone="warn" role="note">{historyProblem}</p>}
            </>
          )}
        </>
      )}
      <button type="button" disabled={missingTarget || historyProblem !== null} onClick={() => props.onSave(schemeOf(fields))}>{t("control.integration.save")}</button>
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
      {/* Working-tree delivery spec §4.2 item 2: absent `chosen` (an older panel) reads as chosen. */}
      {integration.chosen === false && <p>{t("control.integration.notChosen")}</p>}
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
 * Spec §3.2, §9.1, the confirm step: the group's scheme in words, changeable by an owner (set-group-integration under the
 * group's revision). A member is told why a non-keep group is not theirs to confirm. Fix round 1 F1 (controller ruling,
 * spec §3.1 H3, §6.5): after confirm the same editor sits in the group detail, outside the Git section, and its change is
 * itself the owner's approval.
 */
export function GroupIntegrationConfirm(props: { view: GroupViewV1; suggestedTarget: string | null; onCommand: (action: ControlAction) => void; archived?: boolean }): JSX.Element {
  const started = props.view.proposal.state === "confirmed";
  const { t } = useTranslation();
  const mayChange = mayHumanOnly(useContext(AccountContext));
  const { view } = props;
  const groupId = view.summary.groupId;
  const scheme: IntegrationSchemeV1 = view.integration?.scheme ?? { delivery: "keep" };
  return (
    <section aria-label={t("control.integration.groupRegion")}>
      <h4>{t("control.integration.groupRegion")}</h4>
      <p>{integrationSentence(scheme, groupId)}</p>
      {props.archived === true
        ? null
        : mayChange
        ? (
          <SchemeForm key={`${groupId}:${view.integration?.schemeHash ?? "keep"}`} draftKey={`integration:${groupId}:${view.integration?.schemeHash ?? "keep"}`} scheme={scheme} suggestedTarget={props.suggestedTarget}
            onSave={(integration) => props.onCommand({ verb: "set-group-integration", groupId, expectedRevision: view.summary.commandRevision, payload: { integration } })} />
        )
        // Fix round 1 F1: after confirm a member reads the scheme; before it, a non-keep group is not theirs to confirm.
        : started
          ? <p role="note">{t("control.integration.ownerOnly")}</p>
          : view.integration !== undefined && <p role="note">{t("control.integration.ownerConfirms")}</p>}
    </section>
  );
}
