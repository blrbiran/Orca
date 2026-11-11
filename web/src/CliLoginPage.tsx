/**
 * CLI browser login spec (2026-11-11) §6.2 (#208): where an owner approves `orca auth login`. It shows the code to compare
 * with the terminal, what the terminal reported about itself (labelled unverified: the panel cannot check it), when it was
 * asked and expires, the account it logs in as and the token's lifetime. Approve is the one primary button. The token and
 * the request id never reach this page.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { failureFrom } from "./api.js";
import { approveCliLogin, denyCliLogin, fetchCliLogin } from "./cliLogin.js";
import type { CliLoginAnswer } from "./cliLogin.js";
import { Refusal } from "./Refusal.js";
import { authPage } from "./ui/classes.js";

type PageState =
  | { kind: "loading" }
  | { kind: "refused"; refusal: PanelRefusal }
  | { kind: "shown"; answer: CliLoginAnswer; refusal: PanelRefusal | null; busy: boolean }
  | { kind: "done"; outcome: "approved" | "denied" };

const when = (ms: number | null): string => (ms === null ? "—" : new Date(ms).toLocaleString());
const shown = (value: string | number | null): string => (value === null ? "—" : String(value));

export function CliLoginPage({ code, onBack }: { code: string; onBack: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    fetchCliLogin(code).then(
      (answer) => { if (live) setState({ kind: "shown", answer, refusal: null, busy: false }); },
      (err: unknown) => { if (live) setState({ kind: "refused", refusal: failureFrom(err) }); },
    );
    return () => { live = false; };
  }, [code]);

  const decide = async (outcome: "approved" | "denied"): Promise<void> => {
    if (state.kind !== "shown") return;
    setState({ ...state, busy: true });
    const answer = await (outcome === "approved" ? approveCliLogin(code) : denyCliLogin(code));
    setState(answer.ok ? { kind: "done", outcome } : { ...state, busy: false, refusal: answer });
  };

  const back = <button type="button" className="btn-quiet" onClick={onBack}>{t("cliLogin.back")}</button>;
  let body: JSX.Element;
  if (state.kind === "loading") body = <p>{t("cliLogin.loading")}</p>;
  else if (state.kind === "refused") body = <Refusal refusal={state.refusal} />;
  else if (state.kind === "done") {
    body = <p role="status" data-tone={state.outcome === "approved" ? "ok" : undefined}>{t(state.outcome === "approved" ? "cliLogin.approved" : "cliLogin.denied")}</p>;
  } else if (state.answer.state === "cancelled") body = <p role="status">{t("cliLogin.cancelled")}</p>;
  else {
    const view = state.answer;
    const facts: Array<[string, string]> = [
      [t("cliLogin.client"), view.reported.client], [t("cliLogin.pid"), shown(view.reported.pid)], [t("cliLogin.ppid"), shown(view.reported.ppid)],
      [t("cliLogin.cwd"), shown(view.reported.cwd)], [t("cliLogin.startedAt"), when(view.reported.startedAt)],
    ];
    body = (
      <>
        <p>{t("cliLogin.lede")}</p>
        <p className="text-sm">{t("cliLogin.codeLabel")}: <strong className="num text-lg">{view.code}</strong> <span className="text-xs text-muted">{t("cliLogin.codeHint")}</span></p>
        <p role="note" data-tone="warn">{t("cliLogin.warning")}</p>
        <section aria-label={t("cliLogin.unverified")}>
          <h2 className="text-sm">{t("cliLogin.unverified")}</h2>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm wrap-anywhere">
            {facts.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted">{label}</dt><dd className="m-0">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-muted">{t("cliLogin.sameUser")}</p>
        </section>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">{t("cliLogin.requestedAt")}</dt><dd className="m-0">{when(view.requestedAt)}</dd>
          <dt className="text-muted">{t("cliLogin.expiresAt")}</dt><dd className="m-0">{when(view.expiresAt)}</dd>
          <dt className="text-muted">{t("cliLogin.account")}</dt><dd className="m-0">{view.account.name}</dd>
          <dt className="text-muted">{t("cliLogin.tokenLifetime")}</dt><dd className="m-0">{t("cliLogin.tokenDays", { n: view.tokenDays })}</dd>
        </dl>
        {view.state === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={state.busy} aria-busy={state.busy} onClick={() => void decide("approved")}>{t("cliLogin.approve")}</button>
            <button type="button" disabled={state.busy} onClick={() => void decide("denied")}>{t("cliLogin.deny")}</button>
          </div>
        ) : <p role="status">{t("cliLogin.finished")}</p>}
        {state.refusal !== null && <Refusal refusal={state.refusal} />}
      </>
    );
  }
  return (
    <main className={authPage}>
      <div className="flex flex-col gap-3">
        <h1>{t("cliLogin.title")}</h1>
        {body}
        <div>{back}</div>
      </div>
    </main>
  );
}
