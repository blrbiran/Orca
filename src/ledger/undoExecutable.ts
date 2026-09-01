/**
 * spec §3.8 check 3: does undo.how contain an "executable form"?
 * The predicate is defined by decision orca-dev-09cc3ea1/4 — spec only gives
 * 3 legal and 3 illegal examples, not a rule.
 *
 * Known weakness (not hidden): the named-target clause only requires the
 * presence of one camelCase/snake_case identifier or path-like token, so prose
 * that happens to contain an identifier (e.g. "把 targetPaths 那事儿处理一下")
 * will pass the gate. This is a deliberate floor: spec §1.1.1 itself lists
 * "naming the concrete file and field to change" as legal.
 */

const PROGRAM_WORD = /^[a-z][a-z0-9._-]*$/;
const ANGLE_PLACEHOLDER = /^<.+>$/;
const FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
const NAMED_TARGET = /[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*_[a-z][a-z0-9_]*|\S*\/\S+/;

function isArgShaped(token: string): boolean {
  return (
    token.startsWith("-") ||
    token.includes("/") ||
    token.includes("=") ||
    token.includes("*") ||
    ANGLE_PLACEHOLDER.test(token) ||
    FILE_NAME.test(token)
  );
}

/** Command shape: an adjacent token pair where the first looks like a program name and the second like an argument. */
function hasCommandShape(how: string): boolean {
  const tokens = how.split(/\s+/).filter((t) => t.length > 0);
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (PROGRAM_WORD.test(tokens[i]) && isArgShaped(tokens[i + 1])) {
      return true;
    }
  }
  return false;
}

/** Named-target shape: names a specific file or field. */
function hasNamedTarget(how: string): boolean {
  return NAMED_TARGET.test(how);
}

export function undoHowIsExecutable(how: string): boolean {
  return hasCommandShape(how) || hasNamedTarget(how);
}
