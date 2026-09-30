/**
 * D-launch spec §6.2: status, start form, stop button, banners. Pure except for the selected repository, so a
 * criterion renders it with renderToStaticMarkup (plan ruling 2). Every text node is one expression: adjacent JSX
 * text would render with `<!-- -->` between the parts.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import type { Banner } from "./chainBanner.js";
import i18n, { enumText } from "./i18n.js";
import { Refusal } from "./Refusal.js";
import type { ChainRepoView, ChainView } from "./types.js";

export type ChainOutcome = { kind: "started"; chainId: string } | { kind: "stop-requested"; chainId: string } | { kind: "refused"; refusal: PanelRefusal };
export interface ChainForm {
  repoKey: string;
  goal: string;
  maxSessions: string;
  maxCostUsd: string;
  sessionTimeoutMin: string;
}

export function chainStateText(chain: ChainView): string {
  if (chain.state === "stopped") {
    return i18n.t("chains.stateStopped", {
      reason: chain.stop?.reason ?? i18n.t("common.unknown"),
      category: chain.stop ? enumText("chainStopCategory", chain.stop.category) : i18n.t("common.unknown"),
    });
  }
  return chain.holderGone ? i18n.t("chains.stateOrphaned") : i18n.t("chains.stateRunning");
}
export const costText = (usd: number | null): string => (usd === null ? i18n.t("chains.costUnreadable") : i18n.t("chains.cost", { amount: usd.toFixed(2) }));
export function progressText(chain: ChainView): string {
  const n = chain.state === "running" && !chain.holderGone ? chain.sessionsDone + 1 : chain.sessionsDone;
  return i18n.t("chains.sessionProgress", { n, cost: costText(chain.costUsd) });
}

/**
 * Panel UI redesign spec §5.1: the banners, lifted out verbatim so App can show them above
 * every section. ChainPanel still renders the ones it is given (App passes none).
 */
export function ChainBanners({ banners, onDismiss }: { banners: readonly Banner[]; onDismiss?: (chainId: string) => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {banners.map((b) => (
        <div key={b.chainId} role="alert" className={`chain-banner chain-banner-${b.category}`} data-chain-id={b.chainId}>
          <strong>{b.text}</strong>
          <span>{` ${b.repoKey}: ${b.reason}`}</span>
          {b.awaitingHuman.length > 0 && (
            <ul>
              {b.awaitingHuman.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <button type="button" data-action="dismiss" onClick={() => onDismiss?.(b.chainId)}>
            {t("chains.gotIt")}
          </button>
        </div>
      ))}
    </>
  );
}

export function ChainPanel({
  repos,
  banners,
  outcome,
  onDismiss,
  onStart,
  onStop,
}: {
  repos: readonly ChainRepoView[];
  banners: readonly Banner[];
  outcome: ChainOutcome | null;
  onDismiss?: (chainId: string) => void;
  onStart?: (form: ChainForm) => void;
  onStop?: (repoKey: string, chainId: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [repoKey, setRepoKey] = useState(repos[0]?.repoKey ?? "");
  const selected = repos.find((r) => r.repoKey === repoKey);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const text = (name: string): string => String(d.get(name) ?? "");
    onStart?.({ repoKey, goal: text("goal"), maxSessions: text("maxSessions"), maxCostUsd: text("maxCostUsd"), sessionTimeoutMin: text("sessionTimeoutMin") });
  };
  return (
    <section className="chains">
      <h2>{t("chains.title")}</h2>
      <ChainBanners banners={banners} onDismiss={onDismiss} />
      {repos.map((r) => (
        <div key={r.repoKey} className="chain-repo" data-repo-key={r.repoKey}>
          <h3>{r.repoKey}</h3>
          {r.problem !== null && <p className="chain-problem">{r.problem}</p>}
          {r.chain === null ? (
            <p>{t("chains.noChain")}</p>
          ) : (
            <dl>
              <dt>{t("chains.goal")}</dt>
              <dd>{r.chain.goal}</dd>
              <dt>{t("chains.by")}</dt>
              <dd>{r.chain.by}</dd>
              <dt>{t("chains.progress")}</dt>
              <dd>{progressText(r.chain)}</dd>
              <dt>{t("chains.state")}</dt>
              <dd data-testid="chain-state">{chainStateText(r.chain)}</dd>
            </dl>
          )}
          {r.chain !== null && r.chain.state === "running" && !r.chain.holderGone && (
            <p>
              <button type="button" data-action="stop-chain" onClick={() => onStop?.(r.repoKey, (r.chain as ChainView).chainId)}>
                {t("chains.stop")}
              </button>
              <span>{t("chains.stopsAfter")}</span>
            </p>
          )}
        </div>
      ))}
      <form className="chain-start" onSubmit={submit}>
        <label>
          {t("chains.formRepository")}
          <select name="repoKey" value={repoKey} onChange={(e) => setRepoKey(e.target.value)}>
            {repos.map((r) => (
              <option key={r.repoKey} value={r.repoKey}>
                {r.repoKey}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("chains.formGoal")}
          <textarea name="goal" required />
        </label>
        <label>
          {t("chains.formMaxSessions")}
          <input name="maxSessions" type="number" min="1" step="1" required />
        </label>
        <label>
          {t("chains.formMaxCost")}
          <input name="maxCostUsd" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          {t("chains.formTimeout")}
          <input key={repoKey} name="sessionTimeoutMin" type="number" min="1" defaultValue={selected?.defaultSessionTimeoutMin ?? ""} />
        </label>
        <button type="submit" data-action="start-chain">
          {t("chains.start")}
        </button>
      </form>
      {outcome?.kind === "started" && <p role="status">{t("chains.started", { chainId: outcome.chainId })}</p>}
      {outcome?.kind === "stop-requested" && <p role="status">{t("chains.stopRequested", { chainId: outcome.chainId })}</p>}
      {outcome?.kind === "refused" && <Refusal refusal={outcome.refusal} />}
    </section>
  );
}
