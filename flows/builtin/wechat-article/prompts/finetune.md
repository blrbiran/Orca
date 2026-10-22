Adapt `{{param.slug}}.md` for the WeChat official account with the wechat-finetune skill, writing
`{{param.slug}}.wechat.md` next to it; the original stays as it is.

The audience profile is `./.md2publish/audience-profile.md`. Without one, infer it from the article as the skill says
and save it; nobody can confirm it now, so report it as a decision. The article's purpose comes from the brief.

The title is the person's choice, made in the next step: write the frontmatter with your recommended title, and report
your three candidates (each within 32 characters) as `flow.candidates.title = {"items": [...], "recommended": <index>}`.
Fill `author` from the profile and write a `digest` within 128 characters.

Run the skill's self-check from its directory, exactly:

    cd '{{skill.wechat-finetune.dir}}'
    python3 scripts/verify.py <absolute path of {{param.slug}}.md> <absolute path of {{param.slug}}.wechat.md>
