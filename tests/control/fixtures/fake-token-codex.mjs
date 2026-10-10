// Test-only transformer around ccloop's existing fake provider. No real CLI/provider.
import { spawn } from "node:child_process";
const child=spawn(process.execPath,process.argv.slice(2),{stdio:["pipe","pipe","inherit"]});
process.stdin.pipe(child.stdin);let output="";child.stdout.on("data",chunk=>output+=chunk);
child.on("exit",code=>{process.stdout.write(output.replaceAll('"input_tokens":12','"input_tokens":1599997'),()=>{process.exitCode=code??1;});});
