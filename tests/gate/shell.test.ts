import { describe, expect, it } from "vitest";
import { parseShell } from "../../src/gate/shell.js";

const texts = (src: string) => parseShell(src).commands.map((c) => c.words.map((w) => w.text));

describe("parseShell (Tier 0 gate spec 3.1)", () => {
  it("splits simple commands on ; && || | & and newlines, keeping quoted text as one word", () => {
    expect(texts(`a 'b c' "d e"; f && g || h | i & j\nk`)).toEqual([["a", "b c", "d e"], ["f"], ["g"], ["h"], ["i"], ["j"], ["k"]]);
  });

  it("marks $, substitutions and unquoted globs as dynamic, but not single-quoted ones", () => {
    const words = parseShell(`x $A "$B" '$C' *.ts '*' ab`).commands[0].words;
    expect(words.map((w) => [w.text, w.dynamic])).toEqual([
      ["x", false], ["$A", true], ["$B", true], ["$C", false], ["*.ts", true], ["*", false], ["ab", false],
    ]);
  });

  it("collects command substitution bodies, inside double quotes too", () => {
    const p = parseShell('echo $(git push) "`git branch -D x`" \'`not me`\'');
    expect(p.substitutions).toEqual(["git push", "git branch -D x"]);
  });

  it("keeps a quoted heredoc body as data and attaches it to its command", () => {
    const p = parseShell("git commit -F - <<'EOF'\nfix: do not git push $(x)\nEOF\necho done");
    expect(p.commands.map((c) => c.words.map((w) => w.text))).toEqual([["git", "commit", "-F", "-"], ["echo", "done"]]);
    expect(p.commands[0].heredocs).toEqual([{ body: "fix: do not git push $(x)\n", quoted: true }]);
    expect(p.substitutions).toEqual([]);
    expect(p.problem).toBeNull();
  });

  it("scans an unquoted heredoc body for substitutions; <<- strips leading tabs before the delimiter", () => {
    const p = parseShell("cat <<-EOF\n\tsee `git push`\n\tEOF\n");
    expect(p.substitutions).toEqual(["git push"]);
    expect(p.commands[0].heredocs[0].quoted).toBe(false);
  });

  it("skips a heredoc inside $( ) so apostrophes and parentheses in its body do not end the substitution", () => {
    const p = parseShell(`git commit -m "$(cat <<'EOF'\ndon't (really) git push)\nEOF\n)"`);
    expect(p.problem).toBeNull();
    expect(p.substitutions).toEqual(["cat <<'EOF'\ndon't (really) git push)\nEOF\n"]);
    expect(p.commands[0].words.map((w) => w.text)[2]).toBe("-m");
  });

  it("drops redirection targets and fd numbers from words", () => {
    expect(texts("git merge x > out.txt 2>&1")).toEqual([["git", "merge", "x"]]);
    expect(texts("a &> log; b >> f")).toEqual([["a"], ["b"]]);
    expect(texts("git merge y <<< x")).toEqual([["git", "merge", "y"]]);
  });

  it("treats parentheses and whole-word braces as grouping separators", () => {
    const p = parseShell("(cd ../x && git merge y); { git push; }");
    expect(p.grouping).toBe(true);
    expect(p.commands.map((c) => c.words.map((w) => w.text))).toEqual([["cd", "../x"], ["git", "merge", "y"], ["git", "push"]]);
    expect(parseShell("git rev-parse @{u}").grouping).toBe(false);
    expect(parseShell("(git push)").grouping).toBe(true);
  });

  it("names the first problem", () => {
    expect(parseShell(`git push "x`).problem).toBe("unterminated double quote");
    expect(parseShell(`git push 'x`).problem).toBe("unterminated single quote");
    expect(parseShell("echo $(git push").problem).toBe("unterminated command substitution");
    expect(parseShell("echo `git push").problem).toBe("unterminated backquote");
    expect(parseShell("cat <<EOF\nno end\n").problem).toBe("heredoc delimiter EOF not found");
  });

  it("ignores comments and joins backslash-newline", () => {
    expect(texts("# git push\ngit \\\nstatus")).toEqual([["git", "status"]]);
  });
});
