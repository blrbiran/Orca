### Task 9: ccloop installation observation and durable apply

**Files:** create agents `updates.ts`, `updateReceipt.ts`; modify agents table/detect/materialize and control command/features; add structured observation/preview/apply CLI paths; tests agents update/detect/control.
**Interfaces:** strict AgentDetectionPreview/ApplyAgentDetection from agent spec, configuredtable-owned preview/intents/receipts and shared table lock; apply(opId,requestDigest,previewId,baseHash,changeIds) returns immutable before/after receipt, replay same result. `features.agentInstallationUpdate='v1'` only after complete.
- [ ] Step1: RED startup/manual observation no provider/table writes, exactcustomaliases/argv/config preserved, unavailable separate, boundedprobe/process-tree cleanup; preview changedversions/newpaths separate approved choices.
- [ ] Step2: Implement no-follow reads, private adjacent updates directory/files/lock, owned previewvalidation, serialized CAS/reprobe, durableintent/rename/receipt, existingmode preservation.
- [ ] Step3: Two-process simultaneous applies one wins/other stale; crashbefore/afterrename/beforereceipt recover same op bybeforeafter hashes, thirdstate conflicts; replaycompleted beforeCAS, altereddigest refuses. No caller tablepaths or shell commands.
- [ ] Step4: Full ccloop tests/build/type and clone mutants lock/CAS/receipt/customsettings/probecleanup; commit `feat(agents): detect and apply installation changes with durable receipts`, review.
