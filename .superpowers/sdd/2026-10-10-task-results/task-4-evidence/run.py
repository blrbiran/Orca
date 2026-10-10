import json,subprocess,sys
from pathlib import Path
r=Path(__file__).parent;e=json.loads((r/"env.json").read_text());name=sys.argv[1];argv=sys.argv[2:]
(r/(name+".command.json")).write_text(json.dumps(argv))
with (r/(name+".log")).open("w") as f:p=subprocess.run(argv,env=e,stdout=f,stderr=subprocess.STDOUT)
(r/(name+".rc")).write_text(str(p.returncode)+"\n");print(name,p.returncode,flush=True);sys.exit(p.returncode)
