### Task 10: Orca installation update authorization/outbox/UI

**Files:** create control `agentUpdates.ts`; modify schema11migration/commandLedger/commandClient/webProtocol/webService/executionPort/ccloopPort/panel controlAssembly/controlApi/auth; web AgentSettings/GlobalSettings/App/controlApi/controlTypes/locales; root/panel/Web tests.
**Interfaces:** owner GET observation/POST preview/readpreview and ledgered `apply-agent-update` operator command, schema11 durable pending operation outbox/revision; consume Task9 sameoperation receipt beforefinalize. Startup read-only observation1, reconcilepending beforeconflictingapply.
- [ ] Step1: RED owner/CSRF/socketAgent boundary, startup0writes, manualpreview0writes, CAS stale, frozenpreferencesunchanged, oldpeer unaffectedordinarysettings; no recurring timer.
- [ ] Step2: Reservecommand/revision synchronously beforeexternalcall, dispatchsameid, finalizeonlyreceipt; crashafterreceiptbeforeSQLite finalize/reload repeats0mutation and yields retainedresult. Add readprojection/versionwarning and explicitapplyacceptedchanges UI.
- [ ] Step3: Refreshinstallation/effectivepreview without routerreassembly or frozenrewrite; operationunknown promptnoauto duplicate. Exactconfiguredpaths only, unavailable notnochange.
- [ ] Step4: Full control/panel/Web/type/build, pairedreceiptrace/crash, mutants owner/outbox/id/CAS/frozen; commit `feat(panel): review installation updates and reconcile their receipts`, review.
