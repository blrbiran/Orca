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
  enums: { theme: { system: "跟随系统", light: "浅色", dark: "深色" } },
};

export const zhErrors: Record<string, string> = {};
