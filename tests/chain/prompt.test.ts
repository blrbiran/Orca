import { describe, expect, it } from "vitest";
import { GUARDED_PATHS } from "../../src/chain/facts.js";
import { chainPrompt } from "../../src/chain/prompt.js";

const INPUT = {
  chainId: "chain-0000000a",
  n: 2,
  goal: "Add a comment to\nthree files, one per commit.",
  sessionId: "22222222-0000-4000-8000-000000000002",
  repo: "/work/orca-clone",
  resumeText: "checkpoint: /work/orca-clone/.orca/checkpoints/orca-dev-11111111.json\nrun orca-dev-11111111, session 11111111-0000-4000-8000-000000000001\n",
};

describe("chainPrompt (D-launch spec §3.3)", () => {
  it("PR1 names the chain, the session number and this session's id, and carries the goal verbatim", () => {
    const p = chainPrompt(INPUT);
    expect(p).toContain("You are session 2 of an unattended orca chain (chain-0000000a). No person is watching.\n");
    expect(p).toContain("\nAdd a comment to\nthree files, one per commit.\n");
    expect(p).toContain("Your session id is 22222222-0000-4000-8000-000000000002. The resume output below prints the PREVIOUS session's id; do not use that one.");
  });
  it("PR2 gives the full write command for this session, with the target repository's own CLI (plan PC-11)", () => {
    expect(chainPrompt(INPUT)).toContain(
      "'/work/orca-clone/node_modules/.bin/tsx' '/work/orca-clone/src/cli.ts' 'checkpoint' 'write' '--repo' '/work/orca-clone' '--session' '22222222-0000-4000-8000-000000000002' '--draft' <draft.json>",
    );
  });
  it("PR3 lists every guarded path and ends with the resume output", () => {
    const p = chainPrompt(INPUT);
    for (const path of GUARDED_PATHS) expect(p).toContain(path);
    expect(p).toContain(".claude/settings.local.json");
    expect(p.endsWith(`orca resume output:\n${INPUT.resumeText}`)).toBe(true);
  });
});
