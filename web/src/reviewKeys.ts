/** Taste refinement P1-3: j/k move, a agrees, c starts a correction -- never while typing, never as a chord. */
export type ReviewKeyAction = "next" | "previous" | "agree" | "correct" | null;

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

type KeyFacts = { key: string; target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean };

/** A chord, a repeat, or a key typed into a field: never a page shortcut. */
function typingOrChord(e: KeyFacts): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return true;
  const el = e.target as Element | null;
  return el !== null && typeof (el as Element).closest === "function"
    && (TYPING.has(el.tagName) || el.closest('[contenteditable]:not([contenteditable="false"])') !== null);
}

export function reviewKeyAction(e: KeyFacts): ReviewKeyAction {
  if (typingOrChord(e)) return null;
  switch (e.key) {
    case "j": return "next";
    case "k": return "previous";
    case "a": return "agree";
    case "c": return "correct";
    default: return null;
  }
}

/** Issue #57: `r` retries the group view's open task, under the same guards as the review keys. */
export function isRetryKey(e: KeyFacts): boolean {
  return !typingOrChord(e) && e.key === "r";
}
