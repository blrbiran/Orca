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
  enums: { theme: { system: "跟随系统", light: "浅色", dark: "深色" } },
};

export const zhErrors: Record<string, string> = {};
