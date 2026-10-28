/**
 * Project registry spec §7 (§12 C5): the one project control, at the top of the sidebar. Always shown once the list
 * is read; Add and Rename only when the panel's projects come from its file.
 *
 * Multi-directory projects spec §4.2: "Group several projects" creates one from an ordered picker, and a multi row's
 * order can be edited. The downgrade notice is shown once per browser, before the first multi project is created.
 */
import { useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal, PostResult } from "./api.js";
import { refusalText } from "./i18n.js";
import { projectName, type ProjectsAnswerV1 } from "./project.js";
import { projectAction } from "./ui/classes.js";
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
  /** Multi-directory projects spec §4.2: create one, or replace a multi project's order. */
  onAddMulti: (input: { name: string; dirs: string[] }) => Promise<PostResult<unknown>>;
  onSetDirs: (id: string, dirs: string[]) => Promise<PostResult<unknown>>;
}

const NOTICE_KEY = "orca.multiDirDowngradeNotice";
const storage = (): Storage | undefined => {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
};
const noticeSeen = (): boolean => {
  try { return storage()?.getItem(NOTICE_KEY) !== null; } catch { return true; }
};
const markNoticeSeen = (): void => {
  try { storage()?.setItem(NOTICE_KEY, "1"); } catch { /* a private window only sees it again */ }
};

const lastSegment = (path: string): string => path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";

export function ProjectControl(props: ProjectControlProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState<"add" | "rename" | "multi" | "multiEdit" | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const editable = props.answer.editable === true;
  const projects = props.answer.projects;
  const withAll = props.onAll !== undefined && allowsAll(projects.length);
  const current = projects.find((p) => p.projectKey === props.project);
  const singles = projects.filter((p) => p.kind !== "multi");
  const available = singles.filter((p) => !dirs.includes(p.projectKey));
  const pickValue = available.some((p) => p.projectKey === pick) ? pick : available[0]?.projectKey ?? "";
  const memberLabel = (id: string): string => {
    const member = projects.find((p) => p.projectKey === id);
    return member === undefined ? id : projectName(member);
  };

  const close = (): void => {
    setOpen(null); setRefusal(null); setPath(""); setName(""); setDirs([]); setPick(""); setNotice(false);
  };
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
  const openMultiCreate = (): void => {
    setOpen("multi"); setRefusal(null); setName(""); setDirs([]); setPick(""); setNotice(!noticeSeen());
  };
  const openMultiEdit = (): void => {
    if (current === undefined || current.kind !== "multi") return;
    const listed = props.answer.multiDirProjects?.find((m) => m.id === current.projectKey)?.dirs;
    setOpen("multiEdit"); setRefusal(null); setNotice(false);
    setDirs(listed ?? current.dirs?.map((member) => member.projectKey) ?? []);
    setPick("");
  };
  const move = (index: number, by: number): void => {
    const next = [...dirs];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    setDirs(next);
  };
  const submitMulti = (event: FormEvent): void => {
    event.preventDefault();
    if (dirs.length < 2 || dirs.length > 8) return;
    const result = open === "multiEdit" && current !== undefined
      ? props.onSetDirs(current.projectKey, dirs)
      : props.onAddMulti({ name: name.trim(), dirs });
    void result.then((answer) => {
      if (answer.ok) {
        if (open === "multi") markNoticeSeen();
        close();
        return;
      }
      setRefusal({ status: answer.status, code: answer.code, message: answer.message });
    });
  };

  const picker = (
    <>
      <ol className="project-multi-list" aria-label={t("project.multiMembers")}>
        {dirs.map((id, index) => {
          const label = memberLabel(id);
          return (
            <li key={id}>
              <span>{label}</span>
              <button type="button" aria-label={t("project.multiUp", { name: label })} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={t("project.multiDown", { name: label })} disabled={index === dirs.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label={t("project.multiRemove", { name: label })} onClick={() => setDirs(dirs.filter((entry) => entry !== id))}>×</button>
            </li>
          );
        })}
      </ol>
      <label>{t("project.multiPick")}
        <select name="project-multi-pick" value={pickValue} onChange={(e) => setPick(e.currentTarget.value)}>
          {available.map((p) => <option key={p.projectKey} value={p.projectKey}>{projectName(p)}</option>)}
        </select>
      </label>
      <button type="button" disabled={pickValue === "" || dirs.length >= 8} title={dirs.length >= 8 ? t("project.multiFull") : undefined}
        onClick={() => { setDirs([...dirs, pickValue]); setPick(""); }}>{t("project.multiAdd")}</button>
    </>
  );
  const saveDisabled = dirs.length < 2 || dirs.length > 8 || (open === "multi" && name.trim() === "");

  return (
    <div className="project-control flex flex-col gap-2 rounded-card border border-line bg-well p-[10px] text-xs max-md:w-full [&>label]:mb-0 [&_form]:m-0 [&_form]:flex [&_form]:flex-col [&_form]:gap-1.5 [&_p]:m-0 [&_select]:w-full">
      {projects.length === 0 ? (
        <p className="project-none">{t("project.none")}</p>
      ) : (
        <label>
          {t("shell.project")}
          <select name="project" value={withAll && props.view === "all" ? ALL_PROJECTS : props.project ?? ""}
            onChange={(e) => (e.currentTarget.value === ALL_PROJECTS ? props.onAll?.() : props.onProject(e.currentTarget.value))}>
            {withAll && <option value={ALL_PROJECTS}>{t("project.all")}</option>}
            {projects.map((p) => <option key={p.projectKey} value={p.projectKey}>
              {p.kind === "dir" ? t("project.dirLabel", { name: projectName(p) })
                : p.kind === "multi" ? t("project.multiLabel", { name: projectName(p), count: p.dirs?.length ?? 0 })
                : projectName(p)}
            </option>)}
          </select>
        </label>
      )}
      <div className="project-actions flex flex-wrap gap-1.5">
        <button type="button" className={projectAction} data-icon="add" disabled={!editable} title={editable ? undefined : t("project.fromCommandLine")} onClick={() => { setRefusal(null); setOpen("add"); }}>
          {t("project.add")}
        </button>
        <button type="button" className={projectAction} data-icon="rename" disabled={!editable || current === undefined} title={editable ? undefined : t("project.fromCommandLine")}
          onClick={() => { setRefusal(null); setName(current ? projectName(current) : ""); setOpen("rename"); }}>
          {t("project.rename")}
        </button>
        <button type="button" className={projectAction} disabled={!editable} title={editable ? undefined : t("project.fromCommandLine")} onClick={openMultiCreate}>
          {t("project.multi")}
        </button>
        <button type="button" className={projectAction} disabled={!editable || current?.kind !== "multi"} onClick={openMultiEdit}>
          {t("project.multiEdit")}
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
      {open === "multi" && (
        <form aria-label={t("project.multi")} onSubmit={submitMulti}>
          <p className="caveat">{t("project.multiHint")}</p>
          {notice && <p role="note">{t("project.multiNotice")}</p>}
          <label>{t("project.name")}<input type="text" name="project-name" value={name} onChange={(e) => setName(e.currentTarget.value)} /></label>
          {picker}
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit" disabled={saveDisabled} title={saveDisabled ? t("project.multiSaveHint") : undefined}>{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
      {open === "multiEdit" && (
        <form aria-label={t("project.multiEdit")} onSubmit={submitMulti}>
          <p className="caveat">{t("project.multiHint")}</p>
          {picker}
          {refusal !== null && <p role="alert">{refusal.code}: {refusalText(refusal)}</p>}
          <button type="submit" disabled={saveDisabled} title={saveDisabled ? t("project.multiSaveHint") : undefined}>{t("project.save")}</button>
          <button type="button" onClick={close}>{t("project.cancel")}</button>
        </form>
      )}
    </div>
  );
}
