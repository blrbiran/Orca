## Task 10: Orca worktree, cache redirection for the suite, and R7 (spec §6.3; criterion 7)

**Files:**
- Create: `tests/setup/relocateCcloopCache.ts`, `tests/control/declaredNullWindow.test.ts`
- Modify: `vitest.config.ts:10`, `src/control/profiles.ts:119-122`

- [ ] **Step 1: worktree [HUMAN decides the base].** If the human has merged `codex/round-20261015b`, cut from `main`;
  otherwise from that branch's tip -- ask. Then:

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca worktree add -b codex/every-agent-chain "$OR" <base> > "$LOGS/or-wt.txt" 2>&1
ln -s /Users/biran/code/skills/orca/Orca/node_modules "$OR/node_modules"     # and web/node_modules if the main tree has one; never git add
( cd "$OR" && npm run build --workspace web ) > "$LOGS/or-webbuild.txt" 2>&1; echo "RC=$?" >> "$LOGS/or-webbuild.txt"   # handoff §6.7
B="$(mktemp -d /private/tmp/ccb-XXXX)"; /usr/bin/git clone --local -q --branch main /Users/biran/code/skills/orca/ccloop "$B/repo"
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$B/repo/node_modules"; ( cd "$B/repo" && npm run build ) > "$LOGS/ccb-build.txt" 2>&1
export ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"     # the pushed ccloop main, built; never mutated
```

- [ ] **Step 2: setup file** `tests/setup/relocateCcloopCache.ts` (added to `vitest.config.ts` setupFiles right after
  `tests/setup/scopeTmpdir.ts`):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * CLAUDE.md Rule 17 and spec 2026-10-15 §4.2: ccloop caches agent catalogs outside the repository. Every ccloop this
 * suite spawns inherits this directory (execFile without `env` passes process.env), inside this file's scoped TMPDIR.
 */
process.env.CCLOOP_CACHE_DIR = mkdtempSync(join(tmpdir(), "ccache-"));
```

- [ ] **Step 3: failing test** `tests/control/declaredNullWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
import type { CapabilityViewV1 } from "../../src/control/webProtocol.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.3, human ruling R7 (criterion 7): a profile's `contextWindowTokens: null` means "not declared", so the
// intersection takes ccloop's observed window; two numbers still take the smaller; an observed null stays null.
const declared = (window: number | null) => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });
const observed = (window: number | null): CapabilityViewV1 => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });

describe("a declared-null window (R7)", () => {
  it("takes the observed window, the smaller of two, and keeps an observed null", () => {
    expect([
      intersectCapabilities(declared(null), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(200000), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(null), observed(null)).contextWindowTokens,
      intersectCapabilities(declared(300000), observed(null)).contextWindowTokens,
    ]).toEqual([272000, 200000, null, null]);
  });

  it("has no context-unavailable when ccloop reports a window under a null-declaring profile, and has it when ccloop reports none", () => {
    const snapshot = profileSnapshot(); snapshot.profile.capabilities = declared(null);
    const profile = resolveProfile(snapshot);
    const at = (window: number | null) => estimatorCompatibility({ profile, observed: observed(window), probeFailureCode: null, resolution: fixtureResolutionFor(observed(window)) }, "soft").reasonCodes;
    expect([at(272000).includes("context-unavailable"), at(null).includes("context-unavailable")]).toEqual([false, true]);
  });
});
```

- [ ] **Step 4: red.** P-2 (cwd `$OR`, `./node_modules/.bin/vitest run tests/control/declaredNullWindow.test.ts`) → `$LOGS/t10-red.log`.

- [ ] **Step 5: implement** `src/control/profiles.ts:119-122`:

```ts
    // Spec 2026-10-15 §6.3, human ruling R7: a declared null is "not declared", so the observed window is taken; an observed
    // null stays null (Orca never invents a window ccloop did not state); two numbers take the smaller.
    contextWindowTokens:
      observed.contextWindowTokens === null ? null
        : declared.contextWindowTokens === null ? observed.contextWindowTokens
          : Math.min(declared.contextWindowTokens, observed.contextWindowTokens),
```

- [ ] **Step 6: green and the R7 sweep.** P-2 the new file → green. Then the whole backend control suite with the built
  pushed ccloop: `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js" ./node_modules/.bin/vitest run tests/control tests/panel --reporter=json --outputFile="$LOGS/t10-sweep.json"`
  → `$LOGS/t10-sweep.log`. Every red that is not a known load flake (Orca `known-load-flakes.md`, re-run alone 3×) is a
  criterion R7 or the new ccloop changed: compare with P-5. Expected newly red: **E6 only** (`webCcloopSmoke.test.ts:156-159`).
  **[HUMAN] name E6**; rewrite line 158 `contextWindowTokens: 272000` with the comment
  `Rewritten for the every-agent requirement chain (spec 2026-10-15 §6.1; human named E6 on <date>): ccloop now reads codex's window from its catalog (the build's fake codex answers 272000 for gpt-6-sol).`
  Any red not in P-5: stop, name it to the human, do not edit. For each prose line in P-5 that a run proves false, append
  an ERRATUM line beside it (Orca handoff §6.2).

- [ ] **Step 7: mutation.** M10.1 the new expression → the old one (`declared !== null && observed !== null ? min : null`)
  ⇒ red both tests in `declaredNullWindow.test.ts`. M10.2 delete the setup-file line from `vitest.config.ts` and run
  `tests/control/webCcloopSmoke.test.ts` with `HOME="$M/fakehome"`: an entry appears under `$M/fakehome/.cache/ccloop`
  (recorded; proves the setup file is what redirects).

- [ ] **Step 8: commit** `src/control/profiles.ts tests/control/declaredNullWindow.test.ts tests/setup/relocateCcloopCache.ts vitest.config.ts tests/control/webCcloopSmoke.test.ts`
  plus `git add -f .superpowers/sdd/2026-10-15-every-agent-chain/progress.md`, subject
  `feat(control): a declared-null context window takes ccloop's observed window (R7)`.

---

