# Primary Agent, role overrides and reviewed installation updates

Owner: Codex controller, 2026-10-11 Asia/Shanghai. Human approved primary Agent with role overrides, estimator inherits if compatible, startup observation/manual redetection/reviewed apply. Shared authority is `2026-10-11-feedback-followup-design.md`.

## 1. Effective primary and roles

Use existing defaultAgent/perAgent/estimator/reconcile preference storage. Primary UI groups agent/model/context once; preserve all inactive/missing installation preferences and existing role overrides. Group worker is primary at group scope; worker/task and reconcile keep same-agent inheritance, plan-below-panel/null masking/switch-agent isolation and frozen provenance rules. Estimator now follows group primary fields when it has no explicit role override and effective primary supports bounded single-call; explicit operator/group estimator overrides retain priority. Extend provenance as needed with named group-primary source, no guessed descriptor default.

Compatibility is resolved from actual capabilities: singleCallExecution v1, known preflight instructions/context, usage/budget/handoff capability and finite request bound where strict single-call requires. Never infer from kind or auto-substitute another model/agent. A required estimate/clarification action explains incompatibility locally. No-estimate import/confirm/execution must not globally fail because estimator is unconfigured or incompatible; allow deterministic defaults/advisory unavailable estimate. Goal-review/reconcile's real requirements remain enforced.

Show inherit concrete source/value for each field, or `必须选择 Agent（无法继承）` / `Choose an Agent; no inherited selection is available`. Retain unsupported context draft, show inline error and disable submitting invalid fields; do not silently drop it. Context options come from actual installation table and selection. Existing low-level helpers with historical drop behavior may remain for compatibility; validated UI submission blocks their lossy path. Agent switch never carries another installation's model/context. Confirm binds actual selection/provenance hash, not browser preview text.

## 2. Observation and update

Panel startup performs one read-only observation of configured exact CLI commands/versions, with bounded subprocess timeout and no provider/auth invocation. Settings show recorded/observed versions, detection unavailable separately from no change. Manual `重新检测` / `Detect again` creates server-owned preview; no periodic detection or table auto-write.

Preview DTO `orca-agent-detection-preview-v1`: previewId, baseTableHash, observedAt, installed observation rows, candidate additions and change ids. Probe existing exact command/args and preserve ids, aliases, configDir, timeouts, extras and perAgent defaults. Fresh detect's kind-keyed defaults cannot replace user table. Candidate path changes/new installations require explicit accepted choice; version changes can be accepted per installation.

Apply payload previewId/baseTableHash/acceptedChangeIds. Owner-only, CSRF for HTTP, command ledger/revision for mutation; socket Agent cannot apply human installation changes. Resolve only configured server-owned table path and owned preview, no caller path/shell command. CAS current hash, re-probe accepted identities, validate resulting table, atomic rename/private temporary file, preserve existing mode. Reject stale/conflicting/missing command/changed preview with named reason. Startup/preview failure writes no table, apply crash cannot truncate existing table.

ccloop shared observe/preview/apply helpers exposed by structured control commands and CLI as appropriate; Orca proxies through configured port, not its own arbitrary subprocess. Table update rereads existing ccloop table consumers, refreshes frontend installation/selection views. Do not reconstruct panel profile router or change frozen groups; version/path/timeout config-hash exclusions remain as existing rules. Changed configDir/kind-specific configuration still invalidates frozen authority normally. Old peer unsupported is explicit, existing Agent settings still usable.

## 3. Acceptance

Primary save preserves inactive preferences/role overrides; estimator uses group-primary model/context only when compatible, explicit overrides win, no alternate probes, no-estimate import works without estimator, required calls refuse locally. Unsupported context remains visible/unsaved and inheritance names actual source. Old frozen hashes/provenance not rewritten; new freeze canonical source accurate.

Detection zero provider/real-user-data writes; custom aliases/arguments/config preserved; bounded probe/error/unavailable; preview zero writes; apply owner boundary/CAS conflict/reprobe/atomic failure/mode preservation; updated version resolves unchanged config hash; old peer refuse without breaking ordinary work. Strict ccloop/Orca/browser mirrors updated together. Mutations remove compatibility check, field guard, CAS, custom config preservation, owner check and frozen-group protection, each caught by business criteria. Existing ccloop tests added to rather than broadened; any necessary old expectation change is individually recorded under delegated user authority.
