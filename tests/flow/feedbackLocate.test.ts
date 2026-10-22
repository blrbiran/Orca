/**
 * Gaps spec §4.1, §4.3 and §17 G1: anchors found in the feedback text and `loc1`, the code that places an anchor in the
 * markdown the steps wrote. Pure and table-driven. The point of each row: a wrong guess edits the wrong paragraph, so
 * anything but exactly one hit in the file the person reads is `needs-location`.
 */
import { describe, expect, it } from "vitest";
import { extractAnchors, norm, type Anchor } from "../../src/flow/feedback/anchors.js";
import { locate, readingFile, type SearchFile } from "../../src/flow/feedback/locate.js";

const file = (path: string, text: string, writerIndex = 0, writerKey = `w${writerIndex}`): SearchFile => ({ path, text, writerIndex, writerKey });
const ARTICLE = [
  "---", "title: demo", "---", "", "<!-- md2publish: meta -->", "",
  "# 标题", "", "第一段：这是一个用于测试的段落，里面有 English words 和中文。", "",
  "![cover](cover.png)", "", "```", "const code = 1;", "", "still code", "```", "",
  "## 小节", "", "第二段：包含**加粗**和[链接](http://x.y)的一句话。", "", "---", "", "第三段：最后一段内容。",
].join("\n");

describe("extractAnchors (§4.1)", () => {
  it.each<[string, string, Anchor[]]>([
    ["a 「」 quote of >= 6 normalised chars", "把「这是一个足够长的引文」改短", [{ quote: "这是一个足够长的引文" }]],
    ["a quote of 5 normalised chars is not a quote", "把「五个字引文」改短", []],
    ["spaces do not count towards the 6", "把「a b c d e」改短", []],
    ["第三段", "第三段太长了", [{ paragraph: 3 }]],
    ["第十二段", "请看第十二段", [{ paragraph: 12 }]],
    ["第二十三段", "第二十三段", [{ paragraph: 23 }]],
    ["arabic 第3段", "第3段", [{ paragraph: 3 }]],
    ["paragraph 3", "paragraph 3 is too long", [{ paragraph: 3 }]],
    ["para 3", "para 3 is too long", [{ paragraph: 3 }]],
    ["a heading is never extracted from text", "## 小节 这一节不好", []],
    ["nothing else is parsed", "整体感觉不对", []],
  ])("%s", (_name, text, want) => {
    expect(extractAnchors(text, [])).toEqual(want);
  });

  it("adds to the given anchors, dedupes, caps at 5 and keeps text order", () => {
    const text = "第五段 然后 paragraph 2 再看第五段，还有第一段、第三段、第四段、第六段";
    expect(extractAnchors(text, [{ heading: "小节" }, { paragraph: 5 }]))
      .toEqual([{ heading: "小节" }, { paragraph: 5 }, { paragraph: 2 }, { paragraph: 1 }, { paragraph: 3 }]);
  });
});

describe("norm (§4.3)", () => {
  it("folds CJK punctuation, drops inline markdown and all whitespace, lower-cases Latin", () => {
    expect(norm("**加粗**，[链接](http://x.y) “引文”：English Words！")).toBe('加粗,链接"引文":englishwords!');
    expect(norm("> - 列表项 `code`")).toBe("列表项code");
    expect(norm("![alt](a.png)文字<b>x</b>")).toBe("文字x");
  });
});

describe("locate / loc1 (§4.3, G1)", () => {
  const one = [file("a.md", ARTICLE)];
  const para = (r: ReturnType<typeof locate>[number]) => ("located" in r ? r.located.paragraph : null);

  it.each<[string, Anchor, number]>([
    ["an exact unique quote", { quote: "最后一段内容" }, 3],
    ["the same quote with full-width punctuation, bold, a link and CJK-Latin spaces removed (rung 2)", { quote: "第二段:包含加粗和链接的一句话." }, 2],
    ["spaces dropped between CJK and Latin (rung 2)", { quote: "里面有English words和中文" }, 1],
    ["a quote split at an ellipsis, parts in order", { quote: "第一段…English…中文" }, 1],
    ["a heading, the located unit is its section", { heading: "小节" }, 2],
    ["paragraph 3 (front matter, comment, code fence, headings, image, rule not counted)", { paragraph: 3 }, 3],
    ["paragraph 1", { paragraph: 1 }, 1],
    ["paragraph 2 of a heading's section", { heading: "小节", paragraph: 2 }, 3],
  ])("%s is located", (_name, anchor, paragraph) => {
    expect(para(locate([anchor], one)[0]!)).toBe(paragraph);
  });

  it("a quote in two paragraphs is needs-location with both hits", () => {
    const f = [file("a.md", "重复的一整句话在这里。\n\n中间一段。\n\n重复的一整句话在这里。")];
    const [r] = locate([{ quote: "重复的一整句话在这里" }], f);
    expect(r).toMatchObject({ hits: [{ paragraph: 1 }, { paragraph: 3 }], more: 0 });
    expect(r).not.toHaveProperty("located");
  });
  it("two occurrences inside one paragraph are one hit", () => {
    const f = [file("a.md", "重复的一整句话 然后 重复的一整句话。")];
    expect(locate([{ quote: "重复的一整句话" }], f)[0]).toHaveProperty("located");
  });
  it("no hit is needs-location with no hits", () => {
    expect(locate([{ quote: "文章里没有的一句话" }], one)[0]).toMatchObject({ hits: [], more: 0 });
  });
  it("hits in <slug>.md and <slug>.wechat.md locate in the later writer's file", () => {
    const fs = [file("s.md", "同一句话出现在两个文件里。", 0), file("s.wechat.md", "同一句话出现在两个文件里。", 1)];
    expect(locate([{ quote: "同一句话出现在两个文件里" }], fs)[0]).toMatchObject({ located: { file: "s.wechat.md" } });
  });
  it("two files by one writer are ambiguous, never the first", () => {
    const fs = [file("s.md", "同一句话出现在两个文件里。", 1, "article"), file("s.layout.md", "同一句话出现在两个文件里。", 1, "article")];
    expect(locate([{ quote: "同一句话出现在两个文件里" }], fs)[0]).toMatchObject({ hits: [{ file: "s.md" }, { file: "s.layout.md" }] });
  });
  it("a 5-character normalised quote is not a quote at rung 2", () => {
    const f = [file("a.md", "有一个：短引文。")];
    expect(locate([{ quote: "有一个:短" }], f)[0]).toMatchObject({ hits: [] });
  });
  it("a heading is not a paragraph (front matter and comment content is not searched)", () => {
    expect(locate([{ quote: "md2publish: meta" }], one)[0]).toMatchObject({ hits: [] });
    expect(locate([{ quote: "title: demo" }], one)[0]).toMatchObject({ hits: [] });
    expect(locate([{ quote: "still code" }], one)[0]).toMatchObject({ hits: [] });
  });
  it("an ordinal with several files by the reading writer is ambiguous", () => {
    const fs = [file("a.md", "甲。\n\n乙。", 1, "w"), file("b.md", "丙。\n\n丁。", 1, "w")];
    const [r] = locate([{ paragraph: 2 }], fs);
    expect(r).toMatchObject({ hits: [{ file: "a.md" }, { file: "b.md" }] });
    expect(readingFile(fs)).toEqual({ ambiguous: ["a.md", "b.md"] });
    expect(readingFile([file("a.md", "", 0), file("b.md", "", 2)])).toMatchObject({ file: { path: "b.md" } });
  });
  it("an ordinal that exists in only one of several files by the reading writer is still ambiguous", () => {
    const fs = [file("a.md", "甲。\n\n乙。", 1, "w"), file("b.md", "丙。", 1, "w")];
    const [r] = locate([{ paragraph: 2 }], fs);
    expect(r).not.toHaveProperty("located");
    expect(r).toMatchObject({ hits: [{ file: "a.md", paragraph: 2 }] });
  });
  it("caps hits at 5 and says how many are not shown", () => {
    const f = [file("a.md", Array.from({ length: 8 }, () => "完全相同的一整句话。").join("\n\n"))];
    const [r] = locate([{ quote: "完全相同的一整句话" }], f);
    expect(r).toMatchObject({ more: 3 });
    expect("hits" in r! && r.hits.length).toBe(5);
  });
  it("an excerpt is at most 120 characters of the original text", () => {
    const f = [file("a.md", "**" + "长".repeat(300) + "**")];
    const [r] = locate([{ paragraph: 1 }], f);
    expect("located" in r! && r.located.excerpt).toBe("**" + "长".repeat(118));
  });
  it("headingPath names the sections above the hit", () => {
    expect(locate([{ quote: "最后一段内容" }], one)[0]).toMatchObject({ located: { headingPath: ["标题", "小节"] } });
  });
});
