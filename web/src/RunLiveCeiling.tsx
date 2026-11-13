import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { AgentsViewV1, RunViewV1 } from "./controlTypes.js";

/**
 * Tester #290 / #297 (follow-up K, item 3; human: 「codex 提示就好」): a run's live token ceiling and the stop at it, as
 * `orca run show` prints them. For a codex run a note: `codex exec` runs each phase as one turn, so the ceiling is checked
 * only when a phase ends and one execute can go past it (and past the group limit) before the run stops. A note, never a
 * block. The agent's kind comes from the agents table; without it, no note (the kind is never guessed from an id).
 */
export function RunLiveCeiling({ run, agents }: { run: RunViewV1; agents: AgentsViewV1 | null | undefined }): ReactElement | null {
  const { t } = useTranslation();
  const ceiling = run.liveCeiling;
  if (ceiling === undefined) return null;
  const count = (n: number): string => n.toLocaleString("en-US");
  const stop = run.liveCeilingStop;
  const kind = run.agent === undefined ? undefined : agents?.installations.find((entry) => entry.id === run.agent!.installation)?.kind;
  return (
    <div data-testid="run-live-ceiling">
      <p className="num">{t("control.group.liveCeiling", { tokens: count(ceiling.tokens), cause: ceiling.cause, revision: ceiling.revision })}</p>
      {stop !== undefined && <p className="num">{t("control.group.liveCeilingStop", { observed: count(stop.observedTokens), tokens: count(stop.tokens), cause: stop.cause, phase: stop.phase, at: stop.at })}</p>}
      {kind === "codex" && <p role="note" data-tone="warn" data-testid="codex-ceiling-note">{t("control.group.liveCeilingCodex")}</p>}
    </div>
  );
}
