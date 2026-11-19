import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { Express, NextFunction, Request, Response } from "express";
import { PanelRejection } from "./rejection.js";

export interface StaticAsset {
  bytes: Buffer;
  contentType: string;
  /** The exact map key ("index.js"). Part of the gzip cache key, so two files never share an entry. */
  name: string;
  /** mtime of the file on disk when it was loaded; with `name` and `bytes.length` it identifies this exact body. */
  mtimeMs: number;
}

export interface StaticFiles {
  get(name: string): StaticAsset | undefined;
  readonly indexHtml: StaticAsset | undefined;
  readonly names: readonly string[];
  /** Tester #394: the gzipped bytes for `asset`, memoised for this instance (bounded). */
  gzip(asset: StaticAsset): Buffer;
}

/**
 * Tester #394, human decision: gzip the text assets, with node:zlib and no npm
 * dependency. Below this size the 20-byte gzip trailer and header buy more than
 * they save, and a 1024-byte threshold is what the requirement names.
 */
const GZIP_MIN_BYTES = 1024;
/**
 * The bound the requirement names: the last 32 distinct (file, size, mtime)
 * bodies stay compressed in memory; each panel serves a handful of assets, so
 * this is a few MB at most and repeated loads never re-run zlib. Insertion order
 * is recency order (see `gzip`), so eviction is least-recently-used. The cache
 * lives on the `StaticFiles` instance, not the module, so one panel -- or one
 * criterion's fixture -- can never be served another's bytes.
 */
const GZIP_CACHE_LIMIT = 32;

/**
 * Only text. This is a whitelist on purpose: woff2, png, ico and every unknown
 * extension are already compressed or opaque, and guessing would waste CPU to
 * make files bigger.
 */
const COMPRESSIBLE_CONTENT_TYPE = /^(?:text\/|application\/javascript\b|application\/json\b|image\/svg\+xml\b)/;

/**
 * `Accept-Encoding` is a comma-separated list with optional q-values. Only an
 * explicit `gzip` (or not-explicitly-forbidden, i.e. q > 0) counts; `identity`
 * alone, or `gzip;q=0`, means no.
 */
function acceptsGzip(header: string | string[] | undefined): boolean {
  if (header === undefined) return false;
  const value = Array.isArray(header) ? header.join(",") : header;
  for (const part of value.split(",")) {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    if (coding.trim() !== "gzip") continue;
    const quality = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    if (quality === undefined) return true;
    const q = Number(quality.slice(2));
    return Number.isFinite(q) && q > 0;
  }
  return false;
}

/**
 * Derived from the encoded bytes, not from the identity body plus a suffix.
 * A proxy may hold both variants under the same URL; because the validator is
 * the hash of what was actually sent, an `If-None-Match` for one encoding can
 * never be answered with the other. `Vary: Accept-Encoding` is still sent: the
 * ETag keeps caches correct, Vary keeps them from offering the wrong body to a
 * client that did not ask for it.
 */
function etagOf(bytes: Buffer): string {
  return `"${createHash("sha1").update(bytes).digest("base64url")}"`;
}

/**
 * The static route, registered by `buildApi` at the one point in the middleware
 * chain it belongs (before the /api session check: the login page cannot present
 * a session). It lives beside the loader so a criterion can serve a fixture
 * through THIS handler rather than a copy of it.
 */
export function registerStaticRoutes(app: Express, statics: StaticFiles): void {
  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) return next();
    // Exact key only. req.path is never joined to anything, so a traversal has
    // no path to travel: "/" is the sole rewrite, and it is a fixed string.
    const name = req.path === "/" ? "index.html" : req.path.slice(1);
    const asset = statics.get(name);
    if (asset === undefined) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    // HEAD is not compressed: it carries no body, and a Content-Length for a
    // body that was never encoded would mislead. A range request is served
    // identity too -- there is no 206 handling here, so a compressed body could
    // not satisfy the range anyway.
    const compressible =
      req.method !== "HEAD" &&
      req.headers.range === undefined &&
      acceptsGzip(req.headers["accept-encoding"]) &&
      COMPRESSIBLE_CONTENT_TYPE.test(asset.contentType) &&
      asset.bytes.length > GZIP_MIN_BYTES;
    const body = compressible ? statics.gzip(asset) : asset.bytes;
    res.status(200);
    res.set("Content-Type", asset.contentType);
    res.set("Vary", "Accept-Encoding");
    res.set("ETag", etagOf(body));
    res.set("Content-Length", String(body.length));
    if (compressible) res.set("Content-Encoding", "gzip");
    // res.end, not res.send: send would recompute an ETag and a Content-Length
    // over the body it was handed, and this handler has already decided both.
    res.end(body);
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentTypeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot);
  // Unknown extensions get a type no browser will execute or render. Guessing
  // would be the one place this module could turn a file into script.
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

const defaultDistDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

/**
 * spec section 2.2. Everything under web/dist is read ONCE into a Map keyed by
 * the exact filename, and requests are answered only by exact key.
 *
 * Why not express.static, now that express is here: it joins paths and follows
 * symbolic links by default, which reintroduces the whole class of
 * normalisation, "..", symlink, content-type and SPA-fallback bugs that this
 * Map makes structurally impossible.
 *
 * Accounts spec §3.4: index.html is served as the build wrote it. When the
 * client asks for gzip the wire bytes are the gzip of that document, never an
 * altered one -- the content is unchanged, only its encoding is.
 * The page carries no credential; the browser logs in for a session cookie.
 *
 * withFileTypes + isFile() is what keeps the symlink out: readdir alone would
 * report it as an entry and readFile would follow it straight out of dist.
 */
export async function loadStaticFiles(distDir: string | undefined): Promise<StaticFiles> {
  const dir = distDir ?? defaultDistDir();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    throw new PanelRejection(
      "panel-dist-missing",
      `orca panel serves ${dir}, which does not exist. Run \`npm run build --workspace web\` first. ` +
        `Serving an empty panel instead would look like a panel with no data in it.`,
    );
  }

  const assets = new Map<string, StaticAsset>();
  for (const entry of entries) {
    // Not isDirectory(): a symbolic link is neither, and isFile() is false for
    // it, so it is skipped without a second check.
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const bytes = await readFile(path);
    // Tester #394: the gzip cache key is (name, size, mtime), so the loader owes
    // the mtime. stat (not lstat) is safe here: isFile() already excluded links.
    const { mtimeMs } = await stat(path);
    assets.set(entry.name, { bytes, contentType: contentTypeOf(entry.name), name: entry.name, mtimeMs });
  }

  const gzipCache = new Map<string, Buffer>();

  return {
    get: (name) => assets.get(name),
    get indexHtml() {
      return assets.get("index.html");
    },
    names: [...assets.keys()],
    gzip: (asset) => {
      const key = `${asset.name}\u0000${asset.bytes.length}\u0000${asset.mtimeMs}`;
      const cached = gzipCache.get(key);
      if (cached !== undefined) {
        // Re-insert so the map's insertion order is recency order.
        gzipCache.delete(key);
        gzipCache.set(key, cached);
        return cached;
      }
      const encoded = gzipSync(asset.bytes);
      if (gzipCache.size >= GZIP_CACHE_LIMIT) {
        const oldest = gzipCache.keys().next();
        if (!oldest.done) gzipCache.delete(oldest.value);
      }
      gzipCache.set(key, encoded);
      return encoded;
    },
  };
}
