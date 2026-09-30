/**
 * Panel i18n spec §2, §5: the Chinese resource, the same key set as en (a missing or extra key is a compile error; the
 * _one plural keys carry the _other text). zhErrors (spec §3.2) is Chinese-only and not part of the key set: the text
 * shown for a refusal code in place of the server's English message; a code with no entry shows the message as sent.
 * The human reviews these values before the round closes (spec §5).
 */
import type { Translation, en } from "./en.js";

export const zh: Translation<typeof en> = {
  nav: { sections: "分区", decisions: "决策", chains: "链", tasks: "任务控制", metrics: "指标" },
  shell: {
    brandTitle: "交给 Orca —— 每个想法，都能成真。",
    chainRunning: "有一条链在运行",
    needsAttention: "需要处理",
    theme: "主题",
    language: "语言",
    loading: "orca 面板加载中…",
    epoch: "纪元 {{epoch}}",
  },
  common: { none: "无", na: "不适用", unknown: "未知", dispatchBlocked: "派发已阻断", dispatchLive: "派发正常" },
  loopPlan: {
    plan: {
      standard: { v1: { name: "标准" }, v2: { name: "标准" } },
      bugfix: {
        v1: { name: "修 bug（先红后绿）", discipline: "先写能复现的失败测试再修（由模型核对，不是机械证明）" },
        v2: { name: "修 bug（先红后绿）", discipline: "先写能复现的失败测试再修（由模型核对，不是机械证明）" },
      },
      refactor: {
        v1: { name: "安全重构", discipline: "不改可观察行为（写给 agent 的约束；只有检查命令是硬的）" },
        v2: { name: "安全重构", discipline: "不改可观察行为（写给 agent 的约束；只有检查命令是硬的）" },
      },
      design: {
        v1: { name: "先写设计／文档", discipline: "交付物是文档，不改代码（由模型核对，不是机械证明）" },
        v2: { name: "先写设计／文档", discipline: "交付物是文档，不改代码（由模型核对，不是机械证明）" },
      },
      investigate: {
        v1: { name: "只调研不改代码", discipline: "只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明）" },
        v2: { name: "只调研不改代码", discipline: "只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明）" },
      },
    },
    title: { line: "{{name}} · v{{version}} · {{how}}", byHand: "人指定", noLabel: "无标签，按默认", byLabel: "按标签 `{{label}}` 选择", changed: " · 已修改" },
    summary: {
      goal: "目标：{{goal}}",
      doneWhen: "完成条件：{{condition}}",
      onlyChanges: "只改：{{paths}}",
      mustNotChange: "不许改：{{paths}}（由 agent 自报，不是 git 检查）",
      files_one: "最多改 {{count}} 个文件（由 agent 自报）",
      files_other: "最多改 {{count}} 个文件（由 agent 自报）",
      noFileLimit: "不限文件数",
      checks_one: "验收：运行 {{count}} 条检查命令，全部通过",
      checks_other: "验收：运行 {{count}} 条检查命令，全部通过",
      pathSeparator: "、",
    },
  },
  metrics: {
    unknownRate: "未知",
    correctionRate: "纠正率",
    repairRate: "修复率",
    reviewCoverage: "评审覆盖率",
    unresolvedTitle: "未解析的决策",
    unresolvedCount: "未解析的决策：{{n}}",
    malformedTitle: "格式错误的行",
    malformedCount: "格式错误的行：{{n}}",
    futureTitle: "因日期在未来而排除",
    futureCount: "因日期在未来而排除：{{n}}",
    note: {
      "no-review-coverage": "评审覆盖率没有数据：它唯一的来源是面板（E2 spec §3.5），而 A' §4.4 规定纠正率绝不能单独解读",
      "unresolved-decisions": "有些纠正指向的决策不在扫描范围内（见 unresolved_decisions）；它们计入总数，但不属于任何决策类型分组",
      "stale-bias": "系统性偏低：关闭一条 stale 纠正需要 chose_instead 字段（CLI 参数 --chose-instead），而 corrections/schema.ts 规定 stale 不能带它（E2 spec §3.2.1，A' ERRATUM 3）",
      "reviewed-is-deliberate": "`reviewed` 是一个有意的动作，所以这个数字可能长时间接近零——而长期为零的覆盖率与没人看无法区分。请结合积压一起看，不要单独看。",
    },
  },
  enums: { theme: { system: "跟随系统", light: "浅色", dark: "深色" } },
};

export const zhErrors: Record<string, string> = {};
