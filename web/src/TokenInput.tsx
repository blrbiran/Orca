/**
 * Spec §9.2 item 3: a token amount is an integer shown grouped by the app language ("10,000,000") with a magnitude
 * hint ("≈ 10M" / "约 1000 万"). Typing accepts digits grouped by `,`, space, U+00A0 or U+202F; anything else is
 * refused in the field and never reaches `onChange`, so callers only ever hold a whole number.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { currentLanguage } from "./i18n.js";

const SEPARATORS = /[,   ]/g;

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
  min?: number;
  readOnly?: boolean;
  "aria-label"?: string;
}

export function TokenInput({ value, onChange, onInvalid, min = 0, readOnly, "aria-label": ariaLabel }: TokenInputProps): JSX.Element {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [text, setText] = useState(value === null ? "" : formatTokens(value, lang));
  // A value changed from outside (a suggestion applied, a draft restored) replaces the text; typing that parses to the
  // value already held does not, so a half-typed "12," is left alone.
  useEffect(() => {
    if (value !== null && parseTokens(text) !== value) setText(formatTokens(value, lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, lang]);
  const parsed = parseTokens(text);
  const invalid = text.trim() !== "" && (parsed === null || parsed < min) || (text.trim() === "" && value !== null);
  return (
    <>
      <input
        type="text" inputMode="numeric" value={text} readOnly={readOnly} aria-label={ariaLabel} aria-invalid={invalid || undefined}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setText(raw);
          const n = parseTokens(raw);
          if (n !== null && n >= min) onChange(n);
          else onInvalid?.();
        }}
        onBlur={() => { if (parsed !== null && parsed >= min) setText(formatTokens(parsed, lang)); }}
      />
      {invalid
        ? <small role="alert" style={{ color: "red" }}>{t("tokens.invalid", { min: formatTokens(min, lang) })}</small>
        : parsed !== null && parsed >= 1000 && <small>{t("tokens.hint", { short: shortTokens(parsed, lang) })}</small>}
    </>
  );
}
