import { ChildSpawnFailed, oneLine, runChild, type ChildResult } from "./integrationGit.js";
import type { GroupIntegration } from "./integrationScheme.js";

/**
 * Integration spec §6.4: the `github-pr` delivery keeps one pull request per group, opened from `orca/<g>` into the
 * target once and marked ready when the group completes. Every `gh` child goes through the shared integration runner
 * (no prompt, no update notifier, a deadline) and names the repository with `--repo`, so neither `gh repo
 * set-default` nor another remote can redirect it.
 */
export type GroupPr = NonNullable<GroupIntegration["pr"]>;
export type PrStep = "after-pr-create" | "after-pr-ready";
export interface SyncGroupPrInput {
  ghBin: string;
  /** `host/owner/name`, from the remote's configured URL (githubRepoOf). */
  repo: string;
  head: string; base: string; title: string; body: string;
  /** Open the PR as a draft (trigger `task`); trigger `group` opens it ready (ruling R8). */
  draft: boolean;
  /** The group is complete: a draft PR is marked ready. */
  complete: boolean;
  pr: GroupIntegration["pr"];
  /** Where gh runs (the target repository; gh reads nothing from it while `--repo` is given). */
  cwd: string;
  /** Called after each outward step, for crash injection (Task 5's criteria). */
  onStep?: (step: PrStep) => void;
}
export type SyncGroupPrResult = { pr: GroupPr } | { blocked: string; message: string } | { transient: string };

/** gh's own words for a network failure: worth a retry, unlike anything else it says. */
function ghNetwork(stderr: string): boolean {
  return /error connecting to|could not resolve|timed out|timeout/i.test(stderr);
}

/** A failed gh call: the network backs off; anything else refuses with gh's words. */
function failure(answer: ChildResult): SyncGroupPrResult {
  const words = oneLine(answer.stderr || answer.stdout);
  return ghNetwork(answer.stderr) ? { transient: words } : { blocked: `integration-pr-refused:${words}`, message: words };
}

/**
 * Brings the group's PR to where the integration needs it: recorded (found or opened), still open, and ready once the
 * group is complete. Answers the record to keep; the caller writes it with the rest of the integration (§6.1 step 6).
 * A gh that cannot be started or is not logged in is integration-gh-unavailable; a timeout is left to the caller.
 */
export async function syncGroupPr(input: SyncGroupPrInput): Promise<SyncGroupPrResult> {
  const gh = (args: string[], stdin?: string) => runChild(input.ghBin, args, { cwd: input.cwd, ...(stdin === undefined ? {} : { input: stdin }) });
  try {
    const auth = await gh(["auth", "status", "--hostname", input.repo.split("/")[0]!]);
    if (auth.code !== 0) {
      const words = oneLine(auth.stderr || auth.stdout);
      return ghNetwork(auth.stderr) ? { transient: words } : { blocked: "integration-gh-unavailable", message: words };
    }
    let pr: GroupPr;
    if (input.pr === null) {
      const listed = await gh(["pr", "list", "--repo", input.repo, "--head", input.head, "--base", input.base, "--state", "all", "--json", "url,number,state,isDraft,headRepositoryOwner"]);
      if (listed.code !== 0) return failure(listed);
      // `--head` matches a branch name in any fork; only a PR from the repository's own owner is the group's (fix round 1, M2).
      const owner = input.repo.split("/")[1];
      const found = (JSON.parse(listed.stdout) as { url: string; number: number; state: string; isDraft: boolean; headRepositoryOwner?: { login?: string } }[])
        .filter((each) => each.headRepositoryOwner?.login === owner);
      const open = found.find((each) => each.state === "OPEN");
      if (open !== undefined) pr = { url: open.url, number: open.number, ready: !open.isDraft };
      else if (found.length > 0) return { blocked: "integration-pr-closed", message: `#${found[0]!.number} is ${found[0]!.state}` };
      else {
        const created = await gh(["pr", "create", "--repo", input.repo, "--base", input.base, "--head", input.head, ...(input.draft ? ["--draft"] : []),
          `--title=${input.title}`, "--body-file", "-"], input.body);
        if (created.code !== 0) return failure(created);
        const url = created.stdout.trim().split("\n").pop()!.trim();
        const number = /\/pull\/(\d+)$/.exec(url);
        // The PR exists but its number cannot be read: the next attempt finds it with pr list.
        if (number === null) throw new Error(`gh pr create answered no pull request URL: ${oneLine(created.stdout)}`);
        pr = { url, number: Number(number[1]), ready: !input.draft };
        input.onStep?.("after-pr-create");
      }
    } else {
      // Read once per integration: a PR closed or merged since is the person's decision (§6.4).
      const viewed = await gh(["pr", "view", "--repo", input.repo, String(input.pr.number), "--json", "state,isDraft"]);
      if (viewed.code !== 0) return failure(viewed);
      const seen = JSON.parse(viewed.stdout) as { state: string; isDraft: boolean };
      if (seen.state !== "OPEN") return { blocked: "integration-pr-closed", message: `#${input.pr.number} is ${seen.state}` };
      // Marked ready already (by the person, or by a ready whose record a crash lost): no second ready.
      pr = { ...input.pr, ready: input.pr.ready || !seen.isDraft };
    }
    if (input.complete && !pr.ready) {
      const readied = await gh(["pr", "ready", "--repo", input.repo, String(pr.number)]);
      if (readied.code !== 0) return failure(readied);
      pr = { ...pr, ready: true };
      input.onStep?.("after-pr-ready");
    }
    return { pr };
  } catch (error) {
    if (error instanceof ChildSpawnFailed) return { blocked: "integration-gh-unavailable", message: error.message };
    throw error;
  }
}
