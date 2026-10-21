/**
 * Flow engine spec §3.3: the one static checklist, a pure function shared by Web, CLI and the start path (publish and
 * start run it; save does not -- a broken draft can be saved). Errors block, warnings show. Every finding names its
 * place as a dotted path into the template, so a surface can point at it.
 *
 * Review Focus 1: a command (a check's `run`, a `tools` command, a `requires.commands` check) may carry only params whose
 * values are validated -- `slug`, `int`, `enum`, `path`; free text in a command is how a param becomes shell.
 * Review Focus 2: an asset path never leads outside the template directory, and a `path` param or `writeTo.file` never
 * outside the workspace.
 */
import { posix } from "node:path";
import { flowTemplateSchema, type FlowStep, type FlowTemplate, type ParamType } from "./schema.js";
import { varRefs, type VarRef, type VarWhere } from "./vars.js";

export interface Finding { code: string; path: string; message: string }
export interface AssetReader { exists(rel: string): boolean; read(rel: string): string }
export interface ChecklistContext {
  /** §9.5: skills some built-in template uses in an effect-classed step (derived from the built-ins, never hard-coded). */
  builtinEffectSkills: ReadonlySet<string>;
}

const COMMAND_PARAM_TYPES: ReadonlySet<ParamType> = new Set(["slug", "int", "enum", "path"]);
/** [IR-I9]: a prefix rule naming only an interpreter allows any script. */
const BARE_INTERPRETERS = new Set(["python3", "python", "bash", "sh", "zsh", "node", "bun", "deno"]);
const PERSON_KINDS: ReadonlySet<FlowStep["kind"]> = new Set(["ask", "work", "review"]);
const EQUALS_HINT = /^(verdict|headings\(.+\)|json\(.+,\s*.+\))$/;

/** A relative, normalised path with no `..`, no backslash, no NUL or newline (and no quote for a path param). */
export function isInsidePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !/[\\\0\n\r]/.test(value)
    && !value.split("/").includes("..") && posix.normalize(value) === value && value !== ".";
}

export function checkTemplate(raw: unknown, assets: AssetReader, ctx: ChecklistContext): { errors: Finding[]; warnings: Finding[] } {
  const parsed = flowTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => ({ code: "schema", path: issue.path.join("."), message: issue.message })), warnings: [] };
  }
  const tpl: FlowTemplate = parsed.data;
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (code: string, path: string, message: string): void => { errors.push({ code, path, message }); };

  const params = tpl.params ?? {};
  const roles = tpl.roles ?? {};
  const effects = tpl.effects ?? {};
  const required = new Set((tpl.requires?.skills ?? []).flatMap((entry) => entry.skills));
  const stepIds = new Set<string>();

  for (const [id, param] of Object.entries(params)) {
    if (param.type === "path" && typeof param.default === "string" && (!isInsidePath(param.default) || param.default.includes("'"))) {
      err("param-path-invalid", `params.${id}.default`, `path param ${id}'s default ${JSON.stringify(param.default)} must stay inside the workspace and hold no quote, NUL or newline`);
    }
  }
  for (const [name, role] of Object.entries(roles)) {
    if (role.distinctFrom !== undefined && !(role.distinctFrom in roles)) err("distinct-from-unknown", `roles.${name}.distinctFrom`, `role ${name} is distinct from ${role.distinctFrom}, which is not a role`);
  }
  for (const [kind, effect] of Object.entries(effects)) {
    if (effect.class === "human-only") err("effect-class-human-only", `effects.${kind}.class`, `effect ${kind} is human-only; a flow ends before a human-only act (§9.1)`);
  }

  /** Each variable reference in `text`, checked against what the step can resolve. */
  const checkVars = (text: string, where: VarWhere, path: string, step: FlowStep | null): void => {
    for (const ref of varRefs(text)) {
      const problem = refProblem(ref, where, step);
      if (problem !== null) err(problem.code, path, problem.message);
    }
  };
  const refProblem = (ref: VarRef, where: VarWhere, step: FlowStep | null): { code: string; message: string } | null => {
    const unknown = (what: string) => ({ code: "unknown-var", message: `unknown variable ${what} in a ${where}` });
    switch (ref.kind) {
      case "unknown": return unknown(`{{${ref.text}}}`);
      case "param": {
        const param = params[ref.id];
        if (param === undefined) return unknown(`{{param.${ref.id}}}`);
        if (where === "command" && !COMMAND_PARAM_TYPES.has(param.type)) {
          return { code: "param-type-not-allowed-in-command", message: `param ${ref.id} is ${param.type}; a command may only carry slug, int, enum or path params` };
        }
        return null;
      }
      case "skill": return step !== null && "skills" in step && (step.skills ?? []).includes(ref.name) ? null : unknown(`{{skill.${ref.name}.dir}}`);
      case "effect.recordId": return step !== null && "effect" in step && step.effect !== undefined ? null : unknown("{{effect.recordId}}");
      case "base": return where === "command" ? null : unknown(`{{base:${ref.path}}}`);
      case "run.id": case "workspace": return null;
    }
  };
  /** An asset path: inside the template directory and present. */
  const checkAsset = (rel: string, path: string, step: FlowStep): string | null => {
    if (!isInsidePath(rel)) { err("asset-path-outside-template", path, `${JSON.stringify(rel)} is not a path inside the template`); return null; }
    if (!assets.exists(rel)) { err("asset-missing", path, `asset ${rel} does not exist`); return null; }
    checkVars(assets.read(rel), "prompt", path, step);
    return rel;
  };

  tpl.steps.forEach((step, index) => {
    const at = `steps.${index}`;
    if (stepIds.has(step.id)) err("duplicate-step-id", `${at}.id`, `step id ${step.id} is used twice`);
    stepIds.add(step.id);
    if (step.executor === "person" && !PERSON_KINDS.has(step.kind)) err("executor-person-not-allowed", `${at}.executor`, `a ${step.kind} step cannot be done by a person (only ask, work, review)`);
    if (step.role !== undefined && !(step.role in roles)) err("role-unknown", `${at}.role`, `role ${step.role} is not declared in roles`);
    if (step.parallelWith !== undefined && !tpl.steps.some((other) => other.id === step.parallelWith && other !== step)) err("parallel-with-unknown", `${at}.parallelWith`, `no other step is called ${step.parallelWith}`);
    if (step.when !== undefined) for (const param of whenParams(step.when)) if (!(param in params)) err("when-unknown-param", `${at}.when`, `when refers to ${param}, which is not a param`);
    if (step.hints?.equals !== undefined) {
      if (!EQUALS_HINT.test(step.hints.equals)) err("hints-equals-invalid", `${at}.hints.equals`, "equals is one of verdict, headings(<path>), json(<path>, <pointer>)");
      else checkVars(step.hints.equals, "prompt", `${at}.hints.equals`, step);
    }
    if ("skills" in step) (step.skills ?? []).forEach((skill, i) => {
      if (!required.has(skill)) err("skill-not-required", `${at}.skills.${i}`, `skill ${skill} is not in requires.skills`);
    });
    if ("prompt" in step && step.prompt !== undefined) checkAsset(step.prompt, `${at}.prompt`, step);
    if (step.kind === "clarify" && step.background !== undefined) checkAsset(step.background, `${at}.background`, step);
    if (step.kind === "review" && step.rubric !== undefined) checkAsset(step.rubric, `${at}.rubric`, step);

    const effectClassed = "effect" in step && step.effect !== undefined;
    if ("effect" in step && step.effect !== undefined && !(step.effect in effects)) err("effect-kind-unknown", `${at}.effect`, `effect ${step.effect} is not declared in effects`);
    if (effectClassed && step.kind === "work" && (step.loop !== undefined || step.onFailure !== undefined)) {
      err("effect-step-loop", `${at}.${step.loop !== undefined ? "loop" : "onFailure"}`, "an effect-classed step runs once: no loop, no onFailure (§9.6)");
    }
    if (!effectClassed && "skills" in step) {
      const effectSkill = (step.skills ?? []).find((skill) => ctx.builtinEffectSkills.has(skill));
      if (effectSkill !== undefined) warnings.push({ code: "unclassed-effect-skill", path: `${at}.skills`, message: `skill ${effectSkill} is effect-classed in a built-in template; this step has no effect class, so its side effect is only recorded afterwards (§9.5)` });
    }

    if ("acceptance" in step && step.acceptance !== undefined) {
      const checkIds = new Set<string>();
      step.acceptance.checks.forEach((check, i) => {
        if (check.id !== undefined) {
          if (checkIds.has(check.id)) err("duplicate-check-id", `${at}.acceptance.checks.${i}.id`, `check id ${check.id} is used twice in step ${step.id}`);
          checkIds.add(check.id);
        }
        checkVars(check.run, "command", `${at}.acceptance.checks.${i}.run`, step);
      });
    }
    if ("loop" in step && step.loop !== undefined && "check" in step.loop.until) {
      const name = step.loop.until.check;
      const check = "acceptance" in step ? step.acceptance?.checks.find((c) => c.id === name) : undefined;
      if (check === undefined) err("loop-check-missing", `${at}.loop.until.check`, `loop waits for check ${name}, which step ${step.id} does not have`);
      else if (check.role !== "gate") err("loop-check-not-gate", `${at}.loop.until.check`, `loop waits for ${name}, a diagnostic; only a gate can end a loop`);
    }
    if ("tools" in step && step.tools?.commands !== undefined) {
      step.tools.commands.forEach((rule, i) => {
        const command = "exact" in rule ? rule.exact : rule.prefix;
        const where = `${at}.tools.commands.${i}`;
        if ("prefix" in rule && BARE_INTERPRETERS.has(rule.prefix.trim())) err("tools-bare-interpreter", where, `prefix ${JSON.stringify(rule.prefix)} allows any script; name the script (§3.2, IR-I9)`);
        checkVars(command, "command", where, step);
      });
    }
    if (step.kind === "review" && !tpl.steps.slice(0, index).some((other) => other.id === step.reviews)) {
      err("reviews-unknown", `${at}.reviews`, `review of ${step.reviews}, which is not an earlier step`);
    }
    if (step.kind === "ask") {
      if (step.candidatesFrom !== undefined && !tpl.steps.slice(0, index).some((other) => other.id === step.candidatesFrom!.step)) {
        err("candidates-from-unknown", `${at}.candidatesFrom.step`, `candidates from ${step.candidatesFrom.step}, which is not an earlier step`);
      }
      if (step.writeTo !== undefined) {
        const before = errors.length;
        checkVars(step.writeTo.file, "prompt", `${at}.writeTo.file`, step);
        if (errors.length === before && !isInsidePath(step.writeTo.file.replace(/\{\{[^{}]*\}\}/g, "x"))) {
          err("write-to-outside-workspace", `${at}.writeTo.file`, `${JSON.stringify(step.writeTo.file)} is not a path inside the workspace`);
        }
      }
    }
  });
  (tpl.requires?.commands ?? []).forEach((command, i) => checkVars(command.check, "command", `requires.commands.${i}.check`, null));

  return { errors, warnings };
}

function whenParams(pred: NonNullable<FlowStep["when"]>): string[] {
  if ("and" in pred) return pred.and.flatMap(whenParams);
  if ("or" in pred) return pred.or.flatMap(whenParams);
  if ("not" in pred) return whenParams(pred.not);
  if ("classification" in pred) return [];
  return [pred.param];
}
