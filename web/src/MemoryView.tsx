/**
 * Memory tab spec §5.2. Read-only (G9): no control here writes anything. Every request starts ccmem twice on the
 * server, so nothing is asked before the section is first opened (plan D8), the list is read once per repository
 * choice, and a search runs only when the person submits. Content is rendered as text; the list shows the first 200
 * code points, the detail all of it.
 */
import type { FormEvent, JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type PanelRefusal, failureFrom } from "./api.js";
import { fetchMemoryItem, fetchMemoryList, fetchMemorySearch, fetchMemoryStatus } from "./memoryApi.js";
import type { MemoryPageResponse, MemoryRecord, MemoryStatusResponse } from "./memoryTypes.js";
import { Refusal } from "./Refusal.js";

const EXCERPT_CODE_POINTS = 200;
const SCOPE_KEY = { global: "memory.scopeGlobal", project: "memory.scopeProject" } as const;

function excerpt(content: string): string {
  const points = [...content];
  return points.length <= EXCERPT_CODE_POINTS ? content : `${points.slice(0, EXCERPT_CODE_POINTS).join("")}…`;
}

export function MemoryView({ active }: { active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const opened = useRef(false);
  const latest = useRef(0); // a newer list or search supersedes older ones
  const latestItem = useRef(0); // a newer item request, or any list or search, supersedes older item answers
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<MemoryStatusResponse | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<MemoryPageResponse | null>(null);
  const [record, setRecord] = useState<MemoryRecord | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (projectKey: string, query: string): Promise<void> => {
    const mine = ++latest.current;
    latestItem.current++;
    setRefusal(null);
    setRecord(null);
    setLoading(true);
    try {
      const answer = query === "" ? await fetchMemoryList(projectKey) : await fetchMemorySearch(projectKey, query);
      if (mine === latest.current) setPage(answer);
    } catch (err) {
      if (mine === latest.current) {
        setPage(null);
        setRefusal(failureFrom(err));
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!active || opened.current) return;
    opened.current = true;
    setStarted(true);
    void (async () => {
      try {
        const answer = await fetchMemoryStatus();
        setStatus(answer);
        const first = answer.repos[0]?.projectKey ?? null;
        setRepo(first);
        if (answer.health.status === "ok" && first !== null) await load(first, "");
      } catch (err) {
        setRefusal(failureFrom(err));
      }
    })();
  }, [active]);

  const open = async (ref: string): Promise<void> => {
    if (repo === null) return;
    const mine = ++latestItem.current;
    setRefusal(null);
    try {
      const answer = (await fetchMemoryItem(repo, ref)).record;
      if (mine === latestItem.current) setRecord(answer);
    } catch (err) {
      if (mine === latestItem.current) {
        setRecord(null);
        setRefusal(failureFrom(err));
      }
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (repo !== null) void load(repo, draft.trim());
  };

  const health = status?.health;
  const ready = health?.status === "ok" && repo !== null;
  const noProject = page !== null && page.query === "" && page.page.records.length > 0 && !page.page.records.some((r) => r.scope === "project");

  return (
    <section className="memory-view">
      <h2>{t("memory.title")}</h2>
      {status === null && refusal === null && <p className="empty">{t(started ? "memory.loading" : "memory.notOpened")}</p>}
      {health !== undefined && health.status === "unavailable" && (
        <>
          <Refusal refusal={{ status: null, code: health.code, message: health.message }} />
          {health.code === "ccmem-missing" && <p className="caveat">{t("memory.configureHint")}</p>}
        </>
      )}
      {status !== null && status.repos.length === 0 && <p className="empty">{t("memory.noRepos")}</p>}
      {ready && (
        <>
          <p className="caveat">{t("memory.migrationNote")}</p>
          {status!.repos.length > 1 && (
            <label>
              {t("memory.repo")}
              <select name="memory-repo" value={repo!} onChange={(e) => { const next = e.currentTarget.value; setRepo(next); setDraft(""); void load(next, ""); }}>
                {status!.repos.map((r) => <option key={r.projectKey} value={r.projectKey}>{r.projectKey}</option>)}
              </select>
            </label>
          )}
          <form role="search" onSubmit={submit}>
            <input type="search" aria-label={t("memory.searchLabel")} value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
            <button type="submit">{t("memory.search")}</button>
          </form>
        </>
      )}
      {refusal !== null && <Refusal refusal={refusal} />}
      {loading && <p className="empty">{t("memory.loading")}</p>}
      {page !== null && (
        <nav aria-label={t("memory.list")}>
          {page.page.records.length === 0 && <p className="empty">{t("memory.empty")}</p>}
          {noProject && <p className="caveat">{t("memory.noProjectHint")}</p>}
          <ul className="memory-list">
            {page.page.records.map((r) => (
              <li key={r.ref}>
                <button type="button" className="memory-row" onClick={() => { void open(r.ref); }}>
                  <span className="memory-scope">{t(SCOPE_KEY[r.scope])}</span>
                  <span className="memory-kind">{r.kind}</span>
                  {r.pinned && <span className="memory-pinned">{t("memory.pinned")}</span>}
                  <span className="memory-excerpt" data-testid="memory-excerpt">{excerpt(r.content)}</span>
                  {r.tags.map((tag, index) => <span key={`${index}:${tag}`} className="tag">{tag}</span>)}
                  <time dateTime={r.updatedAt}>{r.updatedAt}</time>
                </button>
              </li>
            ))}
          </ul>
          {page.page.truncated && <p className="caveat">{t("memory.truncated", { shown: page.page.records.length, total: page.page.total })}</p>}
        </nav>
      )}
      {page !== null && record === null && refusal === null && <p className="empty">{t("memory.select")}</p>}
      {record !== null && (
        <article className="memory-detail">
          <pre className="memory-content" data-testid="memory-content">{record.content}</pre>
          <dl>
            <dt>{t("memory.field.ref")}</dt><dd>{record.ref}</dd>
            <dt>{t("memory.field.scope")}</dt><dd>{t(SCOPE_KEY[record.scope])}</dd>
            <dt>{t("memory.field.projectKey")}</dt><dd>{record.projectKey ?? ""}</dd>
            <dt>{t("memory.field.kind")}</dt><dd>{record.kind}</dd>
            <dt>{t("memory.field.source")}</dt><dd>{record.source}</dd>
            <dt>{t("memory.field.trust")}</dt><dd>{record.trust ?? ""}</dd>
            <dt>{t("memory.field.tags")}</dt><dd>{record.tags.map((tag, index) => <span key={`${index}:${tag}`} className="tag">{tag}</span>)}</dd>
            <dt>{t("memory.field.pinned")}</dt><dd>{t(record.pinned ? "memory.yes" : "memory.no")}</dd>
            <dt>{t("memory.field.createdAt")}</dt><dd><time dateTime={record.createdAt}>{record.createdAt}</time></dd>
            <dt>{t("memory.field.updatedAt")}</dt><dd><time dateTime={record.updatedAt}>{record.updatedAt}</time></dd>
          </dl>
        </article>
      )}
    </section>
  );
}
