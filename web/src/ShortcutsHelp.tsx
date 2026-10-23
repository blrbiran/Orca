/**
 * Tester round 2 spec §10.2 (ruling H12, #55): a visible button opens the list of the keys Orca uses, in a native modal
 * <dialog> (the browser traps focus and closes it on Escape); closing it returns focus to the button. No key opens it.
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
      <button type="button" ref={opener} onClick={() => dialog.current?.showModal()}>{t("shortcuts.open")}</button>
      <dialog ref={dialog} aria-labelledby={heading} onClose={() => opener.current?.focus()}>
        <h2 id={heading}>{t("shortcuts.title")}</h2>
        <ul>{SHORTCUTS.map((entry) => <li key={entry.text}>{t(entry.text)}</li>)}</ul>
        <button type="button" onClick={() => dialog.current?.close()}>{t("shortcuts.close")}</button>
      </dialog>
    </>
  );
}
