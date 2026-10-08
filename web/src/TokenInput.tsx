/**
 * Spec §9.2 item 3: a token amount is an integer shown grouped by the app language ("10,000,000") with a magnitude
 * hint ("≈ 10M" / "约 1000 万"). Typing accepts digits grouped by `,`, space, U+00A0 or U+202F; anything else is
 * refused in the field and never reaches `onChange`, so callers only ever hold a whole number.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { currentLanguage } from "./i18n.js";

const SEPARATORS = /[,\u0020\u00A0\u202F]/g;

/** "10,000,000" -> 10000000; null for anything but digits and the four separators, or above MAX_SAFE_INTEGER. */
export function parseTokens(text: string): number | null {
  const bare = text.trim().replace(SEPARATORS, "");
  if (!/^[0-9]+$/.test(bare)) return null;
  const n = Number(bare);
  return n > Number.MAX_SAFE_INTEGER ? null : n;
}

export function formatTokens(n: number, lang: string): string {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(n);
}

const trimmed = (x: number): string => String(Math.round(x * 10) / 10);

/** 10000000 -> "10M" (en) / "1000 万" (zh); a number below the first unit is written as is. */
export function shortTokens(n: number, lang: string): string {
  const units: [number, string][] = lang === "zh" ? [[1e8, " 亿"], [1e4, " 万"]] : [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  const unit = units.find(([size]) => n >= size);
  return unit === undefined ? String(n) : `${trimmed(n / unit[0])}${unit[1]}`;
}

export interface TokenInputProps {
  /** null shows an empty field (nothing typed yet) without an error. */
  value: number | null;
  onChange: (n: number) => void;
  /** Called when the text typed is not an acceptable amount, so the caller can refuse to send the amount it still holds. */
  onInvalid?: () => void;
  /** Called when the text was replaced from outside (the value changed), so a flag kept from the old text is stale. */
  onReset?: () => void;
  /** Blank text is a valid answer meaning "unset": no error, and `onClear` is called instead of `onChange`. */
  allowEmpty?: boolean;
  onClear?: () => void;
  min?: number;
  readOnly?: boolean;
  "aria-label"?: string;
  /**
   * A visible label for the field (final review M-T10). The label holds only this text; the magnitude hint and the
   * field error sit beside the field, never inside the label (a wrapping <label> would read "token约 900 万").
   */
  label?: string;
}

export function TokenInput({ value, onChange, onInvalid, onReset, allowEmpty, onClear, min = 0, readOnly, "aria-label": ariaLabel, label }: TokenInputProps): JSX.Element {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [text, setText] = useState(value === null ? "" : formatTokens(value, lang));
  // A value changed from outside (a suggestion applied, a draft restored) replaces the text; typing that parses to the
  // value already held does not, so a half-typed "12," is left alone.
  useEffect(() => {
    if (value !== null && parseTokens(text) !== value) {
      setText(formatTokens(value, lang));
      onReset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, lang]);
  const parsed = parseTokens(text);
  const blank = text.trim() === "";
  const invalid = blank ? !allowEmpty && value !== null : parsed === null || parsed < min;
  const input = (
    <input
      type="text" inputMode="numeric" value={text} readOnly={readOnly} aria-label={ariaLabel} aria-invalid={invalid || undefined}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setText(raw);
        const n = parseTokens(raw);
        if (allowEmpty && raw.trim() === "") onClear?.();
        else if (n !== null && n >= min) onChange(n);
        else onInvalid?.();
      }}
      onBlur={() => { if (parsed !== null && parsed >= min) setText(formatTokens(parsed, lang)); }}
    />
  );
  const note = invalid
    ? <small role="alert" style={{ color: "red" }}>{t("tokens.invalid", { min: formatTokens(min, lang) })}</small>
    : parsed !== null && parsed >= 1000 && <small>{t("tokens.hint", { short: shortTokens(parsed, lang) })}</small>;
  if (label === undefined) return <>{input}{note}</>;
  return <div className="token-field"><label>{label}{input}</label>{note}</div>;
}
