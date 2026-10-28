import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { UncertainCommand } from "./controlState.js";

/** Browser-owned evidence of an operation whose outcome cannot be confirmed. */
export function UncertainOperations(props: {
  commands: readonly UncertainCommand[];
  onCheck: (command: UncertainCommand) => void;
  onDismiss: (command: UncertainCommand) => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const visible = props.commands.filter((command) => command.parked && !command.dismissed);
  const dismissed = props.commands.filter((command) => command.parked && command.dismissed);
  if (visible.length === 0 && dismissed.length === 0) return null;
  const row = (command: UncertainCommand, attention: boolean): JSX.Element => <li key={JSON.stringify([command.groupId, command.commandId])}>
    <p>{command.commandId} · {command.groupId}{command.verb ? ` · ${command.verb}` : ""}</p>
    {attention && <p role="alert">{t("control.uncertain.groupMissing")}</p>}
    <button type="button" onClick={() => props.onCheck(command)}>{t("control.uncertain.checkAgain")}</button>
    {attention && <button type="button" onClick={() => props.onDismiss(command)}>{t("control.uncertain.dismiss")}</button>}
  </li>;
  return <section data-tone="warn" className="uncertain-operations min-w-0 rounded-card border px-3 py-[10px] [&_button]:mr-2 [&_li+li]:mt-2 [&_li+li]:border-t [&_li+li]:border-line [&_li+li]:pt-2 [&_p]:mb-1.5 [&_p]:mt-0 [&_p]:wrap-anywhere [&_p[role=alert]]:border-0 [&_p[role=alert]]:bg-transparent [&_p[role=alert]]:p-0 [&_summary]:cursor-pointer [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0" aria-label={t("control.uncertain.title")}>
    {visible.length > 0 && <ul>{visible.map((command) => row(command, true))}</ul>}
    {dismissed.length > 0 && <details><summary>{t("control.uncertain.dismissed")}</summary><ul>{dismissed.map((command) => row(command, false))}</ul></details>}
  </section>;
}
