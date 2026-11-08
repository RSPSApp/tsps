const crypto = require("crypto");
const fs = require("fs");

// Who may reach the world config page. Spec "Access": own listener on loopback, a token on every
// request (any web page the host visits can send requests to localhost), Host pinned to
// localhost (DNS rebinding), same-origin writes, no CORS headers.

const DEFAULT_PORT = 49600;
const LOOPBACK = "127.0.0.1";
// Per port: browsers share cookies across ports of one host, so worktrees would overwrite each other.
const cookieName = (port) => `wa_token_${port}`;

/**
 * WORLD_ADMIN_PORT, else 49600 + WT_SLOT (a scripts/wt worktree whose .env predates
 * WORLD_ADMIN_PORT), else 49600.
 */
function resolvePort(raw, slot) {
  if (raw === undefined || String(raw).trim() === "") {
    const n = Number(slot);
    return slot !== undefined && String(slot).trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 99
      ? DEFAULT_PORT + n
      : DEFAULT_PORT;
  }
  const port = Number(raw);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULT_PORT;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,}$/;

/**
 * The generated token, kept in `tokenFile` (gitignored, mode 0o600 where supported) so the
 * page's cookie survives the restarts it triggers. Falls back to a per-start token when the
 * file can't be read or written.
 */
function storedToken(tokenFile, notes) {
  if (!tokenFile) return crypto.randomBytes(24).toString("base64url");
  try {
    const existing = fs.readFileSync(tokenFile, "utf8").trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch (err) {
    if (err?.code !== "ENOENT") notes.push(`could not read ${tokenFile} (${err.message}); using a new token`);
  }
  const token = crypto.randomBytes(24).toString("base64url");
  try {
    fs.writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
    fs.chmodSync(tokenFile, 0o600);
  } catch (err) {
    notes.push(`could not save the token to ${tokenFile} (${err.message}); it changes on every start`);
  }
  return token;
}

/**
 * Listener settings from the environment. `notes` are logged by the caller.
 * `tokenFile`: where the generated token is kept when WORLD_ADMIN_TOKEN is unset.
 */
function resolveAccess(env = process.env, { tokenFile } = {}) {
  const notes = [];
  const configuredToken = env.WORLD_ADMIN_TOKEN ? String(env.WORLD_ADMIN_TOKEN) : "";
  let host = LOOPBACK;
  if (env.WORLD_ADMIN_BIND) {
    if (configuredToken) {
      host = String(env.WORLD_ADMIN_BIND);
    } else {
      notes.push(`WORLD_ADMIN_BIND ignored: it needs WORLD_ADMIN_TOKEN set; listening on ${LOOPBACK} only`);
    }
  }
  return {
    port: resolvePort(env.WORLD_ADMIN_PORT, env.WT_SLOT),
    host,
    loopback: host === LOOPBACK || host === "localhost" || host === "::1",
    token: configuredToken || storedToken(tokenFile, notes),
    notes,
  };
}

function tokenMatches(candidate, token) {
  if (typeof candidate !== "string" || candidate === "") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

/** The request carries the token as a `wa_token_<port>` cookie or `Authorization: Bearer`. */
function hasToken(request, token, port) {
  const auth = String(request.headers.authorization ?? "");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  return tokenMatches(bearer, token) || tokenMatches(cookieValue(request.headers.cookie, cookieName(port)), token);
}

/** In loopback mode only `localhost:<port>` / `127.0.0.1:<port>` (blocks DNS rebinding). */
function hostAllowed(request, port, loopback) {
  if (!loopback) return true;
  const host = String(request.headers.host ?? "").toLowerCase();
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/** Writes accept no Origin (same-origin fetch from some browsers, curl) or the page's own. */
function originAllowed(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://${request.headers.host}`;
}

function sessionCookie(token, port) {
  return `${cookieName(port)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`;
}

module.exports = {
  DEFAULT_PORT,
  resolveAccess,
  hasToken,
  tokenMatches,
  hostAllowed,
  originAllowed,
  sessionCookie,
};
