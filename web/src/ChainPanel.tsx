/**
 * D-launch spec §6.2: status, start form, stop button, banners. Pure except for the selected repository, so a
 * criterion renders it with renderToStaticMarkup (plan ruling 2). Every text node is one expression: adjacent JSX
 * text would render with `<!-- -->` between the parts.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";
import type { PanelRefusal } from "./api.js";
import type { Banner } from "./chainBanner.js";
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
  if (chain.state === "stopped") return `stopped: ${chain.stop?.reason ?? "unknown"} (${chain.stop?.category ?? "unknown"})`;
  return chain.holderGone ? "running (supervisor is gone)" : "running";
}
export const costText = (usd: number | null): string => (usd === null ? "cost unreadable" : `USD ${usd.toFixed(2)}`);
export function progressText(chain: ChainView): string {
  const n = chain.state === "running" && !chain.holderGone ? chain.sessionsDone + 1 : chain.sessionsDone;
  return `session ${n}; ${costText(chain.costUsd)}`;
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
      <h2>Chains</h2>
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
            Got it
          </button>
        </div>
      ))}
      {repos.map((r) => (
        <div key={r.repoKey} className="chain-repo" data-repo-key={r.repoKey}>
          <h3>{r.repoKey}</h3>
          {r.problem !== null && <p className="chain-problem">{r.problem}</p>}
          {r.chain === null ? (
            <p>No chain yet.</p>
          ) : (
            <dl>
              <dt>Goal</dt>
              <dd>{r.chain.goal}</dd>
              <dt>By</dt>
              <dd>{r.chain.by}</dd>
              <dt>Progress</dt>
              <dd>{progressText(r.chain)}</dd>
              <dt>State</dt>
              <dd data-testid="chain-state">{chainStateText(r.chain)}</dd>
            </dl>
          )}
          {r.chain !== null && r.chain.state === "running" && !r.chain.holderGone && (
            <p>
              <button type="button" data-action="stop-chain" onClick={() => onStop?.(r.repoKey, (r.chain as ChainView).chainId)}>
                Stop chain
              </button>
              <span>{" Stops after the current session ends."}</span>
            </p>
          )}
        </div>
      ))}
      <form className="chain-start" onSubmit={submit}>
        <label>
          {"Repository "}
          <select name="repoKey" value={repoKey} onChange={(e) => setRepoKey(e.target.value)}>
            {repos.map((r) => (
              <option key={r.repoKey} value={r.repoKey}>
                {r.repoKey}
              </option>
            ))}
          </select>
        </label>
        <label>
          {"Goal "}
          <textarea name="goal" required />
        </label>
        <label>
          {"Max sessions "}
          <input name="maxSessions" type="number" min="1" step="1" required />
        </label>
        <label>
          {"Max cost in USD (a soft limit) "}
          <input name="maxCostUsd" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          {"Session timeout in minutes "}
          <input key={repoKey} name="sessionTimeoutMin" type="number" min="1" defaultValue={selected?.defaultSessionTimeoutMin ?? ""} />
        </label>
        <button type="submit" data-action="start-chain">
          Start chain
        </button>
      </form>
      {outcome?.kind === "started" && <p role="status">{`Chain ${outcome.chainId} started.`}</p>}
      {outcome?.kind === "stop-requested" && <p role="status">{`Chain ${outcome.chainId} will stop after the current session ends.`}</p>}
      {outcome?.kind === "refused" && <Refusal refusal={outcome.refusal} />}
    </section>
  );
}
