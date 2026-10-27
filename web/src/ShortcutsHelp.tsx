/**
 * Tester round 2 spec §10.2 (ruling H12, #55): a visible button opens the list of the keys Orca uses, in a native modal
 * <dialog> (the browser traps focus and closes it on Escape); closing it returns focus to the button. No key opens it.
 * Tester issue #56 (session 7753e97d): the button is a keyboard icon (its name stays "Keyboard shortcuts"), placed on the
 * pages whose keys it lists -- Decisions and the group view -- not in the sidebar footer, which read as page-wide.
 */
import type { JSX } from "react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS } from "./reviewKeys.js";

export function ShortcutsHelp(): JSX.Element {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useId();
  return (
    <>
      <button type="button" className="icon-button" ref={opener} aria-label={t("shortcuts.open")} title={t("shortcuts.open")} onClick={() => dialog.current?.showModal()}>
        {/* A keyboard (the lucide "keyboard" outline), drawn in the button's text colour. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
        </svg>
      </button>
      <dialog ref={dialog} aria-labelledby={heading} onClose={() => opener.current?.focus()}>
        <h2 id={heading}>{t("shortcuts.title")}</h2>
        <ul>{SHORTCUTS.map((entry) => <li key={entry.text}>{t(entry.text)}</li>)}</ul>
        <button type="button" onClick={() => dialog.current?.close()}>{t("shortcuts.close")}</button>
      </dialog>
    </>
  );
}
