Add illustrations to `{{param.slug}}.wechat.md` for WeChat with the md2publish-visuals skill. The run's spend on images
is confirmed by Orca effect record {{effect.recordId}}: pass `--confirmed-by-orca '{{effect.recordId}}'` as the skill
says, which also covers its re-run guard and its write-back confirmation (it prints `⚠ confirmed-by-orca:` lines --
copy each one into your result as a decision).

Run every command from the skill's directory (`cd '{{skill.md2publish-visuals.dir}}'`) and write every product under
this workspace's absolute path. The write-back produces `{{param.slug}}.illustrated.md`; the source stays as it is.
Never pass `--force`.

The effect is the generated images. Report the first image the generator saved (as a path relative to this workspace)
as `flow.effect.remoteId`. When no image provider is configured or a generation fails, stop there: never draw, write or
copy stand-in images, and report no `flow.effect` -- Orca records the step as failed for the person.
