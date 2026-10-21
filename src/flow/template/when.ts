/**
 * Flow engine spec §3.2 `when`: a structured predicate, evaluated by code (Rule 5). No expression strings.
 * `truthy` compares the param's JavaScript truthiness (an absent param is falsy); `equals` and `in` are strict.
 * A classification predicate is false until the run has a classification.
 */
import type { WhenPredicate } from "./schema.js";

export type ParamValue = string | number | boolean;
export interface WhenInput {
  params: Readonly<Record<string, ParamValue | undefined>>;
  classification: { scope?: string; clarity?: string } | null;
}

export function evaluateWhen(pred: WhenPredicate, input: WhenInput): boolean {
  if ("and" in pred) return pred.and.every((inner) => evaluateWhen(inner, input));
  if ("or" in pred) return pred.or.some((inner) => evaluateWhen(inner, input));
  if ("not" in pred) return !evaluateWhen(pred.not, input);
  if ("classification" in pred) {
    const actual = input.classification;
    if (actual === null) return false;
    const want = pred.classification;
    return (want.scope === undefined || want.scope === actual.scope) && (want.clarity === undefined || want.clarity === actual.clarity);
  }
  const value = input.params[pred.param];
  if ("equals" in pred) return value === pred.equals;
  if ("in" in pred) return value !== undefined && pred.in.includes(value);
  return Boolean(value) === pred.truthy;
}
