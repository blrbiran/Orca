Revise `{{param.slug}}.md` so it does not read as machine-written, with the tech-writer-deslop skill (its revise
branch: diagnose, then rewrite what the diagnosis names). Change wording, never the facts, the code blocks or the
structure.

Run the skill's scanner exactly as

    python3 '{{skill.tech-writer-deslop.dir}}/scripts/scan.py' --json '{{param.slug}}.md'

before and after your revision, and say in your result which densities moved. Revise the file in place.
