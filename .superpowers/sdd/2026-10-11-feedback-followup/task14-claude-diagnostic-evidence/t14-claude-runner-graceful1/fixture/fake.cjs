
 const fs=require('node:fs'); const cp=require('node:child_process');
 process.on('SIGTERM',()=>{fs.appendFileSync("/private/tmp/orca-followup-runs/t14-claude-runner-graceful1/probe/trace.jsonl",JSON.stringify({role:'graceful-fake',pid:process.pid,event:'SIGTERM-exit0',t:process.hrtime.bigint().toString()})+'\n');process.exit(0);});
 process.stdout.write("{\"structured_output\":{\"changedFiles\":[\"inner-success.txt\"],\"diffPatch\":\"diff --git a/inner-success.txt b/inner-success.txt\",\"commandOutputs\":[\"inner-success\"],\"stdoutStderrLog\":\"ok\"}}");
 cp.spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),100)'],{stdio:['ignore','inherit','ignore']});
 fs.writeFileSync("/private/tmp/t14.3v_qjzrz/codex-integration-tNqgZV/marker",'started'); setInterval(()=>{},1000);
 