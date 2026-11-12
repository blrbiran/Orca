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
import { fetchMemoryItem, fetchMemoryList, fetchMemorySearch, fetchMemoryStatus, MEMORY_PAGE_DEFAULT } from "./memoryApi.js";
import type { MemoryPageResponse, MemoryRecord, MemoryStatusResponse } from "./memoryTypes.js";
import { Refusal } from "./Refusal.js";
import { useProjectName } from "./projectNames.js";
import { Select } from "./ui/Select.js";

const EXCERPT_CODE_POINTS = 200;
const SCOPE_KEY = { global: "memory.scopeGlobal", project: "memory.scopeProject" } as const;
/** Tester #281 (2): the page sizes offered; the server's own default (50) is the first page's. */
const PAGE_SIZES = [10, 25, 50, 100] as const;

function excerpt(content: string): string {
  const points = [...content];
  return points.length <= EXCERPT_CODE_POINTS ? content : `${points.slice(0, EXCERPT_CODE_POINTS).join("")}…`;
}

export function MemoryView({ active, project, onProject }: {
  active: boolean;
  /** Project switcher spec D4: the chosen project, and how choosing a repository here moves the selection. */
  project?: string | null;
  onProject?: (projectKey: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const name = useProjectName();
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
  // Tester #281 (2): records per page; each page replaces the list (no append).
  const [pageSize, setPageSize] = useState(MEMORY_PAGE_DEFAULT);
  const detailPane = useRef<HTMLDivElement>(null);

  /** One page of the list or a search, from `offset`, `limit` records; the newest request wins over any still on its way. */
  const load = async (projectKey: string, query: string, offset = 0, limit = pageSize): Promise<void> => {
    const mine = ++latest.current;
    latestItem.current++;
    setRefusal(null);
    setRecord(null);
    setLoading(true);
    try {
      const answer = query === "" ? await fetchMemoryList(projectKey, offset, limit) : await fetchMemorySearch(projectKey, query, offset, limit);
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
  /** Another page of what is shown (the same list or query). */
  const turn = (offset: number, limit = pageSize): void => {
    if (page !== null) void load(page.projectKey, page.query, Math.max(0, offset), limit);
  };

  useEffect(() => {
    if (!active || opened.current) return;
    opened.current = true;
    setStarted(true);
    void (async () => {
      try {
        const answer = await fetchMemoryStatus();
        setStatus(answer);
        const first = project != null && answer.repos.some((r) => r.projectKey === project) ? project : answer.repos[0]?.projectKey ?? null;
        setRepo(first);
        if (answer.health.status === "ok" && first !== null) await load(first, "");
      } catch (err) {
        setRefusal(failureFrom(err));
      }
    })();
  }, [active]);

  // A project chosen elsewhere after this section opened: read it here too, once it is one this section lists.
  useEffect(() => {
    if (status === null || project == null || project === repo || !status.repos.some((r) => r.projectKey === project)) return;
    setRepo(project);
    setDraft("");
    if (status.health.status === "ok") void load(project, "");
  }, [project, status]);

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

  // Narrow layouts stack the detail under the list, so opening a memory brings the detail into view.
  useEffect(() => {
    if (record !== null) detailPane.current?.scrollIntoView?.({ block: "nearest" });
  }, [record]);

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
        health.code === "ccmem-missing" ? (
          <p role="note" data-tone="warn">{t("memory.configureHint")} <code data-testid="refusal-code">{health.code}</code></p>
        ) : (
          <Refusal refusal={{ status: null, code: health.code, message: health.message }} />
        )
      )}
      {status !== null && status.repos.length === 0 && <p className="empty">{t("memory.noRepos")}</p>}
      {ready && (
        <>
          <p className="caveat">{t("memory.migrationNote")}</p>
          {status!.repos.length > 1 && (
            <label>
              {t("memory.repo")}
              <Select value={repo!} onValueChange={(next) => { setRepo(next); setDraft(""); void load(next, ""); onProject?.(next); }}
                options={status!.repos.map((r) => ({ value: r.projectKey, label: name(r.projectKey) }))} />
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
        <div className="split">
        <div className="split-list">
        <nav aria-label={t("memory.list")}>
          {page.page.records.length === 0 && <p className="empty">{t("memory.empty")}</p>}
          {noProject && <p className="caveat">{t("memory.noProjectHint")}</p>}
          <ul className="memory-list">
            {page.page.records.map((r) => (
              <li key={r.ref}>
                <button type="button" className="memory-row flex w-full flex-wrap gap-2 text-left" onClick={() => { void open(r.ref); }}>
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
          {/* Tester #258: which matches are shown. #281: a page size, previous / next and "page X of Y"; each page replaces the list. */}
          {page.page.records.length > 0 && page.page.records.length < page.page.total && <p className="caveat num">{t("memory.range", { from: page.page.offset + 1, to: page.page.offset + page.page.records.length, total: page.page.total })}</p>}
          {/* Only when paging can matter: a list that fits the smallest page needs no controls. */}
          {page.page.total > PAGE_SIZES[0] && (
            <div className="flex flex-wrap items-center gap-2" data-testid="memory-pager">
              <button type="button" disabled={loading || page.page.offset === 0} onClick={() => turn(page.page.offset - pageSize)}>{t("memory.previous")}</button>
              <span className="num">{t("memory.pageOf", { page: Math.floor(page.page.offset / pageSize) + 1, pages: Math.max(1, Math.ceil(page.page.total / pageSize)) })}</span>
              <button type="button" disabled={loading || !page.page.hasMore} onClick={() => turn(page.page.offset + pageSize)}>{t("memory.next")}</button>
              <span>{t("memory.perPage")}</span>
              <Select aria-label={t("memory.perPage")} value={String(pageSize)} onValueChange={(next) => { const size = Number(next); setPageSize(size); turn(0, size); }}
                options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))} />
            </div>
          )}
        </nav>
        </div>
        <div className="split-detail" ref={detailPane}>
      {record === null && refusal === null && <p className="empty">{t("memory.select")}</p>}
      {record !== null && (
        <article className="memory-detail">
          <pre className="whitespace-pre-wrap wrap-anywhere" data-testid="memory-content">{record.content}</pre>
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
        </div>
        </div>
      )}
    </section>
  );
}
