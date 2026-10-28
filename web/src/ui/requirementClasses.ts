/**
 * Requirements page utility strings (tester round 2026-10-28, batch 4a). Kept under src/ui/ like classes.ts: the panel text
 * scan (scripts/scan-panel-text.mjs) reads only src/*.tsx and must not mistake class lists for words a person reads.
 */

/** Tester #106: a row of buttons sits on one line, wraps (never overlaps) when narrow, and spaces itself with its gap. */
export const actionRow = "flex flex-wrap items-center gap-2 [&>button]:ms-0";
/** A clarification round's box (Issue #83); the one waiting on the person wears data-tone="warn", which paints its fill. */
export const roundBox = "requirement-round mb-2 rounded-control border border-line px-3 py-2 [&_ul]:my-[6px]";
export const roundSummary = "cursor-pointer font-semibold";
/**
 * Tester #83, #86: the document's heading ladder, all below the page's h3 (the requirement) and the "Document" h4 fold:
 * the title (`# `) is the top heading (h4, DESIGN.md h3 size), the `## ` sections are h5, and what a section body writes at
 * `### ` or deeper is h6.
 */
export const documentTitle = "mt-3 mb-1 text-base font-semibold";
export const documentSectionTitle = "mt-3 mb-1 text-sm font-semibold";
export const documentSubTitle = "mt-3 mb-1 text-sm font-medium";
