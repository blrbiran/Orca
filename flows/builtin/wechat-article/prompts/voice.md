Make `{{param.slug}}.md` read the way a person talks to the reader the brief names, with the tech-writer-voice skill.
Change the register only: technical content, numbers, code, names and links stay exactly as they are.

The skill's fidelity check is this step's gate: it compares a read-only copy of the draft as you found it with your
result. Run it exactly as the Acceptance section below lists it, and the skill's voice report with the same two paths:

    python3 '{{skill.tech-writer-voice.dir}}/scripts/voice.py' <the copy> '{{param.slug}}.md' --diff

until fidelity passes. Revise the file in place.
