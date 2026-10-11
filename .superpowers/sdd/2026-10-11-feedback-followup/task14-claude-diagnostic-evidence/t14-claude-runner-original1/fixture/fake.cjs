
 const fs=require('node:fs'); const cp=require('node:child_process');const envelope="{\"structured_output\":{\"changedFiles\":[\"inner-success.txt\"],\"diffPatch\":\"diff --git a/inner-success.txt b/inner-success.txt\",\"commandOutputs\":[\"inner-success\"],\"stdoutStderrLog\":\"ok\"}}";
 fs.writeFileSync("/private/tmp/t14.kz093dfc/codex-integration-MsdOPV/marker",'started');const splitAt=envelope.length-8;process.stdout.write(envelope.slice(0,splitAt));
 const tail='const fs=require("node:fs"); setTimeout(()=>{process.stdout.write(process.argv[1]);fs.appendFileSync(process.env.T14_MARKER,"tail");},25);setTimeout(()=>process.exit(0),35);';
 cp.spawn(process.execPath,['-e',tail,envelope.slice(splitAt)],{stdio:['ignore','inherit','ignore'],env:{...process.env,T14_MARKER:"/private/tmp/t14.kz093dfc/codex-integration-MsdOPV/marker"}});process.exit(0);
 