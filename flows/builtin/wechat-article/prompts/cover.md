Make the article's WeChat cover with the md2publish-cover skill (platform `wechat`), for `{{param.slug}}.wechat.md`.

A single cover does not ask before spending; the spend is confirmed by Orca effect record {{effect.recordId}}. Pass
`--confirmed-by-orca '{{effect.recordId}}'` wherever the skill takes it: an existing cover is never overwritten -- the
skill saves the next free `00-cover.N.png` and prints a `⚠ confirmed-by-orca:` line; copy it into your result as a
decision. Never pass `--force`.

Run the skill's scripts by their absolute paths, spelled exactly `python3 '{{skill.md2publish-cover.dir}}/shared/scripts/<script>.py' ...`
and `bun '{{skill.md2publish-cover.dir}}/shared/scripts/imagegen/main.ts' ...` where the skill says `python3
shared/scripts/<script>.py` or `bun shared/scripts/imagegen/main.ts`. Never `cd`: the agent's shell returns to this workspace after every command, so a `cd` does not carry over and neither does a variable. Run each command on its
own (no `VAR=$(...)`), read its output, and write this workspace's absolute path wherever the skill says `$ART`. When the skill reports `${FINAL}`, write its path relative to this workspace (for example
`assets/wechat/00-cover.jpg`), on one line, into `assets/wechat/00-cover.final.txt`: the draft-box step reads the cover
from there, never from the sidecar default.

The effect is the generated image. Report the image the generator saved (its `savedImage`, as a path relative to this
workspace) as `flow.effect.remoteId`. When no image provider is configured or the generation fails, stop there: never
draw, write or copy a stand-in cover, and report no `flow.effect` -- Orca records the cover as failed for the person.
