/**
 * Project registry spec §7 (§12 C5): the one project control, at the top of the sidebar. Always shown once the list
 * is read; Add and Rename only when the panel's projects come from its file.
 */
import { useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal, PostResult } from "./api.js";
import { refusalText } from "./i18n.js";
import { projectName, type ProjectsAnswerV1 } from "./project.js";
import { ALL_PROJECTS, allowsAll, type ProjectView } from "./projectScope.js";

export interface ProjectControlProps {
  answer: ProjectsAnswerV1;
  project: string | null;
  onProject: (projectKey: string) => void;
  /** Project filtering spec §3: with `onAll` and two or more projects the select starts with "All projects". */
  view?: ProjectView;
  onAll?: () => void;
  onAdd: (input: { name: string; path: string }) => Promise<PostResult<unknown>>;
  onRename: (id: string, name: string) => Promise<PostResult<unknown>>;
}

const lastSegment = (path: string): string => path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";

export function ProjectControl(props: ProjectControlProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState<"add" | "rename" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const editable = props.answer.editable === true;
  const projects = props.answer.projects;
  const withAll = props.onAll !== undefined && allowsAll(projects.length);
  const current = projects.find((p) => p.projectKey === props.project);

  const close = (): void => { setOpen(null); setRefusal(null); setPath(""); setName(""); };
  const settle = (result: PostResult<unknown>): void => {
    if (result.ok) close();
    else setRefusal({ status: result.status, code: result.code, message: result.message });
  };
  const submitAdd = (event: FormEvent): void => {
    event.preventDefault();
    void props.onAdd({ path: path.trim(), name: name.trim() === "" ? lastSegment(path.trim()) : name.trim() }).then(settle);
  };
  const submitRename = (event: FormEvent): void => {
    event.preventDefault();
    if (current !== undefined) void props.onRename(current.projectKey, name).then(settle);
  };

  return (
    <div className="project-control">
      {projects.length === 0 ? (
        <p className="project-none">{t("project.none")}</p>
      ) : (
        <label>
          {t("shell.project")}
          <select name="project" value={withAll && props.view === "all" ? ALL_PROJECTS : props.project ?? ""}
            onChange={(e) => (e.currentTarget.value === ALL_PROJECTS ? props.onAll?.() : props.onProject(e.currentTarget.value))}>
            {withAll && <option value={ALL_PROJECTS}>{t("project.all")}</option>}
            {projects.map((p) => <option key={p.projectKey} value={p.projectKey}>{projectName(p)}</option>)}
          </select>
        </label>
      )}
      <div className="project-actions">
        <button type="button" className="project-action" data-icon="add" disabled={!editable} title={editable ? undefined : t("project.fromCommandLine")} onClick={() => { setRefusal(null); setOpen("add"); }}>
          {t("project.add")}
        </button>
        <button type="button" className="project-action" data-icon="rename" disabled={!editable || current === undefined} title={editable ? undefined : t("project.fromCommandLine")}
          onClick={() => { setRefusal(null); setName(current ? projectName(current) : ""); setOpen("rename"); }}>
          {t("project.rename")}
        </button>
      </div>
      {!editable && <p className="caveat">{t("project.fromCommandLine")}</p>}
      {props.answer.fileError ? <p role="alert">{t("project.fileError", { message: props.answer.fileError })}</p> : null}
      {(props.answer.pendingRestart ?? []).length > 0 && (
        <p role="note">
          {t("project.pendingRestart", { items: props.answer.pendingRestart!.join(", ") })}
          {props.answer.pendingRestart!.some((item) => item.startsWith("removed:") || item.startsWith("path:")) && ` ${t("project.restartWarning")}`}
        </p>
      )}
      {open === "add" && (
        <form aria-label={t("project.add")} onSubmit={submitAdd}>
          <label>{t("project.path")}<input type="text" name="project-path" value={path} onChange={(e) => setPath(e.currentTarget.value)} /></label>
          <label>{t("project.name")}<input type="text" name="project-name" value={name} placeholder={lastSegment(path)} onChange={(e) => setName(e.currentTarget.value)} /></label>
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit">{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
      {open === "rename" && (
        <form aria-label={t("project.rename")} onSubmit={submitRename}>
          <label>{t("project.name")}<input type="text" name="project-name" value={name} onChange={(e) => setName(e.currentTarget.value)} /></label>
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit">{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
    </div>
  );
}
