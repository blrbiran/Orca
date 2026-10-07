import { timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { Role } from "./accounts/jwt.js";
import { AccountsRejection, type UserRow } from "./accounts/store.js";
import { objectBody } from "./api.js";
import { expiryOf, type AuthenticatedUser, type PanelAuth } from "./auth.js";
import { controlErrorBody } from "./controlErrors.js";
import { CSRF_REQUIRED, LOGIN_REQUIRED, PANEL_BAD_REQUEST, PASSWORD_CHANGE_REQUIRED } from "./rejection.js";
import { tokenMatches } from "./token.js";

export const AUTH_COOKIE = "orca_at";
export const CSRF_COOKIE = "orca_csrf";
export const CSRF_HEADER = "x-orca-csrf";

/** Spec §3.2: what a user with a forced password change may still reach (paths below `/api`). */
const FORCED_CHANGE_PATHS = new Set(["/auth/me", "/auth/password", "/auth/logout"]);

/** By hand, not a dependency: split on `;`, trim, split at the first `=`. The first occurrence of a name wins. */
function cookiesOf(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const pair = part.trim();
    const split = pair.indexOf("=");
    if (split <= 0) continue;
    const name = pair.slice(0, split);
    if (!cookies.has(name)) cookies.set(name, pair.slice(split + 1));
  }
  return cookies;
}

const sameSecret = (left: string | undefined, right: string | undefined): boolean => {
  if (left === undefined || right === undefined || left.length === 0) return false;
  const a = Buffer.from(left, "utf8"), b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};

const isLogin = (req: Request): boolean => req.method === "POST" && req.path === "/auth/login";

/** A refusal in the shape its path answers today: `controlErrorBody` under /api/control, `{code,message}` elsewhere. */
function refuse(req: Request, res: Response, status: number, code: string, message: string): void {
  res.status(status).json(req.path === "/control" || req.path.startsWith("/control/") ? controlErrorBody(code, message) : { code, message });
}

/**
 * Accounts spec §3.3-§3.4, mounted on `/api` after the Host gate and the body parser and before every other `/api`
 * route, the auth routes included (ruling Q8): only `POST /api/auth/login` is exempt. A session first; the page token
 * second (Task 4 deletes that arm); then the forced password change; then CSRF on every non-GET.
 */
export function authMiddleware(auth: PanelAuth, legacyToken: string | null): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isLogin(req)) { next(); return; }
    const cookies = cookiesOf(req.headers.cookie);
    const current = auth.authenticate(cookies.get(AUTH_COOKIE), auth.nowMs());
    if (current === null) {
      if (legacyToken !== null && tokenMatches(legacyToken, req.header("x-orca-token") ?? undefined)) { next(); return; }
      refuse(req, res, 401, LOGIN_REQUIRED, "log in to this panel");
      return;
    }
    if (current.user.mustChangePassword && !FORCED_CHANGE_PATHS.has(req.path)) {
      refuse(req, res, 403, PASSWORD_CHANGE_REQUIRED, "change the initial password first");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD" && !sameSecret(req.header(CSRF_HEADER) ?? undefined, cookies.get(CSRF_COOKIE))) {
      refuse(req, res, 403, CSRF_REQUIRED, `a request that changes something carries the ${CSRF_HEADER} header`);
      return;
    }
    res.locals.orcaUser = current;
    next();
  };
}

const publicUser = (user: UserRow) => ({ id: user.id, name: user.name, roles: user.roles, mustChangePassword: user.mustChangePassword });

function sessionCookies(token: string, csrf: string, maxAgeSec: number): string[] {
  return [
    `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`,
    `${CSRF_COOKIE}=${csrf}; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`,
  ];
}

/** The logged-in user, or a 401 for a request the page token let through (it carries no user). */
function currentUser(res: Response): AuthenticatedUser | undefined {
  const current = res.locals.orcaUser as AuthenticatedUser | undefined;
  if (current === undefined) res.status(401).json({ code: LOGIN_REQUIRED, message: "log in to this panel" });
  return current;
}

function ownerOnly(res: Response): AuthenticatedUser | undefined {
  const current = currentUser(res);
  if (current === undefined) return undefined;
  if (current.user.roles.includes("owner")) return current;
  res.status(403).json({ code: "owner-required", message: "only an owner may do this" });
  return undefined;
}

const strings = (body: Record<string, unknown>, ...names: string[]): string[] | undefined =>
  names.every((name) => typeof body[name] === "string") ? names.map((name) => body[name] as string) : undefined;

function badFields(res: Response, names: string): void {
  res.status(400).json({ code: PANEL_BAD_REQUEST, message: `this endpoint wants ${names}` });
}

/** An AccountsRejection answers its own status and code; anything else goes to the shared error handler. */
function answer(res: Response, next: NextFunction, fn: () => void): void {
  try { fn(); } catch (error) {
    if (error instanceof AccountsRejection) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
    next(error);
  }
}

/** Accounts spec §3.2-§3.3, §8. Registered after `authMiddleware` (ruling Q8). */
export function registerAuthRoutes(app: Express, auth: PanelAuth): void {
  app.post("/api/auth/login", (req, res, next) => {
    const body = objectBody(req, res);
    if (body === undefined) return;
    const fields = strings(body, "name", "password");
    if (fields === undefined) { badFields(res, "{name, password} strings"); return; }
    answer(res, next, () => {
      const result = auth.login(fields[0]!, fields[1]!, auth.nowMs());
      if (result.ok) {
        res.setHeader("set-cookie", sessionCookies(result.token, result.csrf, auth.sessionDays * 86_400));
        res.json({ user: publicUser(result.user) });
      } else if (result.code === "login-throttled") {
        res.status(429).json({ code: result.code, message: "too many failed logins for this name; wait and try again", retryAfterSec: result.retryAfterSec });
      } else {
        res.status(401).json({ code: result.code, message: "the name or the password is wrong" });
      }
    });
  });

  app.get("/api/auth/me", (_req, res) => {
    const current = currentUser(res);
    if (current === undefined) return;
    res.json({ user: publicUser(current.user), expiresAt: current.claims.exp * 1000, sessionDays: auth.sessionDays });
  });

  app.post("/api/auth/refresh", (req, res, next) => {
    const current = currentUser(res);
    if (current === undefined) return;
    answer(res, next, () => {
      const now = auth.nowMs();
      const token = auth.refresh(current, now);
      // The CSRF cookie keeps its value and gets the token's new lifetime, so POSTs keep working for as long as it lives.
      res.setHeader("set-cookie", sessionCookies(token, cookiesOf(req.headers.cookie).get(CSRF_COOKIE) ?? "", auth.sessionDays * 86_400));
      res.json({ expiresAt: expiryOf(now, auth.sessionDays).exp * 1000 });
    });
  });

  app.post("/api/auth/logout", (_req, res) => {
    const current = currentUser(res);
    if (current === undefined) return;
    auth.logout(current.claims.sid, auth.nowMs());
    res.setHeader("set-cookie", sessionCookies("", "", 0));
    res.json({});
  });

  app.post("/api/auth/password", (req, res, next) => {
    const current = currentUser(res);
    if (current === undefined) return;
    const body = objectBody(req, res);
    if (body === undefined) return;
    const fields = strings(body, "current", "next");
    if (fields === undefined) { badFields(res, "{current, next} strings"); return; }
    answer(res, next, () => {
      const result = auth.changePassword(current, fields[0]!, fields[1]!, auth.nowMs());
      if (result.ok) res.json({});
      else if (result.code === "login-throttled") res.status(429).json({ code: result.code, message: "too many wrong passwords for this name; wait and try again", retryAfterSec: result.retryAfterSec });
      else res.status(401).json({ code: result.code, message: "the current password is wrong" });
    });
  });

  app.post("/api/auth/profile", (req, res, next) => {
    const current = currentUser(res);
    if (current === undefined) return;
    const body = objectBody(req, res);
    if (body === undefined) return;
    const fields = strings(body, "name");
    if (fields === undefined) { badFields(res, "{name} as a string"); return; }
    answer(res, next, () => {
      auth.store.setName(current.user.id, fields[0]!);
      res.json({ user: publicUser(auth.store.findById(current.user.id)!) });
    });
  });

  app.get("/api/auth/users", (_req, res) => {
    if (ownerOnly(res) === undefined) return;
    res.json({ users: auth.store.listUsers() });
  });

  app.post("/api/auth/users", (req, res, next) => {
    const current = ownerOnly(res);
    if (current === undefined) return;
    const body = objectBody(req, res);
    if (body === undefined) return;
    const fields = strings(body, "name", "role", "password");
    if (fields === undefined) { badFields(res, "{name, role, password} strings"); return; }
    const role = fields[1]!;
    // Strict: exactly one of the two roles v1 knows; anything else is refused, never defaulted.
    if (role !== "owner" && role !== "member") { res.status(400).json({ code: "user-role-invalid", message: "role is owner or member" }); return; }
    answer(res, next, () => {
      const user = auth.store.createUser({ name: fields[0]!, password: fields[2]!, roles: [role as Role], now: auth.nowMs(), by: `user:${current.user.id}` });
      res.status(201).json({ user });
    });
  });

  app.get("/api/auth/notices", (_req, res) => {
    const current = currentUser(res);
    if (current === undefined) return;
    res.json({ notices: current.user.roles.includes("owner") ? auth.store.openNotices() : [] });
  });

  app.post("/api/auth/notices/:seq/ack", (req, res, next) => {
    const current = ownerOnly(res);
    if (current === undefined) return;
    const seq = /^[0-9]{1,15}$/.test(String(req.params.seq)) ? Number(req.params.seq) : Number.NaN;
    answer(res, next, () => {
      if (Number.isNaN(seq)) throw new AccountsRejection("notice-not-found", 404, "no such notice");
      auth.store.acknowledge(seq, `user:${current.user.id}`, auth.nowMs());
      res.json({});
    });
  });
}
