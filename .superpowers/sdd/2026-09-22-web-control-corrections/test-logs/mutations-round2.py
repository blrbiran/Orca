import json, subprocess

MUT = "/tmp/orca-mut-0922"
SRC = "/Users/biran/code/skills/loop/Orca"
TEST = "tests/control/checkpointRecoverability.test.ts"

MUTATIONS = [
    ("M3 let acceptance finish an interrupted task", "src/control/checkpoints.ts",
     ' if(c.result!=="complete") return;\n', ""),
    ("M4 make the continuable flag drive work status", "src/control/checkpoints.ts",
     "work.status=completed && accepted", "work.status=continuable && accepted"),
    ("M7 remove the split's completion expression", "src/control/checkpoints.ts",
     "  const completed=continuable && c.result==\"complete\";\n",
     "  const completed=continuable;\n"),
]


def run(cmd):
    return subprocess.run(cmd, shell=True, cwd=MUT, capture_output=True, text=True)


out = []
for label, rel, old, new in MUTATIONS:
    path = f"{MUT}/{rel}"
    text = open(path).read()
    if text.count(old) != 1:
        out.append({"id": label, "error": f"anchor hits {text.count(old)}"})
        continue
    open(path, "w").write(text.replace(old, new, 1))
    src_sync = run(f"diff -q {rel} {SRC}/{rel}").returncode != 0
    test_sync = run(f"diff -q {TEST} {SRC}/{TEST}").returncode == 0
    proc = run(f"PATH=/usr/local/bin:$PATH node node_modules/.bin/vitest run {TEST}")
    lines = [l for l in (proc.stdout + proc.stderr).splitlines() if l.strip().startswith(("×", "✓", "Tests", "Test Files"))]
    out.append({"id": label, "src_mutated": src_sync, "test_matches_worktree": test_sync,
                "rc": proc.returncode, "failures": [l for l in lines if "×" in l], "summary": lines[-2:]})
    run(f"git checkout -- {rel}")
    out.append({"id": label, "restored_clean": run(f"git status --porcelain -- {rel}").stdout == ""})

print(json.dumps(out, indent=1, ensure_ascii=False))
