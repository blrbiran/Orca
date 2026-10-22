Push the article to the WeChat draft box with the md2publish-draft skill. This is the run's last step: the person
publishes from the WeChat backend themselves.

The upload and the draft are confirmed by Orca effect record {{effect.recordId}}: pass
`--confirmed-by-orca '{{effect.recordId}}'` as the skill says, print its publishing summary, and do not ask. Do this
once; if it fails, stop and report -- never retry.

- HTML: `{{param.slug}}.illustrated.html` when it exists, else `{{param.slug}}.wechat.html`.
- Title, author and digest: the HTML's `<!-- md2publish {...} -->` comment.
- Cover: the person's cover '{{param.coverImage}}' when that is not empty; otherwise the path written in
  `assets/wechat/00-cover.final.txt` (the cover step's final file). Pass it explicitly; never the sidecar default
  `00-cover.json`, which may name an older cover.

Run the skill's commands as they are, never after a `cd` (the shell returns to this workspace after every command): `md2wechat doctor --json`,
`md2wechat upload_image ... --json`, `md2wechat create_draft ... --json`, with absolute paths into this workspace.
Report the draft's `media_id` as `flow.effect.remoteId` (and its URL when one comes back).
