Convert the article to WeChat HTML with the md2publish-article skill.

The source is `{{param.slug}}.illustrated.md` when it exists (the visuals step wrote it), else `{{param.slug}}.wechat.md`.
The HTML goes next to it, named after it (`{{param.slug}}.illustrated.html` or `{{param.slug}}.wechat.html`). An HTML of
that name may exist from an earlier run: overwriting it is confirmed by Orca run {{run.id}}, so pass
`--confirmed-by-orca '{{run.id}}'` and do not ask (the vault keeps the old version).

Pick the theme the skill recommends for the article and report the choice as a decision. Run the skill's script by its
absolute path, spelled exactly `python3 '{{skill.md2publish-article.dir}}/scripts/md2html.py' ...`, and `md2wechat inspect
...`, with absolute paths into this workspace; never `cd` (the shell returns to this workspace after every command).
Report the metadata check (title, author, digest against WeChat's limits). Do not open a browser and do not go on to
the draft box.
