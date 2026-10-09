from pathlib import Path
p=Path('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca/tests/control/fixtures/controlPollPerformance.ts');s=p.read_text()
s=s.replace('async function assertTemporaryFixtureRoot(root:string):Promise<void> {','async function assertTemporaryFixtureRoot(root:string,temporaryNamespace?:string):Promise<void> {')
old=' if(!temporaryRoots.some(parent=>{const path=relative(parent,candidate);return path!==""&&path!==".."&&!path.startsWith("../")&&!isAbsolute(path);}))throw new Error("control-poll-fixture-root-not-temporary");'
new=' const within=(parent:string)=>{const path=relative(parent,candidate);return path!==""&&path!==".."&&!path.startsWith("../")&&!isAbsolute(path);};\n if(!temporaryRoots.some(within))throw new Error("control-poll-fixture-root-not-temporary");\n // Per-call setup restrictions intersect the OS temporary bounds; they cannot broaden them.\n if(temporaryNamespace!==undefined && !within(await canonical(temporaryNamespace)))throw new Error("control-poll-fixture-root-not-temporary");'
assert s.count(old)==1;s=s.replace(old,new)
s=s.replace('tasksPerGroup:number;now:number}): Promise<ControlPollFixture> {','tasksPerGroup:number;now:number},temporaryNamespace?:string): Promise<ControlPollFixture> {')
s=s.replace(' await assertTemporaryFixtureRoot(root);',' await assertTemporaryFixtureRoot(root,temporaryNamespace);')
s=s.replace('openExistingControlPollFixture(now:number):Promise<ControlPollFixture> {','openExistingControlPollFixture(now:number,temporaryNamespace?:string):Promise<ControlPollFixture> {')
s=s.replace(' await assertTemporaryFixtureRoot(performanceRoot());',' await assertTemporaryFixtureRoot(performanceRoot(),temporaryNamespace);')
p.write_text(s)
