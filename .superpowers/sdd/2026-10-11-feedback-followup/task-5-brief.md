### Task 5: Deterministic execute normalization and durable format-failure capsules

**Files:** ccloop `runtime/codex/{protocol,codexAdapter}.ts`, `controller/runLoop.ts`, `control/{worker,protocol,collect,evidence}.ts` ; create `runtime/executionNormalizer.ts`, `controller/executionFormatFailure.ts`; focused runtime/controller/control tests.
**Interfaces:** `normalizeExecutionFinal(final:string):ExecutionNormalization` distinguishes unique validated execution and unavailable typed reason; `ExecutionFormatFailure` preserves eligible process/events/usage facts through PhaseExecutionError. `captureExecutionFormatFailure(input):Promise<ArtifactRef|null>` publishes strict capsule defined by recovery spec plus full snapshot refs. Expose capsule in collected evidence without changing old report bytes when absent.
- [ ] Step1: RED direct/enveloped/decorated valid complete/partial; ambiguous valid+invalid/hidden/lossy-report collisions refuse; plan/verify behavior unchanged. Failed decode retains finite event/model usage.
- [ ] Step2: Reuse bounded scanner semantic candidate identity; preserve original bytes/normalization evidence. No synthesized fields or model repair.
- [ ] Step3: RED capsule actual original attempt/base/contract/final/event/plan hashes, positive verifier-not-entered, full tree/index/bundle/untracked snapshot before cleanup, capture failure never eligible. Implement immutable/fsynced capsule and recursive evidence collection/private refs under owner fence.
- [ ] Step4: Full ccloop tests/build/type; mutations wrapping ambiguity/usage capture/source identity/snapshot before cleanup; commit `feat(recovery): retain strict execution format failure evidence` and independent review.

