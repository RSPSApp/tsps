#!/usr/bin/env node
/**
 * Zero-dependency static server for the production client build (client/build).
 *
 *   node scripts/serve-build.mjs                 serve client/build
 *   node scripts/serve-build.mjs --precompress   write .gz/.br next to text assets (run after build)
 *
 * Env: PORT (3000), HOST (0.0.0.0, use 127.0.0.1 for local-only),
 *      CACHE_DIR (optional: serve /caches/* from this directory; defaults to server/caches
 *      when the build has no caches/ folder).
 *
 * Mirrors vercel.json: cross-origin isolation headers (COEP only for Chromium-family browsers,
 * not the iOS wrappers) and an SPA fallback to index.html.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".json", ".svg", ".wasm", ".txt"]);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
};

if (!fs.existsSync(root)) {
    console.error(`[serve-build] ${root} does not exist. Run the client build first.`);
    process.exit(1);
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "caches") walk(full, out); // game cache is already compressed
        } else {
            out.push(full);
        }
    }
    return out;
}

if (process.argv.includes("--precompress")) {
    let count = 0;
    for (const file of walk(root)) {
        if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
        const data = fs.readFileSync(file);
        if (data.length < 1024) continue;
        fs.writeFileSync(file + ".gz", zlib.gzipSync(data, { level: 9 }));
        fs.writeFileSync(
            file + ".br",
            zlib.brotliCompressSync(data, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
            })
        );
        count++;
    }
    console.log(`[serve-build] precompressed ${count} files`);
    process.exit(0);
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
// /caches/ is served from CACHE_DIR if set, else from build/caches if the build contains it,
// else from the server's cache folder (server/caches, filled by server/scripts/ensure-cache.ts).
const SERVER_CACHES = path.resolve(root, "..", "..", "server", "caches");
const CACHE_DIR = process.env.CACHE_DIR
    ? path.resolve(process.env.CACHE_DIR)
    : !fs.existsSync(path.join(root, "caches")) && fs.existsSync(SERVER_CACHES)
      ? SERVER_CACHES
      : null;

function isolationHeaders(userAgent) {
    const headers = {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        Vary: "User-Agent, Accept-Encoding",
    };
    if (/(Chrome|Chromium|Edg|OPR)\//.test(userAgent) && !/(CriOS|FxiOS|EdgiOS)/.test(userAgent)) {
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    return headers;
}

function statOrNull(file) {
    try {
        return fs.statSync(file);
    } catch {
        return null;
    }
}

/** Maps a URL path to a file inside the served roots, or null if it escapes them. */
function resolveFile(urlPath) {
    let rel;
    try {
        rel = decodeURIComponent(urlPath);
    } catch {
        return null;
    }
    if (rel.includes("\0")) return null;
    if (rel.split("/").some((segment) => segment.startsWith("."))) return null; // no dotfiles (locks etc.)
    let base = root;
    if (CACHE_DIR && rel.startsWith("/caches/")) {
        base = CACHE_DIR;
        rel = rel.slice("/caches".length);
    }
    const file = path.normalize(path.join(base, rel));
    if (file !== base && !file.startsWith(base + path.sep)) return null;
    return file;
}

function cacheControl(urlPath) {
    if (urlPath.startsWith("/static/")) return "public, max-age=31536000, immutable";
    if (urlPath.startsWith("/caches/")) return "public, max-age=86400";
    return "no-cache"; // index.html and friends: always revalidate (cheap 304 via ETag)
}

function respond(req, res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
}

function sendFile(req, res, urlPath, file, stat) {
    const ext = path.extname(file).toLowerCase();
    const headers = {
        ...isolationHeaders(req.headers["user-agent"] || ""),
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl(urlPath),
        ETag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    };

    if (req.headers["if-none-match"] === headers.ETag) {
        return respond(req, res, 304, headers);
    }

    let target = file;
    let size = stat.size;
    const range = req.headers.range;

    if (!range && COMPRESSIBLE.has(ext)) {
        const accepts = req.headers["accept-encoding"] || "";
        for (const [encoding, suffix] of [["br", ".br"], ["gzip", ".gz"]]) {
            const compressed = accepts.includes(encoding) ? statOrNull(file + suffix) : null;
            if (compressed) {
                target = file + suffix;
                size = compressed.size;
                headers["Content-Encoding"] = encoding;
                break;
            }
        }
    }

    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
            if (match[1]) {
                start = Number(match[1]);
                if (match[2]) end = Math.min(Number(match[2]), size - 1);
            } else {
                start = Math.max(0, size - Number(match[2])); // suffix range
            }
            if (start > end || start >= size) {
                headers["Content-Range"] = `bytes */${size}`;
                return respond(req, res, 416, headers);
            }
            status = 206;
            headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        }
    }

    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(target, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
}

const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        return respond(req, res, 405, { Allow: "GET, HEAD" });
    }
    const urlPath = new URL(req.url || "/", "http://localhost").pathname;
    const notFound = () =>
        respond(req, res, 404, {
            ...isolationHeaders(req.headers["user-agent"] || ""),
            "Content-Type": "text/plain; charset=utf-8",
        }, "Not found");

    let file = resolveFile(urlPath);
    if (!file) return notFound();

    let stat = statOrNull(file);
    if (stat?.isDirectory()) {
        file = path.join(file, "index.html");
        stat = statOrNull(file);
    }
    if (stat?.isFile()) return sendFile(req, res, urlPath, file, stat);

    // Missing assets and cache files must 404 (so the client sees a real error);
    // anything else is a client-side route and gets the SPA shell.
    if (urlPath.startsWith("/caches/") || path.extname(urlPath)) return notFound();
    const index = path.join(root, "index.html");
    const indexStat = statOrNull(index);
    if (!indexStat) return notFound();
    return sendFile(req, res, "/index.html", index, indexStat);
});

server.keepAliveTimeout = 30_000;
server.listen(PORT, HOST, () => {
    console.log(`[serve-build] serving ${root} on http://${HOST}:${PORT}`);
    if (CACHE_DIR) console.log(`[serve-build] /caches/ -> ${CACHE_DIR}`);
});
