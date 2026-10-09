/**
 * Accounts spec §3.2-§3.4, §7: what stands between the page and the panel. It asks `GET /api/auth/me` and shows
 *   - the login form while there is no session (401),
 *   - only the change-password step while the initial password is still in use (every other route answers 403
 *     `password-change-required` until then),
 *   - the panel under an account bar once logged in.
 * A 401 `login-required` on any later request (web/src/api.ts's `onLoginRequired`) ends the session here too, so the
 * page goes back to the login form instead of showing refusals everywhere. Owners also see the security notices and an
 * "Add user" form; the server answers a member's attempt anyway (owner-required), so hiding them is only courtesy.
 */
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { failureFrom, onLoginRequired } from "./api.js";
import {
  ackNotice, addUser, changePassword, fetchMe, fetchNotices, fetchUsers, isOwner, login, logout, MIN_PASSWORD_LENGTH, refreshSession, shouldRefresh,
} from "./auth.js";
import type { Me, Notice, Role } from "./auth.js";
import i18n from "./i18n.js";
import { en } from "./locales/en.js";
import { Refusal } from "./Refusal.js";

/** The logged-in person, for the parts of the page that differ by role (web/src/UsagePanel.tsx). */
export const AccountContext = createContext<Me | null>(null);

/**
 * Accounts spec §3.5, §7: whether this page offers human-only actions (group limits, spend caps, the usage calendar).
 * An owner does; a member does not (the server would answer 403). Outside AuthGate (a component rendered on its own)
 * there is no account to judge, and the server still decides.
 */
export const mayHumanOnly = (me: Me | null): boolean => me === null || isOwner(me);

const REFRESH_CHECK_MS = 10 * 60_000;

type GateState =
  | { kind: "loading" }
  | { kind: "failed"; refusal: PanelRefusal }
  | { kind: "login"; ended: boolean; changed?: boolean }
  | { kind: "change"; me: Me }
  | { kind: "ready"; me: Me };

/** A refusal the page made itself (a check before sending), in the shape `Refusal` shows. */
const localRefusal = (code: string, message: string): PanelRefusal => ({ status: null, code, message });

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>({ kind: "loading" });

  const readSession = useCallback(async (): Promise<void> => {
    try {
      const me = await fetchMe();
      if (me === null) setState({ kind: "login", ended: false });
      else setState(me.user.mustChangePassword ? { kind: "change", me } : { kind: "ready", me });
    } catch (err) {
      setState({ kind: "failed", refusal: failureFrom(err) });
    }
  }, []);

  useEffect(() => { void readSession(); }, [readSession]);

  // A session that ends mid-page (logout in another tab, a disabled user, a rotated key) returns to the login form. A
  // 401 that lands once the page is already at the login form (a read still in flight at a deliberate logout) says nothing.
  useEffect(() => onLoginRequired(() => setState((current) => (current.kind === "login" ? current : { kind: "login", ended: true }))), []);

  // Spec §3.3: refresh once less than half the lifetime is left -- checked on entering the panel, whenever the page
  // becomes visible again, and every 10 minutes while it stays open, so a short daily visit refreshes too.
  // At most one refresh per check period, whatever the answer: a server clock ahead of this browser's could answer an
  // expiry that still looks due here, and each answer re-runs this effect.
  const me = state.kind === "ready" ? state.me : null;
  const lastRefreshAsk = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (me === null) return;
    const check = (): void => {
      const now = Date.now();
      if (now - lastRefreshAsk.current < REFRESH_CHECK_MS || !shouldRefresh(me, now)) return;
      lastRefreshAsk.current = now;
      void refreshSession().then((answer) => {
        if (answer !== null) setState((current) => (current.kind === "ready" ? { kind: "ready", me: { ...current.me, expiresAt: answer.expiresAt } } : current));
      });
    };
    const onVisible = (): void => { if (document.visibilityState === "visible") check(); };
    check();
    const timer = setInterval(check, REFRESH_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [me]);

  if (state.kind === "loading") return <main className="auth-page"><p>{t("auth.loading")}</p></main>;
  if (state.kind === "failed") {
    return (
      <main className="auth-page">
        <Refusal refusal={state.refusal} />
        <button type="button" onClick={() => { setState({ kind: "loading" }); void readSession(); }}>{t("auth.retry")}</button>
      </main>
    );
  }
  if (state.kind === "login") return <LoginForm ended={state.ended} changed={state.changed === true} onLoggedIn={() => void readSession()} />;
  // Human ruling 2026-10-08: the server ends every session of the user on a password change, this one too.
  if (state.kind === "change") return <ChangePasswordForm me={state.me} onChanged={() => setState({ kind: "login", ended: false, changed: true })} />;
  return (
    <AccountContext.Provider value={state.me}>
      <div className="authenticated-shell">
        <AccountBar me={state.me} onLoggedOut={() => setState({ kind: "login", ended: false })} />
        {children}
      </div>
    </AccountContext.Provider>
  );
}

function LoginForm({ ended, changed, onLoggedIn }: { ended: boolean; changed: boolean; onLoggedIn: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const answer = await login(name, password);
    if (answer.ok) { onLoggedIn(); return; }
    setRefusal(answer);
  };
  return (
    <main className="auth-page">
      <form className="auth-form" aria-label={t("auth.loginTitle")} onSubmit={(event) => void submit(event)}>
        <h1>{t("auth.loginTitle")}</h1>
        {ended && <p role="status">{t("auth.sessionEnded")}</p>}
        {changed && <p role="status">{t("auth.passwordChanged")}</p>}
        <label>{t("auth.name")}<input name="name" autoComplete="username" value={name} onChange={(e) => setName(e.currentTarget.value)} /></label>
        <label>{t("auth.password")}<input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} /></label>
        <button type="submit">{t("auth.logIn")}</button>
        {refusal !== null && <Refusal refusal={refusal} />}
        <p className="auth-hint">{t("auth.loginHint")}</p>
      </form>
    </main>
  );
}

/** The new password typed twice, checked here before it is sent (the server checks the length again). */
function passwordProblem(next: string, again: string): PanelRefusal | null {
  if (next.length < MIN_PASSWORD_LENGTH) return localRefusal("password-too-short", i18n.t("auth.tooShort", { n: MIN_PASSWORD_LENGTH }));
  if (next !== again) return localRefusal("password-mismatch", i18n.t("auth.mismatch"));
  return null;
}

function ChangePasswordForm({ me, onChanged }: { me: Me; onChanged: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const problem = passwordProblem(next, again);
    if (problem !== null) { setRefusal(problem); return; }
    const answer = await changePassword(current, next);
    if (answer.ok) { onChanged(); return; }
    setRefusal(answer);
  };
  return (
    <main className="auth-page">
      <form className="auth-form" aria-label={t("auth.changeTitle")} onSubmit={(event) => void submit(event)}>
        <h1>{t("auth.changeTitle")}</h1>
        <p>{t("auth.changeLede", { name: me.user.name, n: MIN_PASSWORD_LENGTH })}</p>
        <label>{t("auth.currentPassword")}<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} /></label>
        <label>{t("auth.newPassword")}<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} /></label>
        <label>{t("auth.newPasswordAgain")}<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.currentTarget.value)} /></label>
        <button type="submit">{t("auth.changePassword")}</button>
        {refusal !== null && <Refusal refusal={refusal} />}
      </form>
    </main>
  );
}

function AccountBar({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }): JSX.Element {
  const { t } = useTranslation();
  const owner = isOwner(me);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const doLogout = async (): Promise<void> => {
    const answer = await logout();
    // A refused logout (the session had already ended) leaves nothing to keep: the page is logged out either way.
    if (!answer.ok && answer.code !== "login-required") { setRefusal(answer); return; }
    onLoggedOut();
  };
  return (
    <>
      <header className="account-bar">
        <span className="account-name">{me.user.name}</span>
        <span className="account-role">{me.user.roles.map((role) => t(`auth.role.${role}` as const)).join(", ")}</span>
        {owner && (
          <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{t("auth.menu")}</button>
        )}
        <button type="button" onClick={() => void doLogout()}>{t("auth.logOut")}</button>
        {refusal !== null && <Refusal refusal={refusal} />}
      </header>
      {owner && menuOpen && <AddUserForm />}
      {owner && <Notices />}
    </>
  );
}

function AddUserForm(): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAdded(null);
    const problem = passwordProblem(password, again);
    if (problem !== null) { setRefusal(problem); return; }
    const answer = await addUser({ name, role, password });
    if (!answer.ok) { setRefusal(answer); return; }
    setRefusal(null);
    setAdded(name);
    setName(""); setPassword(""); setAgain("");
  };
  return (
    <form className="account-menu" aria-label={t("auth.addUser")} onSubmit={(event) => void submit(event)}>
      <label>{t("auth.userName")}<input value={name} onChange={(e) => setName(e.currentTarget.value)} /></label>
      <label>
        {t("auth.roleLabel")}
        <select value={role} onChange={(e) => setRole(e.currentTarget.value as Role)}>
          <option value="member">{t("auth.role.member")}</option>
          <option value="owner">{t("auth.role.owner")}</option>
        </select>
      </label>
      <label>{t("auth.userPassword")}<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} /></label>
      <label>{t("auth.userPasswordAgain")}<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.currentTarget.value)} /></label>
      <button type="submit">{t("auth.addUser")}</button>
      {added !== null && <p role="status">{t("auth.added", { name: added })}</p>}
      {refusal !== null && <Refusal refusal={refusal} />}
    </form>
  );
}

/** Spec §3.2: a notice's subject -- the name it recorded, else the name of the user it names, else that user's id. */
function noticeSubject(body: unknown, names: ReadonlyMap<string, string>): string {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (typeof fields.name === "string") return fields.name;
  if (typeof fields.userId !== "string") return "";
  return names.get(fields.userId) ?? fields.userId;
}

function Notices(): JSX.Element | null {
  const { t } = useTranslation();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const read = useCallback(async (): Promise<void> => {
    try {
      const open = (await fetchNotices()).notices;
      setNotices(open);
      // Most events record only the user's id; an owner may list the users, so the notice can name them.
      if (open.length > 0) {
        const users = await fetchUsers().catch(() => null);
        if (users !== null) setNames(new Map(users.users.map((user) => [user.id, user.name])));
      }
    } catch (err) { setRefusal(failureFrom(err)); }
  }, []);
  useEffect(() => { void read(); }, [read]);
  const dismiss = async (seq: number): Promise<void> => {
    const answer = await ackNotice(seq);
    setRefusal(answer.ok ? null : answer);
    await read();
  };
  if (notices.length === 0 && refusal === null) return null;
  return (
    <section className="notices" aria-label={t("auth.noticesTitle")}>
      <ul>
        {notices.map((notice) => (
          <li key={notice.seq}>
            {t("auth.noticeLine", {
              kind: i18nKind(notice.kind),
              subject: noticeSubject(notice.body, names),
              at: new Date(notice.at).toLocaleString(),
            })}
            <button type="button" onClick={() => void dismiss(notice.seq)}>{t("auth.dismiss")}</button>
          </li>
        ))}
      </ul>
      {refusal !== null && <Refusal refusal={refusal} />}
    </section>
  );
}

/** A notice kind in words; a kind this page has no words for (a newer server) is shown as sent. */
function i18nKind(kind: string): string {
  const key = `auth.noticeKind.${kind}`;
  return Object.prototype.hasOwnProperty.call(en.auth.noticeKind, kind) ? (i18n.t(key as never) as string) : kind;
}
