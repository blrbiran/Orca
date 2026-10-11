from pathlib import Path
root=Path('/private/tmp/ccloop-task14-claude-diagnostic-20261011')
trace='\nconst diagnostic = (event, detail = {}) => { if (process.env.T14_TRACE) appendFileSync(process.env.T14_TRACE, JSON.stringify({ role: ROLE, pid: process.pid, t: process.hrtime.bigint().toString(), event, ...detail }) + "\\n"); };\n'
def replace(text,a,b):
 assert a in text,a
 return text.replace(a,b,1)
p=root/'scripts/claude-phase-runner.mjs';s=p.read_text()
s='import { appendFileSync } from "node:fs";\nconst ROLE="runner";'+trace+s
s=replace(s,'child.once("close", () => {','child.on("exit", (code, signal) => diagnostic("inner-exit", { child: child.pid, code, signal }));\n  const originalKill = child.kill.bind(child); child.kill = (signal) => { diagnostic("inner-kill", { child: child.pid, signal, exitCode: child.exitCode, signalCode: child.signalCode }); const result=originalKill(signal); diagnostic("inner-kill-result", { result }); return result; };\n  child.once("close", (code, signal) => { diagnostic("inner-close", { child: child.pid, code, signal });')
s=replace(s,'const payload = JSON.stringify(value);','const payload = JSON.stringify(value);\n  diagnostic("stdout-write", { payload, stack: new Error().stack });')
s=replace(s,'(error) => (error ? reject(error) : resolve())','(error) => { diagnostic("stdout-write-callback", { error: error ? String(error) : null }); return error ? reject(error) : resolve(); }')
s=replace(s,'interruptHandled = true;','diagnostic("interrupt-enter", { signal });\n  interruptHandled = true;')
s=replace(s,'await terminateClaudeProcess(getPartialOutcomeRecoveryWindowMs(currentRequest));','diagnostic("interrupt-snapshot", { child: child?.pid, childHadExited, exitCode: child?.exitCode, signalCode: child?.signalCode });\n  await terminateClaudeProcess(getPartialOutcomeRecoveryWindowMs(currentRequest));\n  diagnostic("interrupt-after-terminate", { childHadExited, exitCode: child?.exitCode, signalCode: child?.signalCode });')
s=replace(s,'const envelope = result.envelope;','diagnostic("main-run-resolved");\n    const envelope = result.envelope;')
s=replace(s,'if (interruptHandled) {\n      return;','diagnostic("main-catch", { interruptHandled, error: String(error) });\n    if (interruptHandled) {\n      return;')
p.write_text(s)
p=root/'src/runtime/claude/claudeAgentAdapter.ts';s=p.read_text();s='const ROLE="adapter";'+trace.replace('const diagnostic = (event, detail = {})','const diagnostic = (event: string, detail: Record<string, unknown> = {})')+s
s=replace(s,'const persist = async (): Promise<Outcome> => {','const persist = async (): Promise<Outcome> => {\n      diagnostic("adapter-persist", { ...result });')
s=replace(s,'const kill = (signal: NodeJS.Signals) => {','const kill = (signal: NodeJS.Signals) => {\n        diagnostic("group-kill", { child: child.pid, signal, reason: result.reason });')
s=replace(s,'const stop = (reason: Outcome["reason"]) => {','const stop = (reason: Outcome["reason"]) => {\n        diagnostic("adapter-stop", { reason, done, code: result.code, signal: result.signal });')
s=replace(s,'exited = true; result.code = code; result.signal = signal;','diagnostic("runner-exit", { child: child.pid, code, signal });\n        exited = true; result.code = code; result.signal = signal;')
s=replace(s,'child.on("close", finish);','child.on("close", (code, signal) => { diagnostic("runner-close", { code, signal }); finish(); });')
p.write_text(s)
p=root/'tests/fixtures/fake-claude-cli.mjs';s=p.read_text();s='const ROLE="fake";'+trace+s
s=replace(s,'const mode = process.argv[2], marker = process.argv[3];','process.on("exit", (code) => diagnostic("fake-exit", { code }));\nconst mode = process.argv[2], marker = process.argv[3];')
s=replace(s,'writeFileSync(`${marker}.answered`, "1");','writeFileSync(`${marker}.answered`, "1");\n        diagnostic("answered-marker", { marker });\n        if (process.env.T14_PREEXIT_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.T14_PREEXIT_MS)));')
p.write_text(s)
