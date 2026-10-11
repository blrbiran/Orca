# Fresh merged-source verification and local integration evidence

Controller, 2026-10-11. This technical gate record covers completed Tasks 1–7. Tasks 8–14 remain pending; the executive handoff is chat-only.

Task 7 R1 and final cross-repository spec/quality reviews are Approved at Orca a3ac/ccloop299. Documentation-only f547/262 preserve the approved product. Fresh no-hardlink clones came from the actual locally merged mains: Orca262, source e06660e08eda57b03118ea1618d049f4f3a193b4b2c2416f9e3a0d84d9f2ae17/934; ccloop299, source76f6212cd9630233b5cef758bf5e794d5996d4bb6b135428892fef5b5ca01c28/446. These are historical gate identities, not fixed live HEAD instructions.

| Fresh gate | Actual result |
| --- | --- |
| Orca types/build/Web assets | All RC0; assets built before root/panel |
| Full Web | 106 files, 926 passed, zero skips, RC0 |
| Whole root plus formal-control inclusion | 391 files, 3695 passed, 30 named conditional skips, RC0 |
| Actual verify:saved-result | 2 files, all23 passed, zero skips, RC0 |
| Actual verify:panel | All15 PASS steps0–14, RC0 |
| ccloop types/build | Both RC0 |
| ccloop whole serial suite | 147 files, 1566 passed, zero skips, RC0 |

Root includes every tracked root test file; control169/1840pass/27skip and panel73/608pass. Its realpath preflight and ORCA_CONTROL_VERIFY=1/maxWorkers4 are preserved; no separate verify:control script invocation is claimed. The dedicated native gate uses exact oldc2/5b producers, fresh main299 CLI and actual immutable f00 schema11 reader build0/storeSHA32c186. All147 ccloop tracked files and assertions were visited; fileParallelism=false/max-minWorkers1. No gate was filtered or repeated. Actual runtime is Node22.13.1/libuv1.49.2/darwinarm64; older Node24 evidence is historical.

All10 run raw/meta, three complete JSON reports, exact helpers and source/inclusion/skip audits are in handoff-merged-evidence/manifest.json, with47 byte/hash attachments. Complete raw bytes were read/hash-checked programmatically and every JSON assertion/status inspected; this does not claim model-side line-by-line reading of every root/ccloop stdout line. Native93 and panel21 lines were read completely. Native reporter has only a final summary; correcting an audit helper's per-file-line assumption was not a product gate failure or rerun. Raw logs remain verbatim, with Vite/SQLite advisory output retained.

The30 actual root skipped names/conditions are in skip-inventory.json:23 opt-in native criteria separately passed23/23, three default-installed-package criteria (flag1 and BIN unset), one realccmem, two realsyncskill and one real launchd criterion. Real services are unauthorized; those external gates remain deferred Task14 scope. Historical abcbe native/root and final e066 UI evidence remain separate; these new root/Web/native/panel gates truly bind e066.

All934 declared Orca and446 ccloop bytes match source main, implementation and fresh clones. Real Orca additionally has the existing ignored web/src/.ccmem/context-08011394.md, 2275bytes/SHA4ac3b878c58a6b44a34a88b8d18154155035446a1d5f1c46a21ea202b1ca451e. Its content was not copied, printed or deleted. The935-file physical hash55866d33… is not relabeled e066. Hash ordering exactly matches the runner's Python Path ordering.

Original failure/history WORK, separate new V accounting, explicit successful retry receipt versus positive NoDispatch proof, all four caps/unknown/stop guards and schema12 old-owner fence remain. Ordinary ref-missing archives/current malformed capsules/transformed Claude streams stay unavailable; complete archive primitives are not standard-old lifecycle recovery. Old Claude duplicate-publication/stale-exit races remain Task14 debt; serial green does not repair them.

No push/release/default repin, paid provider, live DB upgrade/backup/owner retirement, service/data-root switch, browser geometry or Linux-native capture acceptance. Default pinab824d1 stays. ccmem changes only handoff; its prior25/25 config-parity gate is historical. Final source main clean/ancestry, Git-config bytes, original21-path Results5 WIP, ignored-memory preservation and read-only remote observations are recorded in final-local-state.json. The optional clean managed stub and private evidence clones are retained; no additional cleanup is needed.
