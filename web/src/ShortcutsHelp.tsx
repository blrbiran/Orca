/**
 * Tester round 2 spec §10.2 (ruling H12, #55): a visible button opens the list of the keys Orca uses, in a modal dialog
 * (ui/Dialog.tsx, Radix since the tester round of 2026-10-28; it traps focus and closes on Escape); closing it returns
 * focus to the button. No key opens it.
 * Tester issue #56 (session 7753e97d): the button is a keyboard icon (its name stays "Keyboard shortcuts"), placed on the
 * pages whose keys it lists -- Decisions and the group view -- not in the sidebar footer, which read as page-wide.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS } from "./reviewKeys.js";
import { Dialog } from "./ui/Dialog.js";

export function ShortcutsHelp(): JSX.Element {
  const { t } = useTranslation();
  const trigger = (
    <button type="button" className="icon-button" aria-label={t("shortcuts.open")} title={t("shortcuts.open")}>
      {/* A keyboard (the lucide "keyboard" outline), drawn in the button's text colour. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
      </svg>
    </button>
  );
  return (
    <Dialog trigger={trigger} title={t("shortcuts.title")} closeLabel={t("shortcuts.close")}>
      <ul>{SHORTCUTS.map((entry) => <li key={entry.text}>{t(entry.text)}</li>)}</ul>
    </Dialog>
  );
}
