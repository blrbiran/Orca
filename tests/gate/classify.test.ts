// tests/gate/classify.test.ts
import { describe, expect, it } from "vitest";
import { type BranchOf, blockMessage, classify } from "../../src/gate/classify.js";

/** Absolute path → branch; any other path throws, so an unneeded lookup shows up as a block. */
const branches =
  (map: Record<string, string> = {}): BranchOf =>
  async (dir) => {
    if (dir in map) return map[dir];
    throw new Error(`no branch for ${dir}`);
  };
const push = { kind: "block", action: "push" };
const del = { kind: "block", action: "delete a branch" };
const wt = { kind: "block", action: "remove a worktree" };
const gh = { kind: "block", action: "outward gh write" };
const merge = { kind: "block", action: "merge into main" };
const unclear = (reason: string) => ({ kind: "block", action: "this command", unclear: reason });
const allow = { kind: "allow" };

type Row = [command: string, map: Record<string, string>, expected: object];
const ON_MAIN = { "/r": "main" };
const ON_FEAT = { "/r": "feat" };

const rows: Row[] = [
  // push, in the forms spec 3.1 says need no wrapper list
  ["git push", {}, push],
  ["git -C x push", {}, push],
  ["X=1 git push", {}, push],
  ["env X=1 git push", {}, push],
  ["rtk git push", {}, push],
  ["rtk proxy git push", {}, push],
  ["/usr/bin/git push", {}, push],
  ["timeout 5 git push", {}, push],
  ["a && git push", {}, push],
  ["a; git push", {}, push],
  ["a | git push", {}, push],
  ["(git push)", {}, push],
  ['sh -c "git push"', {}, push],
  ['bash -lc "git push"', {}, push],
  ["zsh -c 'git push'", {}, push],
  ['eval "git push"', {}, push],
  ["echo $(git push)", {}, push],
  ['echo "`git push`"', {}, push],
  ["bash <<'EOF'\ngit push\nEOF", {}, push],
  ["git commit -F - <<EOF\nsee `git push`\nEOF", {}, push],
  ["git -P push", {}, push],
  ["git --no-pager push", {}, push],
  ["git -c a=b push", {}, push],
  ["git --git-dir=.git push", {}, push],
  ["git --work-tree . push", {}, push],
  ["git --namespace=n push", {}, push],
  ["git -p push", {}, push],
  ["git --paginate push", {}, push],
  ["git --bare push", {}, push],
  ["git --no-replace-objects push", {}, push],
  ["git --no-optional-locks push", {}, push],
  ["git --literal-pathspecs push", {}, push],
  // branches and worktrees
  ["git branch -d x", {}, del],
  ["git branch -D x", {}, del],
  ["git branch -Dq x", {}, del],
  ["git branch --delete x", {}, del],
  ["git update-ref -d refs/heads/x", {}, del],
  ["git worktree remove w", {}, wt],
  ["git worktree prune", {}, wt],
  // gh
  ["gh pr merge 1", {}, gh],
  ["gh repo sync", {}, gh],
  ["gh api -X DELETE repos/o/r/git/refs/heads/x", {}, gh],
  ["gh api -XDELETE a", {}, gh],
  ["gh api --method=POST a", {}, gh],
  ["gh api --method PATCH a", {}, gh],
  ["gh api repos/o/r/issues -f title=x", {}, gh],
  ["gh api a --input body.json", {}, gh],
  // merge into main whatever the branch
  ["git branch -f main x", {}, merge],
  ["git branch --force main x", {}, merge],
  ["git branch -M x main", {}, merge],
  ["git update-ref refs/heads/main abc", {}, merge],
  ["git checkout -B main", {}, merge],
  ["git switch -C main", {}, merge],
  ["git switch --force-create main", {}, merge],
  ["git fetch . feat:main", {}, merge],
  ["git fetch origin +main:refs/heads/main", {}, merge],
  ["git rebase feat main", {}, merge],
  // merge into main by the current branch
  ["git merge x", ON_MAIN, merge],
  ["git pull", ON_MAIN, merge],
  ["git rebase x", ON_MAIN, merge],
  ["git reset HEAD~1", ON_MAIN, merge],
  ["git reset --soft HEAD~1", ON_MAIN, merge],
  ["git reset file", ON_MAIN, merge],
  ["cd ../x && git merge y", { "/r": "feat", "/x": "main" }, merge],
  ["git -C ../x merge y", { "/r": "feat", "/x": "main" }, merge],
  ["git -C a -C b merge y", { "/r": "feat", "/r/a": "feat", "/r/a/b": "main" }, merge],
  // undecidable
  ["git $SUB", {}, unclear("the git subcommand is not a literal word")],
  ['git -C "$DIR" merge x', {}, unclear("cannot resolve the directory of -C $DIR")],
  ["git -X push", {}, unclear("unknown git option -X before the subcommand")],
  ["git checkout main && git merge feat", ON_FEAT, unclear("an earlier git call in this command may have switched branches")],
  ["git --git-dir=../x/.git merge y", ON_FEAT, unclear("--git-dir, --work-tree, GIT_DIR or GIT_WORK_TREE names another repository")],
  ["GIT_DIR=../x/.git git merge y", ON_FEAT, unclear("--git-dir, --work-tree, GIT_DIR or GIT_WORK_TREE names another repository")],
  ["(cd ../x && git merge y)", { "/r": "main", "/x": "feat" }, unclear("the command has a subshell or a group")],
  ["cd ~/x && git merge y", ON_FEAT, unclear("cannot resolve the directory of cd ~/x")],
  ["cd - && git merge y", ON_FEAT, unclear("cannot resolve the directory of cd -")],
  ["cd && git merge y", ON_FEAT, unclear("cannot resolve the directory of cd")],
  ["git merge y", {}, unclear("cannot read the current branch of /r: no branch for /r")],
  ['git push "unterminated', {}, unclear("unterminated double quote")],
  // allowed
  ["git status", {}, allow],
  ["git log --oneline -3", {}, allow],
  ["git ls-remote origin refs/heads/main", {}, allow],
  ["git commit -m x", {}, allow],
  ["git commit --amend", {}, allow],
  ["git cherry-pick abc", {}, allow],
  ["git reset", ON_MAIN, allow],
  ["git reset HEAD -- f", ON_MAIN, allow],
  ["git reset -q HEAD", ON_MAIN, allow],
  ["git checkout main", {}, allow],
  ["git merge-base --is-ancestor a b", {}, allow],
  ["git merge x", ON_FEAT, allow],
  ["git rebase x", ON_FEAT, allow],
  ["git branch --show-current", {}, allow],
  ["git branch -m old new", {}, allow],
  ["git worktree list", {}, allow],
  ["git commit -F - <<'EOF'\nfix: never git push here\nEOF", {}, allow],
  [`git commit -m "$(cat <<'EOF'\ndon't git push (yet)\nEOF\n)"`, {}, allow],
  ["git commit -m 'see `git push`'", {}, allow],
  ['echo "git push"', {}, allow],
  ['grep -n "git push" f', {}, allow],
  ["gh pr view 1", {}, allow],
  ["gh api repos/o/r", {}, allow],
  ["gh api -X GET repos/o/r", {}, allow],
  ["ls -la", {}, allow],
  ['echo "unterminated', {}, allow],
  ["cd ../x && git merge y", { "/r": "main", "/x": "feat" }, allow],
];

describe("classify (Tier 0 gate spec 3.1-3.4, 6.1)", () => {
  it.each(rows)("%s", async (command, map, expected) => {
    expect(await classify(command, "/r", branches(map))).toEqual(expected);
  });

  it("renders the one stderr line, literally (spec 3.5)", () => {
    expect(blockMessage({ kind: "block", action: "push" })).toBe(
      "orca gate: push is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.",
    );
    expect(blockMessage({ kind: "block", action: "this command", unclear: "unterminated double quote" })).toBe(
      "orca gate: this command is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work. Could not decide: unterminated double quote.",
    );
  });

  it("refuses to recurse without bound", async () => {
    // Ten levels of eval "…" around `git status`: each level is one recursion, so the innermost exceeds depth 8.
    const deep = Array.from({ length: 10 }).reduce<string>((s) => `eval ${JSON.stringify(s)}`, "git status");
    expect(await classify(deep, "/r", branches())).toEqual(unclear("nested more than 8 levels deep"));
  });
});
