/** Taste refinement P1-3: j/k move, a agrees, c starts a correction -- never while typing, never as a chord. */
export type ReviewKeyAction = "next" | "previous" | "agree" | "correct" | null;

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function reviewKeyAction(e: { key: string; target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }): ReviewKeyAction {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null;
  const el = e.target as Element | null;
  if (el !== null && typeof (el as Element).closest === "function") {
    if (TYPING.has(el.tagName) || el.closest('[contenteditable]:not([contenteditable="false"])') !== null) return null;
  }
  switch (e.key) {
    case "j": return "next";
    case "k": return "previous";
    case "a": return "agree";
    case "c": return "correct";
    default: return null;
  }
}
