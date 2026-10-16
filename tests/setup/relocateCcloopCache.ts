import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * CLAUDE.md Rule 17 and spec 2026-10-15 §4.2: ccloop caches agent catalogs outside the repository. Every ccloop this
 * suite spawns inherits this directory (execFile without `env` passes process.env), inside this file's scoped TMPDIR.
 *
 * It also points CODEX_HOME at an empty dir under the same TMPDIR: a codex installation with configDir null reads
 * `$CODEX_HOME/config.toml` (else `$HOME/.codex/config.toml`) for `model_context_window`, so without this a criterion
 * would read the person's real ~/.codex and answer that window instead of the fake catalog's (ccloop measured it on
 * 2026-10-16: 1000000 instead of 272000; ccloop's tests/setup/relocateCatalogCache.ts does the same). Rule 17: no
 * criterion reads or writes the person's own data.
 */
process.env.CCLOOP_CACHE_DIR = mkdtempSync(join(tmpdir(), "ccache-"));
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "chome-"));
